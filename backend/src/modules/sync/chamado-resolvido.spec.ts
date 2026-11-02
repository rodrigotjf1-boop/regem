import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CASO DA CENTRAL DE ATENDIMENTO RESOLVIDO NÃO REABRE (mig 350, V60). Com a fila, o chamado é mexido dos DOIS lados —
// pegar, passar e aguardar na loja ou na nuvem; o robô soma mensagem na nuvem — e o sincronismo é última-escrita-vence
// pela data. Regra: o resolvido não volta a aberto por uma cópia "mais nova" do outro lado, e o resolvido que chega vale
// mesmo mais velho (senão a nuvem ficaria "aberto" e a loja "resolvido" para sempre). Postgres real.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('chamado-resolvido.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');

// Cada caso: situação deste lado → a outra ponta manda (com a data: 'nova' ou 'velha') → o que fica.
const PUSH: [string, string, 'nova' | 'velha', string][] = [
  ['resolvido', 'aberto', 'nova', 'resolvido'], // resolvido na nuvem não reabre pela loja
  ['aberto', 'resolvido', 'velha', 'resolvido'], // o resolvido da loja vence mesmo mais velho (o robô somou aqui depois)
  ['aberto', 'aberto', 'nova', 'aberto'], // aberto × aberto: o LWW de sempre (a loja pegou o caso)
];

descrever('caso resolvido — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste chamado resolvido')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from atendimento_chamado where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(PUSH)('nuvem "%s", a loja manda "%s" (%s) → fica "%s"', async (aqui, daLoja, data, fica) => {
    const id = randomUUID();
    await q(`insert into atendimento_chamado (id, tenant_id, tipo, status) values ($1,$2,'humano',$3)`, [id, T, aqui]);
    // a data daqui: meia hora atrás (dentro da sessão de sincronização o gatilho mantém o carimbo)
    await q(`begin; select set_config('regem.sync','on',true);
             update atendimento_chamado set atualizado_em = now() - interval '30 minutes' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from atendimento_chamado where id = $1', [id]))[0]));
    const quando = data === 'nova' ? new Date() : new Date(Date.now() - 3_600_000);
    await svc.push(ctx() as any, [
      { tabela: 'atendimento_chamado', linhas: [{ ...linha, status: daLoja, atualizado_em: quando.toISOString() }] } as any,
    ]);
    expect((await q('select status from atendimento_chamado where id = $1', [id]))[0].status).toBe(fica);
  });

  it('aberto × aberto mais velho da loja: a nuvem fica com o dela (o LWW de sempre)', async () => {
    const id = randomUUID();
    const ana = randomUUID();
    await q(`insert into atendimento_chamado (id, tenant_id, tipo, status, responsavel_id) values ($1,$2,'humano','aberto',$3)`, [
      id,
      T,
      ana,
    ]);
    const linha = JSON.parse(JSON.stringify((await q('select * from atendimento_chamado where id = $1', [id]))[0]));
    await svc.push(ctx() as any, [
      {
        tabela: 'atendimento_chamado',
        linhas: [{ ...linha, responsavel_id: null, atualizado_em: new Date(Date.now() - 3_600_000).toISOString() }],
      } as any,
    ]);
    expect((await q('select responsavel_id from atendimento_chamado where id = $1', [id]))[0].responsavel_id).toBe(ana);
  });
});

// O lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever`, avaliada aqui a
// partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta (como em cartao-estado-final.spec).
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

descrever('caso resolvido — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  const esquema = `teste_chamado_${Date.now()}`;
  const aplicar = (linha: any) =>
    q(
      `insert into atendimento_chamado (id, status, responsavel_id, atualizado_em) values ($1,$2,$3,$4)
       on conflict (id) do update set status = excluded.status, responsavel_id = excluded.responsavel_id,
                                      atualizado_em = excluded.atualizado_em${condicao}`,
      [linha.id, linha.status, linha.responsavel_id ?? null, linha.atualizado_em],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table atendimento_chamado (id uuid primary key, status text not null, responsavel_id uuid, atualizado_em timestamptz)`);
    condicao = condicaoDoDaemon()('atendimento_chamado', new Set(['id', 'status', 'responsavel_id', 'atualizado_em']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it('resolvido na loja não reabre por uma cópia da nuvem ainda aberta (mesmo mais nova)', async () => {
    const id = randomUUID();
    await aplicar({ id, status: 'resolvido', atualizado_em: new Date(Date.now() - 3_600_000) });
    await aplicar({ id, status: 'aberto', atualizado_em: new Date() });
    expect((await q('select status from atendimento_chamado where id = $1', [id]))[0].status).toBe('resolvido');
  });

  it('o resolvido da nuvem entra; e o aberto da nuvem entra como sempre (o chamado não tem LWW aqui)', async () => {
    const id = randomUUID();
    const ana = randomUUID();
    await aplicar({ id, status: 'aberto', atualizado_em: new Date() });
    await aplicar({ id, status: 'aberto', responsavel_id: ana, atualizado_em: new Date(Date.now() - 60_000) });
    expect((await q('select responsavel_id from atendimento_chamado where id = $1', [id]))[0].responsavel_id).toBe(ana);
    await aplicar({ id, status: 'resolvido', atualizado_em: new Date(Date.now() - 3_600_000) });
    expect((await q('select status from atendimento_chamado where id = $1', [id]))[0].status).toBe('resolvido');
  });

  it('a regra do resolvido só vale para o chamado (o cartão e a comanda seguem com as delas)', () => {
    const doCartao = condicaoDoDaemon()('producao_pedido', new Set(['id', 'status', 'updated_at']));
    expect(doCartao).not.toContain(`'resolvido'`);
  });
});
