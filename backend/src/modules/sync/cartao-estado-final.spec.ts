import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CARTÃO DO KDS EM ESTADO FINAL NÃO REABRE (auditoria do KDS, 20/10/2026; correção escolhida pelo dono). O sincronismo
// é última-escrita-vence pela data: um cartão fechado de um lado voltava para a fila quando a outra ponta mandava a cópia
// "mais nova" ainda ativa (a cozinha tocou nele antes de o fechamento chegar), e um cancelamento do canal se perdia sob
// um "entregue". Agora, nos DOIS sentidos: entregue/cancelado não volta à fila, e cancelado vence entregue. Postgres real.
// Auditoria do KDS de 11/11/2026: o cancelado vence MESMO MAIS VELHO (O14), e o PEDIDO DE CANAL ganhou a mesma proteção —
// concluido > cancelado > os demais, ignorando a data (O3: o canal cancela na nuvem e a loja aceita segundos depois).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cartao-estado-final.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');
// Cada caso: situação deste lado → a outra ponta manda (mais nova) → o que fica.
const CASOS: [string, string, string][] = [
  ['entregue', 'preparo', 'entregue'], // fechado não volta à fila
  ['cancelado', 'pronto', 'cancelado'], // cancelado não volta à fila
  ['cancelado', 'entregue', 'cancelado'], // cancelado vence entregue
  ['entregue', 'cancelado', 'cancelado'], // ... nos dois sentidos
  ['recebido', 'preparo', 'preparo'], // cartão na fila: o LWW de sempre
];
// O14 (auditoria do KDS, 11/11/2026): o CANCELADO vence mesmo MAIS VELHO — o canal cancelou e a venda foi desfeita de um
// lado enquanto o outro mexia no cartão (ou batia "entregue") com a data mais nova. O resto segue o LWW.
const CASOS_MAIS_VELHA: [string, string, string][] = [
  ['entregue', 'cancelado', 'cancelado'], // cancelado vence entregue, mesmo mais velho
  ['preparo', 'cancelado', 'cancelado'], // e vence a fila
  ['cancelado', 'entregue', 'cancelado'], // o cancelado não sai
  ['recebido', 'preparo', 'recebido'], // fila × fila: a mais velha não sobrescreve
  ['preparo', 'entregue', 'preparo'], // entregue mais velho: o LWW de sempre (o fechamento não ganha precedência)
];

// PEDIDO DE CANAL — PRECEDÊNCIA DOS ESTADOS FINAIS (auditoria do KDS, 11/11/2026, O3): concluido > cancelado > os demais,
// IGNORANDO a data, nos dois sentidos. Cada caso: situação deste lado → a outra ponta manda (mais nova | mais velha) → fica.
const CASOS_PEDIDO: [string, string, 'mais nova' | 'mais velha', string][] = [
  ['cancelado', 'confirmado', 'mais nova', 'cancelado'], // O3: o aceite de um lado não desfaz o cancelamento do outro
  ['cancelado', 'pronto', 'mais nova', 'cancelado'],
  ['confirmado', 'cancelado', 'mais velha', 'cancelado'], // O3: o cancelamento entra mesmo mais velho
  ['despachado', 'cancelado', 'mais velha', 'cancelado'],
  ['cancelado', 'concluido', 'mais velha', 'concluido'], // concluido vence cancelado, mesmo mais velho
  ['concluido', 'cancelado', 'mais nova', 'concluido'], // ... e o cancelado não tira o concluido
  ['concluido', 'despachado', 'mais nova', 'despachado'], // concluido reaberto (`voltarPedido`): segue pela data
  ['confirmado', 'pronto', 'mais nova', 'pronto'], // não final × não final: o LWW de sempre
  ['pronto', 'confirmado', 'mais velha', 'pronto'],
  ['confirmado', 'novo', 'mais nova', 'confirmado'], // não volta a "novo" (ERR-280)
];
const UMA_HORA = 3600_000;
// A outra ponta: "mais nova" = agora; "mais velha" = 2 h atrás (este lado fica com 1 h atrás).
const dataDaOutraPonta = (idade: 'mais nova' | 'mais velha') => new Date(Date.now() - (idade === 'mais nova' ? 0 : 2 * UMA_HORA));

descrever('cartão do KDS em estado final — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste cartao estado final')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from producao_pedido where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS)('nuvem "%s", a loja manda "%s" mais nova → fica "%s"', async (aqui, daLoja, fica) => {
    const id = randomUUID();
    await q(
      `insert into producao_pedido (id, tenant_id, destino_tipo, origem, status) values ($1,$2,'kds','delivery',$3)`,
      [id, T, aqui],
    );
    // updated_at de uma hora atrás (fora da sessão de sincronização o gatilho grava "agora"; dentro, mantém).
    await q(`begin; select set_config('regem.sync','on',true);
             update producao_pedido set updated_at = now() - interval '1 hour' where id = '${id}'; commit;`);
    // A cópia que a loja manda: a linha inteira (como o `select *` do daemon), em JSON, mais nova.
    const linha = JSON.parse(JSON.stringify((await q('select * from producao_pedido where id = $1', [id]))[0]));
    await svc.push(ctx() as any, [{ tabela: 'producao_pedido', linhas: [{ ...linha, status: daLoja, updated_at: new Date().toISOString() }] } as any]);
    expect((await q('select status from producao_pedido where id = $1', [id]))[0].status).toBe(fica);
  });

  it.each(CASOS_MAIS_VELHA)('nuvem "%s", a loja manda "%s" MAIS VELHA → fica "%s"', async (aqui, daLoja, fica) => {
    const id = randomUUID();
    await q(
      `insert into producao_pedido (id, tenant_id, destino_tipo, origem, status) values ($1,$2,'kds','delivery',$3)`,
      [id, T, aqui],
    );
    await q(`begin; select set_config('regem.sync','on',true);
             update producao_pedido set updated_at = now() - interval '1 hour' where id = '${id}'; commit;`);
    const linha = JSON.parse(JSON.stringify((await q('select * from producao_pedido where id = $1', [id]))[0]));
    await svc.push(ctx() as any, [
      { tabela: 'producao_pedido', linhas: [{ ...linha, status: daLoja, updated_at: dataDaOutraPonta('mais velha').toISOString() }] } as any,
    ]);
    expect((await q('select status from producao_pedido where id = $1', [id]))[0].status).toBe(fica);
  });
});

