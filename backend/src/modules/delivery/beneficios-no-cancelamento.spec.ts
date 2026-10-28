import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { OpenDeliveryPoller } from '../integracoes/open-delivery/open-delivery.poller';
import { DeliveryService } from './delivery.service';
import { baixarPendenciasAntigas, EVENTO_CANCELADOS_NA_BAIXA } from './pendencias-turno';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DESCONTOS NO CANCELAMENTO (pedido do dono, 28/10/2026: "verificar se fidelidade, cashback e cupons são estornados nos
// cancelamentos"), contra o Postgres e com os serviços de VERDADE do cashback e da fidelidade:
//  • o cashback GANHO sai, o GASTO volta (padrão da loja) e o ponto é estornado — no painel, no sistema e na baixa
//    administrativa (que antes não estornava nada);
//  • o CUPOM SE PERDE (decisão do dono, a mesma de julho): o uso fica gravado;
//  • o estorno do cashback não entra duas vezes (loja e nuvem, ou duas chamadas juntas);
//  • o estorno que falha tenta de novo e, esgotado, vai para o log e a auditoria (antes, `.catch(() => {})`);
//  • o "CANCELLED" do Open Delivery (Rappi, Delivery Direto) cancela o pedido (antes era ignorado).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('beneficios-no-cancelamento.spec: sem TEST_PG_URL — PULADO');

const SENHA_GERENTE = 'Senha-Gerente-1';
const TEL = '21999990000';

descrever('descontos no cancelamento (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  const cashback = new CashbackService(db);
  const fidelidade = new FidelidadeService(db);
  const servico = (cb: any = cashback, fid: any = fidelidade) => {
    const d: any = new DeliveryService(
      db, vendas, producao, cb, fid, eventos, { flashPedidos: () => undefined } as any,
      undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
    );
    d.esperasDoEstorno = [0, 10, 10]; // a nova tentativa sem esperar segundos no teste
    return d as DeliveryService;
  };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  const edge = process.env.EDGE_MODE;

  beforeAll(() => {
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    if (edge !== undefined) process.env.EDGE_MODE = edge;
    if (empresas.length) {
      for (const t of ['cupom_uso', 'cupom', 'cashback_movimento', 'cashback_saldo', 'fidelidade_ponto', 'fidelidade_resgate', 'fidelidade_cliente',
        'fidelidade_plano', 'pedido_envio', 'impressao_job', 'pedido_externo', 'cardapio_config', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  /** A loja com um gerente (a senha libera o cancelamento do painel) e um plano de fidelidade. */
  async function loja() {
    const t = await um(`insert into empresa (nome) values ('teste descontos no cancelamento') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]);
    const f = await um(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]);
    const gerente = await um(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Gerente Teste',$2,$3) returning id`, [
      t, f, await bcrypt.hash(SENHA_GERENTE, 4),
    ]);
    const plano = await um(`insert into fidelidade_plano (tenant_id, nome, pontos_meta) values ($1,'Plano',10) returning id`, [t]);
    const cupom = await um(`insert into cupom (tenant_id, codigo, tipo, valor) values ($1,'BEMVINDO','valor',5) returning id`, [t]);
    return { t, u, gerente, plano, cupom };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  /**
   * Um pedido do cardápio com tudo o que o cliente ganhou e usou: R$ 4 de cashback GANHO, R$ 3 de cashback GASTO, um ponto
   * de fidelidade e o cupom. `horasAtras` = há quanto tempo foi feito (a baixa administrativa pega os de mais de 24 h).
   */
  async function pedido(l: Loja, status = 'novo', horasAtras = 0) {
    const id = await um(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, tipo, itens, total, cliente_nome, cliente_telefone, criado_em)
       values ($1,$2,'cardapio',$3,$4,'entrega','[]'::jsonb,30,'Bia',$5, now() - ($6 || ' hours')::interval) returning id`,
      [l.t, l.u, randomUUID(), status, TEL, horasAtras],
    );
    await q(`insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem, pedido_id) values ($1,$2,'valor',4,'credito',$3), ($1,$2,'valor',-3,'resgate',$3)`, [l.t, TEL, id]);
    await q(`insert into fidelidade_ponto (tenant_id, plano_id, telefone, pedido_id) values ($1,$2,$3,$4)`, [l.t, l.plano, TEL, id]);
    await q(`insert into cupom_uso (tenant_id, cupom_id, telefone, pedido_id) values ($1,$2,$3,$4)`, [l.t, l.cupom, TEL, id]);
    return id;
  }

  /** O que o cancelamento deixou: o extrato do cashback do pedido, o ponto e o uso do cupom. Espera o estorno (segundo plano). */
  async function depois(l: Loja, id: string, esperaEstorno = true) {
    for (let i = 0; esperaEstorno && i < 50; i++) {
      const [n] = await q(`select count(*)::int n from cashback_movimento where pedido_id = $1 and origem like 'estorno%'`, [id]);
      const [p] = await q(`select estornado from fidelidade_ponto where pedido_id = $1`, [id]);
      if (n.n >= 2 && p.estornado) break;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    const movs = await q(`select origem, delta::numeric::float8 as delta from cashback_movimento where pedido_id = $1 order by origem`, [id]);
    const [ponto] = await q(`select estornado from fidelidade_ponto where pedido_id = $1`, [id]);
    const [uso] = await q(`select count(*)::int n from cupom_uso where pedido_id = $1`, [id]);
    const [saldo] = await q(`select saldo::numeric::float8 as saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`, [l.t, TEL]);
    return { movs, estornado: ponto.estornado, usosDoCupom: uso.n, saldo: saldo?.saldo ?? 0 };
  }
  const ESTORNADO = [
    { origem: 'credito', delta: 4 },
    { origem: 'estorno', delta: -4 }, // o ganho sai
    { origem: 'estorno_devolucao', delta: 3 }, // o gasto volta (padrão da loja)
    { origem: 'resgate', delta: -3 },
  ];

  it('painel: o cashback ganho sai, o gasto volta, o ponto é estornado — e o CUPOM SE PERDE', async () => {
    const l = await loja();
    const id = await pedido(l);
    await servico().cancelar(l.t, l.gerente, 'gerente', id, 'Cliente desistiu', SENHA_GERENTE, true, null);
    const r = await depois(l, id);
    expect(r.movs).toEqual(ESTORNADO);
    expect(r.estornado).toBe(true);
    expect(r.usosDoCupom).toBe(1); // antes o uso era apagado e a cota voltava
  });

  it('sistema (PIX que não chegou) e canal: o mesmo estorno; o cupom também se perde', async () => {
    const l = await loja();
    const a = await pedido(l);
    await servico().cancelarSistema(l.t, a, 'PIX não confirmado no prazo');
    expect(await depois(l, a)).toMatchObject({ movs: ESTORNADO, estornado: true, usosDoCupom: 1 });
    const b = await pedido(l, 'confirmado');
    const [{ external_id }] = await q(`select external_id from pedido_externo where id = $1`, [b]);
    expect(await servico().refletirStatusExterno(l.t, 'cardapio', external_id, 'cancelado')).toBe('aplicado');
    expect(await depois(l, b)).toMatchObject({ movs: ESTORNADO, estornado: true, usosDoCupom: 1 });
  });

  it('o estorno do cashback não entra duas vezes (loja e nuvem, ou duas chamadas juntas)', async () => {
    const l = await loja();
    const id = await pedido(l, 'cancelado');
    const [antes] = await q(`select saldo::numeric::float8 as saldo from cashback_saldo where tenant_id = $1 and telefone = $2`, [l.t, TEL]);
    // A CORRIDA de verdade: dois "servidores" (a loja e a nuvem) leem o extrato do pedido ANTES de qualquer um gravar — o
    // portão só solta as leituras quando as duas chegaram. Com id aleatório, os dois estornos entravam.
    let chegaram = 0;
    let soltar = () => undefined as void;
    const aberto = new Promise<void>((ok) => (soltar = ok));
    const portao = async () => {
      if (++chegaram >= 2) soltar();
      await aberto;
    };
    const servidor = () =>
      new CashbackService({
        select: (...a: any[]) => ({
          from: (t: any) => ({
            where: async (c: any) => {
              const r = await db.select(...a).from(t).where(c);
              await portao();
              return r;
            },
          }),
        }),
        insert: (...a: any[]) => db.insert(...a),
        update: (...a: any[]) => db.update(...a),
      } as any);
    await Promise.all([servidor().estornarPedido(l.t, id, TEL, true), servidor().estornarPedido(l.t, id, TEL, true)]);
    expect(chegaram).toBe(2);
    await cashback.estornarPedido(l.t, id, TEL, true); // e de novo, depois
    const r = await depois(l, id, false);
    expect(r.movs).toEqual(ESTORNADO); // um estorno e uma devolução — não três
    expect(r.saldo).toBeCloseTo(antes.saldo - 4 + 3, 2);
    // O mesmo id dos dois lados: o lançamento que a outra ponta gravou chega pelo sincronismo e não soma de novo.
    const ids = await q(`select id from cashback_movimento where pedido_id = $1 and origem like 'estorno%' order by origem`, [id]);
    const outro = await pedido(l, 'cancelado');
    await cashback.estornarPedido(l.t, outro, TEL, true);
    const idsOutro = await q(`select id from cashback_movimento where pedido_id = $1 and origem like 'estorno%' order by origem`, [outro]);
    expect(idsOutro.map((x: any) => x.id)).not.toEqual(ids.map((x: any) => x.id)); // por pedido
  });

  it('estorno que falha tenta de novo; esgotado, vai para a auditoria (antes: falha calada)', async () => {
    const l = await loja();
    let falhas = 0;
    const instavel = {
      estornarPedido: async (t: string, p: string, tel?: string, dev?: boolean) =>
        ++falhas <= 2 ? Promise.reject(new Error('conexão caiu')) : cashback.estornarPedido(t, p, tel, dev),
    };
    const a = await pedido(l);
    await servico(instavel).cancelarSistema(l.t, a, 'PIX não confirmado no prazo');
    expect((await depois(l, a)).movs).toEqual(ESTORNADO); // na 3ª tentativa
    expect(falhas).toBe(3);

    auditado.length = 0;
    const quebrado = { estornarPedido: async () => Promise.reject(new Error('relação inexistente')) };
    const b = await pedido(l);
    await servico(cashback, quebrado).cancelarSistema(l.t, b, 'PIX não confirmado no prazo');
    for (let i = 0; i < 50 && !auditado.some((x) => x.acao === 'estorno_beneficio_falhou'); i++) await new Promise((ok) => setTimeout(ok, 50));
    expect(auditado).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ acao: 'estorno_beneficio_falhou', entidadeId: b, detalhe: { beneficio: 'pontos de fidelidade', erro: 'relação inexistente' } }),
      ]),
    );
    expect((await depois(l, b, false)).estornado).toBe(false);
  });

  it('baixa administrativa: o pedido nunca aceito que ela cancela devolve cashback e pontos (antes, nada)', async () => {
    const l = await loja();
    const parado = await pedido(l, 'novo', 30);
    const aceito = await pedido(l, 'confirmado', 30); // este conclui: nada a estornar
    const emitidos: any[] = [];
    const fin = new FinanceiroService(db, auditoria, producao, { emit: (ev: string, p: any) => void emitidos.push({ ev, p }) } as any);
    const r = await fin.baixarPendenciasAntigas(l.t, l.gerente, 'gerente', l.u, 'delivery');
    expect(r).toMatchObject({ concluidos: 1, cancelados: 1 });
    expect(emitidos).toEqual([{ ev: EVENTO_CANCELADOS_NA_BAIXA, p: { tenantId: l.t, pedidos: [{ id: parado, clienteTelefone: TEL }] } }]);
    // O delivery atende o evento.
    await servico().aoCancelarNaBaixa(emitidos[0].p);
    expect(await depois(l, parado)).toMatchObject({ movs: ESTORNADO, estornado: true, usosDoCupom: 1 });
    expect(await depois(l, aceito, false)).toMatchObject({ estornado: false, movs: [{ origem: 'credito', delta: 4 }, { origem: 'resgate', delta: -3 }] });
    // A função da baixa diz quem foi cancelado, com o telefone.
    expect(await baixarPendenciasAntigas(db, l.t, l.u, 'delivery')).toMatchObject({ cancelados: 0, canceladosComCliente: [] });
  });
});

// O "CANCELLED" do Open Delivery (Rappi, Delivery Direto): doc oficial — "the Software Service must cancel the order".
describe('Open Delivery: o cancelamento do canal', () => {
  const poller = (refletir: (...a: any[]) => Promise<any>) => {
    const acks: any[] = [];
    const od: any = {
      polling: async () => [
        { eventId: '1', eventType: 'CANCELLED', orderId: 'OD-1' },
        { eventId: '2', eventType: 'CONFIRMED', orderId: 'OD-2' },
      ],
      acknowledge: async (_ig: any, evs: any[]) => void acks.push(...evs.map((e) => e.eventId)),
    };
    const p: any = new OpenDeliveryPoller(od, { refletirStatusExterno: refletir } as any);
    return { p, acks };
  };
  const ig = { id: 'ig', tenantId: 't-1', unidadeId: null, canal: 'delivery_direto' };

  it('cancela pelo MESMO caminho do iFood e da 99, e só então confirma a leitura', async () => {
    const refletir = jest.fn(async () => 'aplicado');
    const { p, acks } = poller(refletir);
    await p.processar(ig);
    expect(refletir).toHaveBeenCalledWith('t-1', 'delivery_direto', 'OD-1', 'cancelado');
    expect(refletir).toHaveBeenCalledTimes(1); // o CONFIRMED segue só reconhecido
    expect(acks).toEqual(['1', '2']);
  });

  it('se o cancelamento não for aplicado, o evento fica sem confirmação e volta no próximo polling', async () => {
    const { p, acks } = poller(async () => Promise.reject(new Error('banco fora')));
    await p.processar(ig);
    expect(acks).toEqual(['2']);
  });
});
