import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ALTERAÇÃO DO PEDIDO DECIDIDA NÃO VOLTA A "PEDIDA" (mig 362, V60). A nuvem só cria a alteração "pedida" (tela da nuvem
// ou robô, de loja com servidor ligado); quem DECIDE (aplicada | recusada) é o servidor da loja. O sincronismo é
// última-escrita-vence pela data e os relógios são diferentes: sem a regra, a "pedida" mais nova da nuvem voltaria à loja
// e o EdgeAlteracoesProcessor aplicaria DE NOVO (item em dobro); e a decisão da loja com a data mais velha não valeria na
// nuvem. Postgres real — o push (sync.service) e o pull (sync-daemon, `condicaoSobrescrever`).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('alteracao-decidida.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');

// Cada caso: situação na nuvem → a loja manda (com a data: 'nova' ou 'velha') → o que fica na nuvem.
const PUSH: [string, string, 'nova' | 'velha', string][] = [
  ['pedida', 'aplicada', 'velha', 'aplicada'], // a decisão da loja vale mesmo com a data mais velha (relógio atrasado)
  ['pedida', 'recusada', 'velha', 'recusada'],
  ['aplicada', 'pedida', 'nova', 'aplicada'], // a cópia "pedida" não desfaz a decisão
  ['recusada', 'pedida', 'nova', 'recusada'],
  ['pedida', 'pedida', 'nova', 'pedida'], // pedida × pedida: o LWW de sempre
];

descrever('alteração decidida — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    const tem = (await q(`select to_regclass(current_schema() || '.pedido_alteracao') is not null as ok`))[0].ok;
    if (!tem) await pool.query(readFileSync(join(RAIZ, '..', 'database', 'migrations', '362_pedido_alteracao.sql'), 'utf8'));
    await q(`insert into empresa (id, nome) values ($1, 'teste alteração decidida')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from pedido_alteracao where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(PUSH)('nuvem "%s", a loja manda "%s" (%s) → fica "%s"', async (aqui, daLoja, data, fica) => {
    const id = randomUUID();
    await q(`insert into pedido_alteracao (id, tenant_id, pedido_id, situacao) values ($1,$2,$3,$4)`, [id, T, randomUUID(), aqui]);
    // a data daqui: meia hora atrás (dentro da sessão de sincronização o gatilho mantém o carimbo)
    await q(`begin; select set_config('regem.sync','on',true);
             update pedido_alteracao set updated_at = now() - interval '30 minutes' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_alteracao where id = $1', [id]))[0]));
    const quando = data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000);
    await svc.push(ctx() as any, [
      { tabela: 'pedido_alteracao', linhas: [{ ...linha, situacao: daLoja, updated_at: quando.toISOString() }] } as any,
    ]);
    expect((await q('select situacao from pedido_alteracao where id = $1', [id]))[0].situacao).toBe(fica);
  });
});

// O lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever`, avaliada aqui a
// partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta (como em chamado-resolvido.spec).
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

descrever('alteração decidida — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  const esquema = `teste_alteracao_${Date.now()}`;
  const aplicar = (linha: any) =>
    q(
      `insert into pedido_alteracao (id, situacao, updated_at) values ($1,$2,$3)
       on conflict (id) do update set situacao = excluded.situacao, updated_at = excluded.updated_at${condicao}`,
      [linha.id, linha.situacao, linha.updated_at],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table pedido_alteracao (id uuid primary key, situacao text not null, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('pedido_alteracao', new Set(['id', 'situacao', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('decidida aqui (aplicada ou recusada) não volta a "pedida" por uma cópia da nuvem, mesmo mais nova', async () => {
    for (const decidida of ['aplicada', 'recusada']) {
      const id = randomUUID();
      await aplicar({ id, situacao: decidida, updated_at: new Date(Date.now() - 3_600_000) });
      await aplicar({ id, situacao: 'pedida', updated_at: new Date() });
      expect((await q('select situacao from pedido_alteracao where id = $1', [id]))[0].situacao).toBe(decidida);
    }
  });

  it('a pedida que desce entra; e a mais velha não sobrescreve a mais nova (o LWW de sempre)', async () => {
    const id = randomUUID();
    await aplicar({ id, situacao: 'pedida', updated_at: new Date() });
    expect((await q('select situacao from pedido_alteracao where id = $1', [id]))[0].situacao).toBe('pedida');
    await aplicar({ id, situacao: 'pedida', updated_at: new Date(Date.now() - 60_000) });
    expect((await q('select count(*)::int as n from pedido_alteracao where id = $1', [id]))[0].n).toBe(1);
  });

  it('a regra só vale para a alteração do pedido (o pedido de canal segue com a dele)', () => {
    const doPedido = condicaoDoDaemon()('pedido_externo', new Set(['id', 'status', 'updated_at']));
    expect(doPedido).not.toContain(`'pedida'`);
  });
});
