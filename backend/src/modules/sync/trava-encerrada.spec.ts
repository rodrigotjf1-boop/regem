import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A TRAVA DO PEDIDO ENCERRADA NÃO VOLTA A "ATIVA" (mig 517, V60). A nuvem cria a trava "ativa" (o robô mora lá); o servidor
// da loja pode encerrá-la ("Liberar o pedido") e a nuvem também (o cliente confirmou, desistiu, venceu). O sincronismo é
// última-escrita-vence pela data e os relógios são diferentes: sem a regra, o "Liberar" dado na loja com o relógio
// atrasado perderia para a cópia "ativa" da nuvem — e o pedido ficaria preso de novo. Postgres real — o push (sync.service)
// e o pull (sync-daemon, `condicaoSobrescrever`).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('trava-encerrada.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');

// Cada caso: situação na nuvem → a loja manda (com a data: 'nova' ou 'velha') → o que fica na nuvem.
const PUSH: [string, string, 'nova' | 'velha', string][] = [
  ['ativa', 'liberada', 'velha', 'liberada'], // o "Liberar" da loja vale mesmo com a data mais velha (relógio atrasado)
  ['ativa', 'liberada', 'nova', 'liberada'],
  ['confirmada', 'ativa', 'nova', 'confirmada'], // a cópia "ativa" da loja não reabre a trava que a nuvem encerrou
  ['liberada', 'ativa', 'nova', 'liberada'],
  ['ativa', 'ativa', 'nova', 'ativa'], // ativa × ativa: o LWW de sempre
];

descrever('trava encerrada — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    const tem = (await q(`select to_regclass(current_schema() || '.pedido_trava') is not null as ok`))[0].ok;
    if (!tem) await pool.query(readFileSync(join(RAIZ, '..', 'database', 'migrations', '517_pedido_trava.sql'), 'utf8'));
    await q(`insert into empresa (id, nome) values ($1, 'teste trava encerrada')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from pedido_trava where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(PUSH)('nuvem "%s", a loja manda "%s" (%s) → fica "%s"', async (aqui, daLoja, data, fica) => {
    const id = randomUUID();
    await q(`insert into pedido_trava (id, tenant_id, pedido_id, quer, ate, situacao) values ($1,$2,$3,'➕ 1 Batata',now() + interval '10 minutes',$4)`, [
      id,
      T,
      randomUUID(),
      aqui,
    ]);
    // a data daqui: meia hora atrás (dentro da sessão de sincronização o gatilho mantém o carimbo)
    await q(`begin; select set_config('regem.sync','on',true);
             update pedido_trava set updated_at = now() - interval '30 minutes' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_trava where id = $1', [id]))[0]));
    const quando = data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000);
    await svc.push(ctx() as any, [{ tabela: 'pedido_trava', linhas: [{ ...linha, situacao: daLoja, updated_at: quando.toISOString() }] } as any]);
    expect((await q('select situacao from pedido_trava where id = $1', [id]))[0].situacao).toBe(fica);
  });
});

// O lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever`, avaliada aqui a
// partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta (como em alteracao-decidida.spec).
function condicaoDoDaemon(): (tabela: string, cols: Set<string>) => string {
  const fonte = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8').replace(/\r\n/g, '\n');
  const i = fonte.indexOf('function condicaoSobrescrever(');
  if (i < 0) throw new Error('não achei condicaoSobrescrever no sync-daemon.mjs');
  const funcao = fonte.slice(i, fonte.indexOf('\n}\n', i) + 3);
  const q = fonte.match(/^const q = .*$/m)?.[0];
  const terminais = fonte.match(/^const ESTADOS_TERMINAIS = .*$/m)?.[0];
  if (!q || !terminais) throw new Error('sync-daemon.mjs mudou: q / ESTADOS_TERMINAIS não encontrados');
  return new Function(`${q}\n${terminais}\n${funcao}\nreturn condicaoSobrescrever;`)();
}

descrever('trava encerrada — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  const esquema = `teste_trava_${Date.now()}`;
  const aplicar = (linha: any) =>
    q(
      `insert into pedido_trava (id, situacao, updated_at) values ($1,$2,$3)
       on conflict (id) do update set situacao = excluded.situacao, updated_at = excluded.updated_at${condicao}`,
      [linha.id, linha.situacao, linha.updated_at],
    );
  const situacao = async (id: string) => (await q('select situacao from pedido_trava where id = $1', [id]))[0].situacao;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table pedido_trava (id uuid primary key, situacao text not null, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('pedido_trava', new Set(['id', 'situacao', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('liberada aqui (relógio atrasado) não volta a "ativa" pela cópia da nuvem, mesmo mais nova', async () => {
    const id = randomUUID();
    await aplicar({ id, situacao: 'liberada', updated_at: new Date(Date.now() - 3_600_000) });
    await aplicar({ id, situacao: 'ativa', updated_at: new Date() });
    expect(await situacao(id)).toBe('liberada');
  });

  it('o fim que a nuvem gravou (confirmada, desistiu, vencida) desce mesmo mais velho que a ativa daqui', async () => {
    for (const fim of ['confirmada', 'desistiu', 'vencida']) {
      const id = randomUUID();
      await aplicar({ id, situacao: 'ativa', updated_at: new Date() });
      await aplicar({ id, situacao: fim, updated_at: new Date(Date.now() - 60_000) });
      expect(await situacao(id)).toBe(fim);
    }
  });

  it('a ativa que desce entra; ativa × ativa segue o LWW de sempre', async () => {
    const id = randomUUID();
    await aplicar({ id, situacao: 'ativa', updated_at: new Date() });
    expect(await situacao(id)).toBe('ativa');
    await aplicar({ id, situacao: 'ativa', updated_at: new Date(Date.now() - 60_000) });
    expect((await q('select count(*)::int as n from pedido_trava where id = $1', [id]))[0].n).toBe(1);
  });

  it('a regra só vale para a trava (a alteração e o pedido seguem com as deles)', () => {
    expect(condicaoDoDaemon()('pedido_alteracao', new Set(['id', 'situacao', 'updated_at']))).not.toContain(`'ativa'`);
    expect(condicaoDoDaemon()('pedido_externo', new Set(['id', 'status', 'updated_at']))).not.toContain(`'ativa'`);
  });
});