descrever('pedido de canal em estado final — a nuvem recebendo da loja (push)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste pedido estado final')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from pedido_externo where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS_PEDIDO)('nuvem "%s", a loja manda "%s" (%s) → fica "%s"', async (aqui, daLoja, idade, fica) => {
    const id = randomUUID();
    await q(`insert into pedido_externo (id, tenant_id, canal, external_id, status) values ($1,$2,'ifood',$3,$4)`, [
      id, T, randomUUID(), aqui,
    ]);
    await q(`begin; select set_config('regem.sync','on',true);
             update pedido_externo set updated_at = now() - interval '1 hour' where id = '${id}'; commit;`);
    // A cópia da loja: a linha inteira (o `select *` do daemon), em JSON.
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_externo where id = $1', [id]))[0]));
    await svc.push(ctx() as any, [
      { tabela: 'pedido_externo', linhas: [{ ...linha, status: daLoja, updated_at: dataDaOutraPonta(idade).toISOString() }] } as any,
    ]);
    expect((await q('select status from pedido_externo where id = $1', [id]))[0].status).toBe(fica);
  });
});

// O mesmo lado do SERVIDOR DA LOJA (pull e restore do sync-daemon): a regra mora em `condicaoSobrescrever`, avaliada
// aqui a partir do TEXTO do arquivo — é exatamente o SQL que o daemon monta (como em revogacao-absorvente.spec).
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

descrever('cartão do KDS em estado final — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  // Uma tabela "producao_pedido" num schema próprio: a regra olha o nome da tabela.
  const esquema = `teste_cartao_${Date.now()}`;
  const colunas = ['id', 'status', 'updated_at'];
  const aplicar = (linha: any) =>
    q(
      `insert into producao_pedido (id, status, updated_at) values ($1,$2,$3)
       on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at${condicao}`,
      [linha.id, linha.status, linha.updated_at],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table producao_pedido (id uuid primary key, status text not null, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('producao_pedido', new Set(colunas));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS)('loja "%s", a nuvem manda "%s" mais nova → fica "%s"', async (aqui, daNuvem, fica) => {
    const id = randomUUID();
    await aplicar({ id, status: aqui, updated_at: new Date(Date.now() - 3600_000) });
    await aplicar({ id, status: daNuvem, updated_at: new Date() });
    expect((await q('select status from producao_pedido where id = $1', [id]))[0].status).toBe(fica);
  });

  it.each(CASOS_MAIS_VELHA)('loja "%s", a nuvem manda "%s" MAIS VELHA → fica "%s"', async (aqui, daNuvem, fica) => {
    const id = randomUUID();
    await aplicar({ id, status: aqui, updated_at: new Date(Date.now() - UMA_HORA) });
    await aplicar({ id, status: daNuvem, updated_at: dataDaOutraPonta('mais velha') });
    expect((await q('select status from producao_pedido where id = $1', [id]))[0].status).toBe(fica);
  });

  it('linha da nuvem mais velha não sobrescreve, como sempre', async () => {
    const id = randomUUID();
    await aplicar({ id, status: 'preparo', updated_at: new Date() });
    await aplicar({ id, status: 'recebido', updated_at: new Date(Date.now() - 3600_000) });
    expect((await q('select status from producao_pedido where id = $1', [id]))[0].status).toBe('preparo');
  });

  it('a regra do cartão só vale para producao_pedido (a comanda segue com a dela)', () => {
    const daComanda = condicaoDoDaemon()('comanda', new Set(['id', 'status', 'updated_at']));
    expect(daComanda).toContain(`'fechada','cancelada'`);
    expect(daComanda).not.toContain(`= 'cancelado'`);
  });
});

descrever('pedido de canal em estado final — o servidor da loja recebendo da nuvem (pull)', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let condicao: string;
  // Uma tabela "pedido_externo" num schema próprio: a regra olha o nome da tabela.
  const esquema = `teste_pedido_final_${Date.now()}`;
  const aplicar = (linha: any) =>
    q(
      `insert into pedido_externo (id, status, updated_at) values ($1,$2,$3)
       on conflict (id) do update set status = excluded.status, updated_at = excluded.updated_at${condicao}`,
      [linha.id, linha.status, linha.updated_at],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema}` });
    await q(`create schema ${esquema}`);
    await q(`create table pedido_externo (id uuid primary key, status text not null, updated_at timestamptz)`);
    condicao = condicaoDoDaemon()('pedido_externo', new Set(['id', 'status', 'updated_at']));
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`drop schema if exists ${esquema} cascade`).catch(() => undefined);
    await pool.end();
  });

  it.each(CASOS_PEDIDO)('loja "%s", a nuvem manda "%s" (%s) → fica "%s"', async (aqui, daNuvem, idade, fica) => {
    const id = randomUUID();
    await aplicar({ id, status: aqui, updated_at: new Date(Date.now() - UMA_HORA) });
    await aplicar({ id, status: daNuvem, updated_at: dataDaOutraPonta(idade) });
    expect((await q('select status from pedido_externo where id = $1', [id]))[0].status).toBe(fica);
  });
});
