import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FinanceiroService } from './financeiro.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CAIXA NÃO MUDA ENQUANTO FECHA — contra Postgres (TEST_PG_URL). Achados da revisão do PDV de 24/11/2026 (C-01 a C-06):
// o fechamento somava os lançamentos e gravava sem travar o caixa, então um lançamento que chegava no meio ficava fora do
// esperado ou entrava num caixa já fechado; dois fechamentos juntos gravavam duas vezes; dois "abrir" juntos abriam dois caixas
// no mesmo terminal; o fechamento do delivery (um caixa para a empresa) só olhava as entregas da loja selecionada; e a
// sangria acima do dinheiro esperado passava sem rastro. Os testes que seguram uma trava esperam pela sessão presa ATRÁS da
// conexão do teste (`pg_blocking_pids`, V72), nunca por tempo.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('caixa-concorrencia-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('o caixa não muda enquanto fecha (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 14 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const producaoFalsa = { imprimirCupomCaixa: async () => ({ enfileirados: 0, aviso: null }) } as any;
  const financeiro = new FinanceiroService(db, auditoria, producaoFalsa);
  const eventos = new EventEmitter2();
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  let presidente: string;
  let gerente: string;
  let operador: string;
  let lojaA: string;
  let lojaB: string;
  let produto: string;
  const varias = <R>(n: number, f: () => Promise<R>) => Promise.allSettled(Array.from({ length: n }, f));
  const novoTerminal = async (nome: string) =>
    (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'pdv', $3, $4) returning id`, [T, lojaA, nome, randomUUID()]))[0].id as string;
  const abrir = async (terminalId: string, valorAbertura = 100) => (await financeiro.abrirSessao(T, operador, { terminalId, valorAbertura })) as any;
  const lancamentosDa = (sessao: string) => q(`select tipo, valor::text as valor, categoria from lancamento_caixa where sessao_id = $1 order by created_at`, [sessao]);
  /** Uma conexão do teste com a transação aberta (para segurar a trava) e o número dela no banco. */
  const conexaoComTransacao = async (): Promise<{ c: PoolClient; pid: number }> => {
    const c = await pool.connect();
    await c.query('begin');
    const [{ pid }] = (await c.query('select pg_backend_pid() as pid')).rows;
    return { c, pid };
  };
  /** Espera alguma sessão ficar presa atrás da conexão `pid` do teste. `false` se ninguém prendeu em ~3 s (o código antigo). */
  const esperarPresoAtras = async (pid: number) => {
    for (let i = 0; i < 60; i++) {
      const [{ n }] = await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [pid]);
      if (n > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  beforeAll(async () => {
    // Tabelas só da nuvem que a venda consulta (servidor da loja ligado?) e que o banco do CI, montado como loja, não tem.
    const criar = (s: string) => pool.query(s).catch((e: any) => {
      if (!['23505', '42P07'].includes(e?.code)) throw e;
    });
    await criar(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid,
                   unidade_id uuid, recebido_em timestamptz not null default now())`);
    await criar(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
                   ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
                   disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
                   recebido_em timestamptz not null default now())`);
    await q(`insert into empresa (id, nome) values ($1, 'teste caixa concorrente')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    const funcao = async (nome: string, categoria: string) =>
      (await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [T, nome, categoria]))[0].id;
    const pessoa = async (nome: string, f: string) => (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [T, nome, f]))[0].id;
    presidente = await pessoa('Ana', await funcao('Presidente', 'presidente'));
    gerente = await pessoa('Bruno', await funcao('Gerente', 'gerente'));
    operador = await pessoa('Caio', await funcao('Caixa', 'execucao'));
    [{ id: produto }] = await q(`insert into produto (tenant_id, nome, preco_venda) values ($1, 'X-burguer', 25) returning id`, [T]);
    await financeiro.setCaixaLivre(T, true); // o operador sangra e supre sem pedir o gerente
    // O pool já com as conexões abertas: senão os pedidos "ao mesmo tempo" saem um por vez e a corrida passa por sorte (V98).
    await Promise.all(Array.from({ length: 12 }, () => pool.query('select pg_sleep(0.05)')));
  });
  afterAll(async () => {
    for (const t of ['producao_pedido', 'comanda_item', 'lancamento_caixa', 'comanda', 'pedido_externo', 'caixa_sessao', 'equipamento', 'entitlement', 'produto', 'colaborador', 'funcao', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('C-02: dois fechamentos juntos do mesmo caixa — um fecha, o outro é recusado, e a auditoria e a contagem são as do primeiro', async () => {
    const terminal = await novoTerminal('Caixa C-02');
    const s = await abrir(terminal);
    const antes = auditados.filter((a) => a.acao === 'fechou_caixa').length;
    const contagens = [100, 95, 90, 85];
    const r = await Promise.allSettled(contagens.map((v) => financeiro.fecharSessao(T, operador, 'execucao', { valoresInformados: { dinheiro: v }, terminalId: terminal })));
    const ok = r.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(1);
    expect(auditados.filter((a) => a.acao === 'fechou_caixa').length - antes).toBe(1);
    const [gravada] = await q(`select status, valor_informado::numeric::float8 as informado from caixa_sessao where id = $1`, [s.id]);
    expect(gravada).toEqual({ status: 'fechada', informado: ok[0].value.informado });
  });

  it('C-01: o fechamento espera o lançamento que está sendo gravado e o conta no esperado', async () => {
    const terminal = await novoTerminal('Caixa C-01a');
    const s = await abrir(terminal);
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(
        `insert into lancamento_caixa (tenant_id, unidade_id, sessao_id, tipo, valor, data, categoria, forma) values ($1, $2, $3, 'entrada', 30, current_date, 'suprimento', 'dinheiro')`,
        [T, lojaA, s.id],
      );
      const fechando = financeiro.fecharSessao(T, operador, 'execucao', { valoresInformados: { dinheiro: 130 }, terminalId: terminal });
      fechando.catch(() => undefined);
      await esperarPresoAtras(pid);
      await c.query('commit');
      const r: any = await fechando;
      expect(r.esperado).toBe(130);
      expect(r.diferenca).toBe(0);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('C-01: o suprimento que chega enquanto outro fechamento segura o caixa espera e é recusado — nada entra no caixa fechado', async () => {
    const terminal = await novoTerminal('Caixa C-01b');
    const s = await abrir(terminal);
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(`select id from caixa_sessao where id = $1 for update`, [s.id]);
      await c.query(`update caixa_sessao set status = 'fechada', fechada_em = now() where id = $1`, [s.id]);
      const supre = financeiro.movimentarCaixa(T, operador, 'execucao', { tipo: 'suprimento', valor: 30, terminalId: terminal });
      supre.catch(() => undefined);
      await esperarPresoAtras(pid);
      await c.query('commit');
      await expect(supre).rejects.toThrow(/Nenhum caixa aberto/);
      expect(await lancamentosDa(s.id)).toEqual([]);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('C-01: a venda do balcão que chega enquanto o caixa fecha espera e é recusada — nenhuma venda no caixa fechado', async () => {
    const terminal = await novoTerminal('Caixa C-01c');
    const s = await abrir(terminal);
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(`select id from caixa_sessao where id = $1 for update`, [s.id]);
      await c.query(`update caixa_sessao set status = 'fechada', fechada_em = now() where id = $1`, [s.id]);
      const venda = vendas.vendaBalcao(T, operador, 'execucao', { itens: [{ produtoId: produto, quantidade: 1 }], forma: 'dinheiro' } as any, terminal);
      venda.catch(() => undefined);
      await esperarPresoAtras(pid);
      await c.query('commit');
      await expect(venda).rejects.toThrow(/Abra o caixa/);
      expect(await lancamentosDa(s.id)).toEqual([]);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('C-06: quatro "abrir" juntos no mesmo terminal abrem um caixa só; dois terminais juntos ganham turnos diferentes', async () => {
    const terminal = await novoTerminal('Caixa C-06a');
    const r = await varias(4, () => abrir(terminal, 0));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await q(`select id from caixa_sessao where terminal_id = $1 and status = 'aberta'`, [terminal])).toHaveLength(1);
    const [t1, t2, t3] = await Promise.all([novoTerminal('Caixa C-06b'), novoTerminal('Caixa C-06c'), novoTerminal('Caixa C-06d')]);
    await Promise.all([abrir(t1, 0), abrir(t2, 0), abrir(t3, 0)]);
    const repetidos = await q(
      `select turno_numero from caixa_sessao where tenant_id = $1 and origem = 'pdv' and (aberta_em at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date group by turno_numero having count(*) > 1`,
      [T],
    );
    expect(repetidos).toEqual([]);
  });

  it('C-04: sangria acima do dinheiro esperado na gaveta fica marcada na auditoria (a contagem continua cega: a tela não mostra o esperado)', async () => {
    const terminal = await novoTerminal('Caixa C-04');
    const s = await abrir(terminal, 100);
    await financeiro.movimentarCaixa(T, operador, 'execucao', { tipo: 'sangria', valor: 60, terminalId: terminal });
    await financeiro.movimentarCaixa(T, operador, 'execucao', { tipo: 'sangria', valor: 40, terminalId: terminal }); // o valor exato
    await financeiro.movimentarCaixa(T, operador, 'execucao', { tipo: 'sangria', valor: 120, terminalId: terminal });
    const sangrias = auditados.filter((a) => a.acao === 'sangria' && a.entidadeId === s.id).map((a) => a.detalhe);
    expect(sangrias.map((d) => [d.valor, d.acimaDoEsperado === true])).toEqual([
      [60, false],
      [40, false],
      [120, true],
    ]);
    expect(sangrias[2].esperadoNaGaveta).toBe(0);
  });

  it('C-04: duas sangrias juntas que somadas passam do esperado — a segunda já enxerga a primeira', async () => {
    const terminal = await novoTerminal('Caixa C-04b');
    const s = await abrir(terminal, 100);
    await Promise.all([70, 70].map((valor) => financeiro.movimentarCaixa(T, operador, 'execucao', { tipo: 'sangria', valor, terminalId: terminal })));
    const marcadas = auditados.filter((a) => a.acao === 'sangria' && a.entidadeId === s.id).map((a) => a.detalhe.acimaDoEsperado === true);
    expect(marcadas.sort()).toEqual([false, true]);
  });

  it('C-03: o caixa do delivery é da empresa — a entrega pendente de OUTRA loja também barra o fechamento', async () => {
    const s: any = await financeiro.abrirSessao(T, operador, { origem: 'delivery' });
    await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, criado_em, unidade_id, cliente_nome) values ($1, 'anotaai', 'entrega', 'confirmado', 30, now() - interval '1 hour', $2, 'Cliente teste')`,
      [T, lojaB],
    );
    await expect(
      financeiro.fecharSessao(T, operador, 'execucao', { valoresInformados: {}, origem: 'delivery', unidadeAtual: lojaA }),
    ).rejects.toMatchObject({ response: expect.objectContaining({ codigo: 'PENDENCIAS_DO_TURNO', total: 1 }) });
    // O gerente fecha justificando, e a auditoria conta a entrega da outra loja.
    await financeiro.fecharSessao(T, gerente, 'gerente', {
      valoresInformados: {},
      origem: 'delivery',
      unidadeAtual: lojaA,
      justificativaPendencias: 'Entrega da outra loja presa no canal, conferida por telefone',
    });
    const just = auditados.find((a) => a.acao === 'fechou_turno_com_pendencias' && a.entidadeId === s.id);
    expect(just?.detalhe.total).toBe(1);
    void presidente;
  });
});
