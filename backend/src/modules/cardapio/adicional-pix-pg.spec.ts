import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { assinarConversa } from '../../common/conversa-do-robo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CashbackService } from '../cashback/cashback.service';
import { DeliveryService } from '../delivery/delivery.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';
import { RoboPedidoService } from './robo-pedido.service';
import { AdicionalPixService } from './adicional-pix.service';
import { alertasDoAdicionalPix } from './adicional-pix-alertas';
import { EstornoPixService } from './estorno-pix.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ROBÔ PÕE ITEM NO PEDIDO JÁ PAGO NO PIX (mig 373), de ponta a ponta contra Postgres (TEST_PG_URL), como NUVEM: a venda,
// a cozinha, o caixa e as vias de verdade (a MESMA alteração da equipe); o gateway e o WhatsApp de mentira. O que se prova:
// com o ajuste desligado o pago vai para a equipe; ligado, a conferência traz o Pix da diferença; o "Mandar o Pix" manda o
// aviso e o código e liga o alerta "segure o pedido"; o pagamento põe o item — e o total do pedido, a venda e o lançamento
// do caixa sobem juntos, com o adicional como pagamento já feito; o Pix que vence fecha; o pago que não entra (vencido, o
// pedido saiu, a loja recusou) volta sozinho; o cancelamento depois devolve os DOIS Pix; uma vez só com duas réplicas.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('adicional-pix-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
// As do robô, do estorno e do adicional são só da nuvem: o banco do CI é o de uma loja (ERR-273).
const DA_NUVEM = [
  '342_robo_pausa_e_config.sql',
  '344_robo_carrinho.sql',
  '345_robo_carrinho_conducao.sql',
  '349_lembrete_do_carrinho.sql',
  '352_conferir_entrega.sql',
  '361_robo_carrinho_repetido.sql',
  '363_robo_mudanca_do_pedido.sql',
  '372_pedido_estorno.sql',
  '373_pedido_adicional_pix.sql',
];
const SENHA = 'senha-do-robo-de-teste';
const umCelular = () => `55219${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

descrever('o robô põe item no pedido já pago no Pix (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditoria = { registrar: async () => undefined } as any;
  const eventosEmitidos: { n: string; p: any }[] = [];
  const eventos = {
    emit: (n: string, p: any) => {
      eventosEmitidos.push({ n, p });
      return true;
    },
  } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const cashback = new CashbackService(db);
  const beneficio = () => new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new (DeliveryService as any)(
    db, vendas, producao, cashback, beneficio(), eventos, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
  ) as DeliveryService;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), cashback, eventos, {} as any);
  // O GATEWAY de mentira (as quatro chamadas que o Pix do adicional faz).
  const gw = {
    criados: [] as any[],
    pagos: new Set<string>(),
    cancelados: [] as string[],
    estornos: [] as string[],
    falharEstorno: false,
  };
  (cardapio as any).cobrarPixAvulso = async (_t: string, a: any) => {
    gw.criados.push(a);
    return { provider: 'mercadopago', id: `pix-${a.referencia}`, copiaECola: `00020126PIX${String(a.valor).replace('.', '')}CODIGO` };
  };
  (cardapio as any).situacaoDoPixAvulso = async (_t: string, _p: string, id: string) => (gw.pagos.has(id) ? 'pago' : 'aguardando');
  (cardapio as any).cancelarPixAvulso = async (_t: string, _p: string, id: string) => void gw.cancelados.push(id);
  (cardapio as any).reembolsarPagamentoTotal = async (_t: string, _p: string, id: string) => {
    if (gw.falharEstorno) throw new Error('Mercado Pago refund 400: saldo insuficiente');
    gw.estornos.push(id);
    return { id: `est-${id}`, status: 'approved' };
  };
  const enviados: { para: string; texto: string; opcoes?: string[] }[] = [];
  const whats = { enviar: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }) } as any;
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }),
    enviarOpcoes: async (_t: string, para: string, texto: string, ops: any[]) => void enviados.push({ para, texto, opcoes: ops.map((o) => o.titulo) }),
  } as any;
  const atendimento = { abrirPeloRobo: async () => undefined } as any;
  const adicional = new AdicionalPixService(db, cardapio, delivery, whats, oficial, eventos);
  const robo = new RoboPedidoService(db, cardapio, whats, oficial, delivery, atendimento, adicional);
  const empresas: string[] = [];
  const antes = { segredo: process.env.BOT_RESOLVER_SECRET, edge: process.env.EDGE_MODE };

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    delete process.env.EDGE_MODE; // como NUVEM (V44)
    for (const m of DA_NUVEM) await aplicar(m);
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
    await repetirNaCorridaDeCatalogo(() => pool.query(`alter table edge_heartbeat add column if not exists versao text`));
    const tem = async (t: string) => (await q(`select to_regclass(current_schema() || '.' || $1) is not null as ok`, [t]))[0].ok;
    if (!(await tem('edge_comando'))) {
      await aplicar('124_edge_release_comando.sql');
      await aplicar('269_impressora_status_codepage_comando_destino.sql');
    }
    if (!(await tem('pedido_alteracao'))) await aplicar('362_pedido_alteracao.sql');
    await aplicar('364_pedido_alteracao_aviso_do_endereco.sql');
  });
  beforeEach(() => {
    enviados.length = 0;
    eventosEmitidos.length = 0;
    gw.criados.length = 0;
    gw.cancelados.length = 0;
    gw.estornos.length = 0;
    gw.falharEstorno = false;
  });
  afterAll(async () => {
    if (antes.segredo === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes.segredo;
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (empresas.length) {
      for (const t of ['pedido_adicional_pix', 'pedido_estorno', 'atendimento_chamado', 'robo_carrinho', 'robo_config', 'pedido_alteracao', 'pedido_envio',
        'pedido_notificacao', 'impressao_job', 'producao_pedido', 'cashback_movimento', 'cashback_saldo', 'cashback_plano', 'pedido_externo',
        'lancamento_caixa', 'comanda', 'cliente_endereco', 'cliente', 'cardapio_senha_seq', 'cardapio_bairro', 'cardapio_config', 'produto',
        'categoria_produto', 'equipamento', 'edge_heartbeat', 'edge_comando', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // A loja de teste: X-Bacon (R$ 32) e Suco (R$ 7) vão para a cozinha; a Batata custa R$ 14 e está em PROMOÇÃO por R$ 12.
  async function loja(o: { cobra?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste Pix do adicional') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Ana de teste',$2) returning id`, [t, funcao]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    const instancia = `inst-${randomUUID().slice(0, 8)}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada, area_modo, pagamentos,
         evolution_instancia, tempo_entrega_min, provedor)
       values ($1,$2,$3,true,true,'retirada',true,true,'bairro','["pix","entrega"]'::jsonb,$4,40,'cloud')`,
      [t, u, `tk-${randomUUID()}`, instancia],
    );
    const prod = async (codigo: string, nome: string, preco: number, promo: number | null = null) =>
      (await q(
        `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, preco_promocional, vai_para_producao, controla_estoque, disponivel_cardapio)
         values ($1,$2,$3,$4,$5,$6,true,false,true) returning id`,
        [t, codigo, nome, categoria, preco.toFixed(2), promo],
      ))[0].id as string;
    const xbacon = await prod('XB1', 'X-Bacon de teste', 32);
    const suco = await prod('SC1', 'Suco de teste', 7);
    const batata = await prod('BT1', 'Batata de teste', 14, 12);
    await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, faz_producao, faz_cupom, padrao, conexao, host)
       values ($1,$2,'Cozinha de teste','impressora',$3,true,false,true,'rede','10.0.0.21')`,
      [t, u, randomBytes(12).toString('hex')],
    );
    if (o.cobra !== false) await q(`insert into robo_config (tenant_id, cobra_adicional_pix) values ($1, true)`, [t]);
    const celular = umCelular();
    const ctx = () => robo.contexto(SENHA, assinarConversa(t, celular)!, instancia);
    const doCliente = () => enviados.filter((e) => e.para === celular).map((e) => e.texto);
    return { t, u, gestor, xbacon, suco, batata, celular, ctx, doCliente };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  /** O pedido nº 57 do cardápio, PAGO no Pix pelo Mercado Pago (R$ 45: X-Bacon + Suco + R$ 6 de entrega), aceito. */
  async function pedidoPagoNoPix(l: Loja) {
    const itens = [
      { produtoId: l.xbacon, descricao: 'X-Bacon de teste', quantidade: 1, precoUnitario: 32, opcaoIds: [] },
      { produtoId: l.suco, descricao: 'Suco de teste', quantidade: 1, precoUnitario: 7, opcaoIds: [] },
    ];
    const ped: any = await delivery.ingest(
      l.t,
      l.u,
      'cardapio',
      {
        cliente: 'Marina de teste',
        clienteTelefone: l.celular.slice(2),
        displayId: '57',
        tipo: 'entrega',
        endereco: 'Rua das Flores, 120, Centro',
        formaPagamento: 'pix',
        total: 45,
        itens,
        valorBruto: 39,
        valorPagoCliente: 45,
      } as any,
      { clientRef: randomUUID(), taxaEntrega: 6, repetidoConferido: true } as any,
    );
    await q(
      `update pedido_externo set pago = true, status_pagamento = 'aprovado', gateway_provider = 'mercadopago', gateway_payment_id = $2,
              endereco_rua = 'Rua das Flores', endereco_numero = '120', endereco_bairro = 'Centro'
        where id = $1`,
      [ped.id, `pay-${randomUUID().slice(0, 8)}`],
    );
    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    return { id: ped.id as string, comandaId: r.comandaId as string };
  }

  /** Até o "Mandar o Pix": o robô põe a Batata no pedido pago e o Regem manda o Pix. Devolve a linha do Pix. */
  async function ateOPix(l: Loja) {
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'batata' });
    const r: any = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r.ok).toBe(true);
    // O Pix que o robô gerou (o que tem o código) — no teste da V84 a loja tem outros 35 esperando.
    const [pix] = await q(`select * from pedido_adicional_pix where tenant_id = $1 and copia_cola is not null order by criado_em desc limit 1`, [l.t]);
    return { c, pix };
  }
  const pixDe = async (id: string) => (await q(`select * from pedido_adicional_pix where id = $1`, [id]))[0];
  const totais = async (p: { id: string; comandaId: string }) => {
    const [pe] = await q(`select total::float8 as total, valor_pago_cliente::float8 as pago, pagamentos from pedido_externo where id = $1`, [p.id]);
    const [cm] = await q(`select total::float8 as total from comanda where id = $1`, [p.comandaId]);
    const lanc = await q(`select valor::float8 as valor, forma from lancamento_caixa where comanda_id = $1 and tipo = 'entrada' and categoria = 'venda'`, [p.comandaId]);
    return { pedido: pe.total, pagoPeloCliente: pe.pago, pagamentos: pe.pagamentos, venda: cm.total, caixa: lanc };
  };

  it('ajuste desligado: o pedido pago vai para a equipe, como antes', async () => {
    const l = await loja({ cobra: false });
    await pedidoPagoNoPix(l);
    const r: any = await robo.mexerNosItens(await l.ctx(), { acao: 'pedido_por', produto: 'batata' });
    expect(r).toMatchObject({ ok: false, motivo: 'pago', chamaEquipe: true });
    expect(enviados).toHaveLength(0);
  });

  it('pôr item: a conferência com o Pix, o código, o alerta "segure o pedido" e, pago, o item entra — pedido, venda e caixa com o total novo', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    const c = await l.ctx();
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: true, soPor: true, total: 'R$ 45,00' });
    // Tirar item de pedido pago continua com a equipe (devolver parte).
    expect(await robo.mexerNosItens(c, { acao: 'pedido_tirar', linha: 2 })).toMatchObject({ ok: false, motivo: 'pago', chamaEquipe: true });

    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'batata' });
    expect(r).toMatchObject({ ok: true, feito: 'conferência da mudança (com o Pix da diferença) enviada', proximo: { campo: 'confirmar_mudanca' } });
    expect(enviados[0]).toEqual({
      para: l.celular,
      texto: [
        'Mudança no pedido nº 57',
        '➕ 1 Batata de teste — R$ 12,00',
        'Total: R$ 45,00 → R$ 57,00',
        '',
        'Este pedido já foi pago no Pix. Para pôr o item, eu te mando um Pix de R$ 12,00.',
        'Ele vale 5 minutos: se não for pago a tempo, o código expira e o pedido pode sair sem o item.',
        '',
        'Mando o Pix? 👇',
      ].join('\n'),
      opcoes: ['Mandar o Pix', 'Deixar como estava'],
    });

    // "Mandar o Pix": o Pix da diferença (R$ 12 — o preço da promoção que o cliente conferiu), pelo gateway do pedido.
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true });
    expect(r.feito).toMatch(/^Pix de R\$\s?12,00 do item novo enviado/);
    expect(gw.criados).toHaveLength(1);
    expect(gw.criados[0]).toMatchObject({ valor: 12, preferido: 'mercadopago', descricao: 'Pedido #57 · item novo' });
    expect(gw.criados[0].idempotencia).toMatch(/^adicional-[0-9a-f-]{36}$/);
    expect(l.doCliente().slice(1)).toEqual([
      [
        'Aqui está o Pix de R$ 12,00 para pôr 1x Batata de teste no pedido nº 57 👇',
        'Vale por 5 minutos. Assim que o pagamento cair, o item entra no pedido e eu te aviso aqui.',
        'Se não for pago a tempo, o código expira e o pedido pode sair sem o item.',
      ].join('\n'),
      '00020126PIX12CODIGO', // o código SOZINHO, para copiar com um toque
    ]);
    // O alerta da Central (fora da fila), com o evento para as telas relerem.
    const alertas = await alertasDoAdicionalPix(db, l.t, l.u);
    expect(alertas).toHaveLength(1);
    expect(alertas[0]).toMatchObject({
      numero: '57',
      situacao: 'aguardando',
      texto: 'Pedido #57: o robô está pondo 1x Batata de teste (R$ 12,00) e espera o Pix do cliente. Segure o pedido: não libere até a conclusão.',
    });
    expect(eventosEmitidos.some((e) => e.n === 'atendimento.mudou' && e.p.motivo === 'adicional_pix')).toBe(true);
    // Nada mudou ainda no pedido; repetir o "Mandar o Pix" não gera outro; outra mudança espera este Pix.
    expect(await totais(p)).toMatchObject({ pedido: 45, venda: 39 });
    expect(await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' })).toMatchObject({ ok: true, jaFeita: true });
    expect(gw.criados).toHaveLength(1);
    expect(await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'suco' })).toMatchObject({ ok: false, motivo: 'pix_aberto' });

    // A rotina antes do pagamento: nada entra.
    let v = await adicional.volta();
    expect(v.aplicados).toBe(0);
    const [pix] = await q(`select * from pedido_adicional_pix where tenant_id = $1`, [l.t]);
    expect(pix).toMatchObject({ situacao: 'aguardando', valor: '12.00', gateway_provider: 'mercadopago' });

    // O cliente paga: a rotina põe o item pela MESMA alteração da equipe, com a diferença como pagamento já feito.
    enviados.length = 0;
    gw.pagos.add(pix.gateway_payment_id);
    v = await adicional.volta();
    expect(v.aplicados).toBe(1);
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'aplicado' });
    const t = await totais(p);
    expect(t).toMatchObject({ pedido: 57, pagoPeloCliente: 57, venda: 51 });
    // O caixa: o lançamento da venda (o "online" do pedido pago) acompanha o total novo — o faturamento soma 57.
    expect(t.caixa).toEqual([{ valor: 51, forma: expect.any(String) }]);
    const [alt] = await q(`select * from pedido_alteracao where pedido_id = $1`, [p.id]);
    expect(alt).toMatchObject({ origem: 'robo', situacao: 'aplicada', id: pix.id });
    expect(alt.pedido).toMatchObject({ pagoNaHora: 12 });
    expect(alt.depois).toMatchObject({ total: 57, aReceber: 0 });
    expect((await q(`select count(*)::int as n from impressao_job where comanda_id = $1 and conteudo like '%ALTERADO%'`, [p.comandaId]))[0].n).toBeGreaterThan(0);
    expect(l.doCliente()).toEqual(['✅ Pagamento recebido! 1x Batata de teste entrou no pedido nº 57.\nTotal: R$ 57,00.']);
    expect(await alertasDoAdicionalPix(db, l.t, l.u)).toEqual([]);
    // A rotina de novo: nada muda duas vezes.
    await adicional.volta();
    expect(await q(`select count(*)::int as n from pedido_alteracao where pedido_id = $1`, [p.id])).toEqual([{ n: 1 }]);
    expect(l.doCliente()).toHaveLength(1);

    // O pedido cancelado depois: os DOIS Pix voltam — o do pedido (R$ 45, mig 372) e o do item novo (R$ 12).
    await q(`update pedido_externo set status = 'cancelado', cancelado_em = now() where id = $1`, [p.id]);
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'estornado', estorno_id: `est-${pix.gateway_payment_id}` });
    await new EstornoPixService(db, cardapio as any).enfileirar();
    expect((await q(`select valor from pedido_estorno where pedido_id = $1`, [p.id]))[0]).toEqual({ valor: '45.00' });
  });

  it('o Pix que vence sem pagamento: cancela no gateway, avisa e o pedido segue como estava; pago depois de vencido, volta', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    const { pix } = await ateOPix(l);
    enviados.length = 0;
    await q(`update pedido_adicional_pix set expira_em = now() - interval '1 minute' where id = $1`, [pix.id]);
    const v = await adicional.volta();
    expect(v.vencidos).toBe(1);
    expect(gw.cancelados).toEqual([pix.gateway_payment_id]);
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'expirado' });
    expect(l.doCliente()).toEqual([
      'O Pix para pôr 1x Batata de teste no pedido nº 57 expirou sem pagamento, e o pedido segue como estava. Se ainda quiser o item, é só me dizer.',
    ]);
    expect(await alertasDoAdicionalPix(db, l.t, l.u)).toEqual([]);
    expect(await totais(p)).toMatchObject({ pedido: 45, venda: 39 });

    // Pagou depois de vencido (o cancelamento falhou, ou a Rede): não entra — volta sozinho, e o cliente sabe.
    enviados.length = 0;
    gw.pagos.add(pix.gateway_payment_id);
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'estornado' });
    expect(gw.estornos).toEqual([pix.gateway_payment_id]);
    expect(l.doCliente()[0]).toMatch(/^Recebi o Pix de R\$ 12,00, mas não deu para pôr 1x Batata de teste no pedido nº 57/);
    expect(l.doCliente()[0]).toMatch(/devolvido automaticamente para a mesma conta, pela instituição financeira/);
    expect(await totais(p)).toMatchObject({ pedido: 45, venda: 39 });
  });

  it('pago, mas o pedido já saiu: o item não entra e o Pix volta; a 3ª falha do estorno vira caso URGENTE', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    const { pix } = await ateOPix(l);
    await q(`update pedido_externo set status = 'despachado' where id = $1`, [p.id]);
    enviados.length = 0;
    gw.pagos.add(pix.gateway_payment_id);
    gw.falharEstorno = true;
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'estornar', tentativas: 1 });
    expect(l.doCliente()[0]).toMatch(/^Recebi o Pix de R\$ 12,00, mas não deu para pôr/);
    expect(await totais(p)).toMatchObject({ pedido: 45, venda: 39 });
    await adicional.volta();
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
    const [caso] = await q(`select prioridade, mensagem from atendimento_chamado where pedido_id = $1`, [p.id]);
    expect(caso.prioridade).toBe('urgente');
    expect(caso.mensagem).toMatch(/^O estorno do Pix do item novo do pedido #57 \(1x Batata de teste, R\$ 12,00\) não saiu: devolva o valor ao cliente pelo app do Mercado Pago\./);
    expect(eventosEmitidos.some((e) => e.n === 'atendimento.novo')).toBe(true);
  });

  it('loja com servidor ligado: o Pix pago vai como "pedida" com a diferença; o servidor aplica e o cliente recebe a confirmação', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    const { pix } = await ateOPix(l);
    enviados.length = 0;
    gw.pagos.add(pix.gateway_payment_id);
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'pedido_a_loja' });
    expect(l.doCliente()).toEqual(['✅ Pagamento recebido! Pedi à loja para pôr 1x Batata de teste no pedido nº 57 ⏳ Te confirmo aqui em instantes.']);
    const [a] = await q(`select * from pedido_alteracao where pedido_id = $1`, [p.id]);
    expect(a).toMatchObject({ situacao: 'pedida' });
    expect(a.pedido).toMatchObject({ pagoNaHora: 12, precoInformado: true });
    // A rotina da decisão do robô não manda outra mensagem (a do Pix responde por ela).
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toHaveLength(1);

    // O servidor da loja aplica a pedida (o mesmo `alterar`, com a diferença paga que veio na pedida).
    expect(
      await delivery.aplicarAlteracaoPedida({
        id: a.id, tenantId: l.t, pedidoId: p.id, porId: null, porNome: a.por_nome, origem: 'robo', pedido: a.pedido, pedidoDoCliente: a.pedido_do_cliente, createdAt: new Date(),
      }),
    ).toEqual({ aplicada: true, motivo: null });
    expect(await totais(p)).toMatchObject({ pedido: 57, venda: 51 });
    enviados.length = 0;
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'aplicado' });
    expect(l.doCliente()).toEqual(['✅ A loja confirmou: 1x Batata de teste entrou no pedido nº 57.\nTotal: R$ 57,00.']);
  });

  it('35 Pix esperando na frente não trancam o que foi pago (V84): em duas voltas ele entra', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    // 35 pedidos com o Pix do item novo esperando, mais antigos na vez (nenhum pago).
    await q(
      `with ped as (
         insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status, display_id, cliente_telefone)
         select $1, $2, 'cardapio', 'entrega', '[]', 10, 'confirmado', 'F' || g, '21900000000' from generate_series(1, 35) g
         returning id)
       insert into pedido_adicional_pix (id, tenant_id, unidade_id, pedido_id, telefone, descricao, mudanca, valor, gateway_provider,
                                         gateway_payment_id, expira_em, atualizado_em)
       select gen_random_uuid(), $1, $2, ped.id, '5521900000000', '1x Água', '{"op":{"tipo":"por"}}', 3, 'mercadopago',
              'nao-pago-' || ped.id, now() + interval '5 minutes', now() - interval '1 hour'
         from ped`,
      [l.t, l.u],
    );
    const { pix } = await ateOPix(l);
    gw.pagos.add(pix.gateway_payment_id);
    await adicional.volta();
    await adicional.volta();
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'aplicado', erro: null });
    expect(await totais(p)).toMatchObject({ pedido: 57, venda: 51 });
  });

  it('duas réplicas da API ao mesmo tempo: o pagamento entra uma vez só', async () => {
    const l = await loja();
    const p = await pedidoPagoNoPix(l);
    const { pix } = await ateOPix(l);
    gw.pagos.add(pix.gateway_payment_id);
    const outra = new AdicionalPixService(db, cardapio, delivery, whats, oficial, eventos);
    await Promise.all([adicional.volta(), outra.volta(), adicional.confirmarPeloAviso(pix.gateway_payment_id)]);
    expect(await pixDe(pix.id)).toMatchObject({ situacao: 'aplicado' });
    expect(await q(`select count(*)::int as n from pedido_alteracao where pedido_id = $1`, [p.id])).toEqual([{ n: 1 }]);
    expect(await totais(p)).toMatchObject({ pedido: 57, venda: 51 });
    expect(l.doCliente().filter((x) => x.startsWith('✅ Pagamento recebido'))).toHaveLength(1);
  });
});
