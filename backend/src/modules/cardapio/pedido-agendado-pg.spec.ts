import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { AvisoAgendadoProcessor } from '../delivery/aviso-agendado.processor';
import { CardapioService } from './cardapio.service';
import { emSaoPaulo } from '../../common/pedido-agendado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO AGENDADO (mig 455, D4) contra Postgres (TEST_PG_URL), pelas portas de verdade: `setConfig` (os ajustes), `menu`
// (o checkout), `janelasDoAgendado` (o "Para quando?"), `receberPedido` (o pedido: a janela, o só Pix, a marca e o limite
// com a corrida FORÇADA — V98), a rotina do "entrou em preparo" e o horário do cartão do KDS.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-agendado-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

/** A próxima janela de 15 min a pelo menos `min` minutos daqui, no texto de São Paulo. */
function janelaDaqui(min: number): string {
  const passo = 15 * 60_000;
  return emSaoPaulo(new Date(Math.ceil((Date.now() + min * 60_000) / passo) * passo)).diaHora;
}

descrever('pedido agendado (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const aceitos: string[] = [];
  // A gravação do pedido como a do Delivery grava o que o agendado usa (agendamento e retirada_tipo).
  const delivery = {
    ingest: async (tenantId: string, unidadeId: string | null, canal: string, n: any, x: any) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total,
             forma_pagamento, status, status_pagamento, agendamento, retirada_tipo)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'novo',$12,$13,$14) returning *`,
          [tenantId, unidadeId, canal, x.clientRef ?? randomUUID(), n.displayId, n.cliente, n.clienteTelefone, n.tipo, JSON.stringify(n.itens), n.total,
            n.formaPagamento, x.statusPagamento ?? null, x.agendamento ? new Date(x.agendamento) : null, x.retiradaTipo ?? null],
        )
      ).map((r: any) => ({ ...r, id: r.id, status: r.status, unidadeId: r.unidade_id }))[0],
    aceitar: async (_t: string, _u: any, id: string) => {
      aceitos.push(id);
      await q(`update pedido_externo set status = 'confirmado' where id = $1`, [id]);
    },
  } as any;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any, auditoria);
  const antes = { edge: process.env.EDGE_MODE, segredo: process.env.CLIENTE_TOKEN_SECRET };

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    if (!process.env.JWT_SECRET && !antes.segredo) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (antes.segredo === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = antes.segredo;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'cliente',
        'cardapio_config', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  /** Uma loja sem horário cadastrado (sempre aberta), retirada ligada, Pix online no cardápio, agendado ligado com o limite. */
  async function loja(limite: number | null = 4) {
    const t = (await q(`insert into empresa (nome) values ('teste pedido agendado') returning id`))[0].id as string;
    empresas.push(t);
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,'Trio 07',$2,41.9,false,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    const token = `tk-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, modo, tipo_delivery, tipo_retirada, pagamentos, tempo_entrega_min, tempo_retirada_min)
       values ($1,$2,true,'retirada',true,true,'["pix","entrega"]'::jsonb,40,20)`,
      [t, token],
    );
    await cardapio.setConfig(t, null, { agendadoAtivo: true, agendadoAntecedenciaMin: 45, agendadoDias: 1, agendadoLimiteJanela: limite });
    return { t, token, lanche };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const pedir = (l: Loja, agendamento: string, forma = 'pix', extra: any = {}) =>
    cardapio.receberPedido(l.token, {
      tipo: 'retirada',
      cliente: 'Ana',
      telefone: `55219${Math.floor(10000000 + Math.random() * 89999999)}`,
      formaPagamento: forma,
      itens: [{ produtoId: l.lanche, quantidade: 1 } as any],
      agendamento,
      modoAgendamento: 'agendado',
      ...extra,
    } as any);

  it('os ajustes: ligar e as listas (fora da lista = recusa); o menu manda o agendado só ligado', async () => {
    const l = await loja();
    await expect(cardapio.setConfig(l.t, null, { agendadoAntecedenciaMin: 50 })).rejects.toThrow('Antecedência mínima: escolha uma das opções da lista.');
    await expect(cardapio.setConfig(l.t, null, { agendadoLimiteJanela: 5 })).rejects.toThrow('Limite de pedidos por janela');
    await cardapio.setConfig(l.t, null, { agendadoLimiteJanela: null });
    expect((await q(`select agendado_ativo, agendado_limite_janela from cardapio_config where tenant_id = $1`, [l.t]))[0]).toEqual({
      agendado_ativo: true,
      agendado_limite_janela: null,
    });
    const menu: any = await cardapio.menu(l.token);
    expect(menu.loja.agendado).toMatchObject({ ativo: true, janelaMin: 15, pixObrigatorio: true });
    expect(menu.loja.agendado.dias).toHaveLength(2);
    await cardapio.setConfig(l.t, null, { agendadoAtivo: false });
    expect(((await cardapio.menu(l.token)) as any).loja.agendado).toBeNull();
  });

  it('o pedido agendado: a janela vira o instante de São Paulo, marca "agendado", só Pix, fica fora da cozinha até pagar', async () => {
    const l = await loja();
    const j = janelaDaqui(90);
    await expect(pedir(l, j, 'entrega')).rejects.toThrow('O pedido agendado é pago no Pix');
    const r: any = await pedir(l, j, 'pix');
    const [p] = await q(`select agendamento, retirada_tipo, status, status_pagamento from pedido_externo where id = $1`, [r.pedidoId ?? r.id]);
    expect(emSaoPaulo(new Date(p.agendamento)).diaHora).toBe(j);
    expect(p).toMatchObject({ retirada_tipo: 'agendado', status: 'novo', status_pagamento: 'aguardando' });
    expect(aceitos).not.toContain(r.pedidoId ?? r.id);
    // A janela fora da grade e o dia fora do permitido são recusados.
    await expect(pedir(l, `${j.slice(0, 14)}07`)).rejects.toThrow('não está disponível');
    await expect(pedir(l, '2030-01-01T19:00')).rejects.toThrow('O pedido agendado vale até amanhã.');
  });

  it('as janelas: a ocupação conta só os agendados vivos da janela (a encomenda e o cancelado não)', async () => {
    const l = await loja(2);
    const j = janelaDaqui(120);
    await pedir(l, j);
    const outro: any = await pedir(l, j);
    await q(`update pedido_externo set status = 'cancelado' where id = $1`, [outro.pedidoId ?? outro.id]);
    await q(
      `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, tipo, itens, total, status, agendamento, retirada_tipo)
       values ($1,'cardapio',$2,'9','Bia','retirada','[]'::jsonb,10,'novo',(select agendamento from pedido_externo where id = $3),'encomenda')`,
      [l.t, randomUUID(), outro.pedidoId ?? outro.id],
    );
    const cfg = (await q(`select * from cardapio_config where tenant_id = $1`, [l.t]))[0];
    const r: any = await cardapio.janelasDoAgendado(
      { ...cfg, tenantId: l.t, agendadoAtivo: true, agendadoAntecedenciaMin: 45, agendadoDias: 1, agendadoLimiteJanela: 2, tempoEntregaMin: 40, tempoRetiradaMin: 20 },
      j.slice(0, 10),
      'retirada',
    );
    expect(r.janelas.find((x: any) => x.valor === j)).toMatchObject({ ocupados: 1, esgotada: false });
    // A capacidade da ENCOMENDA não conta o agendado.
    expect(await (cardapio as any).contarEncomendasNaData(l.t, null, j.slice(0, 10))).toBe(1);
  });

  it('V98: dois pedidos ao mesmo tempo na última vaga — um entra, o outro é desfeito e recusado (a corrida é forçada)', async () => {
    const l = await loja(2);
    const j = janelaDaqui(150);
    await pedir(l, j); // a primeira vaga já está ocupada: sobra uma
    // Segura as duas gravações até as duas chegarem e solta juntas: as duas passaram pela contagem de antes.
    const original = pool.query;
    let chegaram = 0;
    let soltar!: () => void;
    const solta = new Promise<void>((r) => (soltar = r));
    const prazo = setTimeout(() => soltar(), 3000);
    (pool as any).query = async function (this: any, ...args: any[]) {
      const t = typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? '');
      if (/insert into pedido_externo/.test(t) && /retirada_tipo/.test(t)) {
        if (++chegaram >= 2) soltar();
        await solta;
      }
      return (original as any).apply(pool, args);
    };
    let r: PromiseSettledResult<any>[] = [];
    try {
      r = await Promise.allSettled([pedir(l, j), pedir(l, j)]);
    } finally {
      clearTimeout(prazo);
      (pool as any).query = original;
    }
    expect(chegaram).toBe(2);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const recusa = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(String(recusa.reason?.message)).toContain('acabou de encher');
    const vivos = await q(`select count(*)::int as n from pedido_externo where tenant_id = $1 and retirada_tipo = 'agendado' and status <> 'cancelado'`, [l.t]);
    expect(vivos[0].n).toBe(2);
  });

  it('a rotina do "entrou em preparo": escolhe quem já começou, marca uma vez só e chama o aviso', async () => {
    const l = await loja();
    const ins = (agendamentoSql: string, status = 'confirmado', tipo = 'retirada') =>
      q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, tipo, itens, total, status, agendamento, retirada_tipo)
         values ($1,'cardapio',$2,'1','Ana',$3,'[]'::jsonb,10,$4,${agendamentoSql},'agendado') returning id`,
        [l.t, randomUUID(), tipo, status],
      ).then((x) => x[0].id as string);
    const comecou = await ins(`now() + interval '15 minutes'`); // retirada: 20 min antes → já começou
    const cedo = await ins(`now() + interval '90 minutes'`);
    const naoAceito = await ins(`now() + interval '10 minutes'`, 'novo');
    const avisados: string[] = [];
    const proc = new AvisoAgendadoProcessor(db, { avisarAgendadoEmPreparo: async (_t: string, id: string) => void avisados.push(id) } as any);
    const daLoja = async () => (await proc.agendadosEmPreparo()).filter((p) => p.tenantId === l.t).map((p) => p.id);
    expect(await daLoja()).toEqual([comecou]);
    await proc.avisarEmPreparo();
    expect(avisados).toContain(comecou);
    expect(avisados).not.toContain(cedo);
    expect(avisados).not.toContain(naoAceito);
    expect(await daLoja()).toEqual([]); // marcado: a volta seguinte não repete
  });

  it('o KDS: o cartão do agendado começa no tempo de retirada antes do horário e diz "Agendado"', async () => {
    const l = await loja();
    const comanda = (await q(`insert into comanda (tenant_id, status) values ($1, 'aberta') returning id`, [l.t]))[0].id as string;
    await q(
      `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, tipo, itens, total, status, agendamento, retirada_tipo, comanda_id)
       values ($1,'cardapio',$2,'1','Ana','retirada','[]'::jsonb,10,'confirmado','2026-11-18T22:30:00Z','agendado',$3)`,
      [l.t, randomUUID(), comanda],
    );
    const m: Map<string, any> = await (producao as any).encomendaDasComandas(l.t, [comanda]);
    expect(m.get(comanda)).toEqual({ para: '2026-11-18T22:30:00.000Z', comeca: '2026-11-18T22:10:00.000Z', agendado: true });
  });
});
