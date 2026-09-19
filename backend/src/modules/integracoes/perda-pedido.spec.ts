import { createHash } from 'node:crypto';
import { IfoodPoller } from './ifood/ifood.poller';
import { AnotaAiService } from './anotaai/anotaai.service';
import { Food99Service } from './food99/food99.service';
import { OpenDeliveryPoller } from './open-delivery/open-delivery.poller';
import { CardapioWebService } from './cardapio-web/cardapio-web.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pedido de marketplace NÃO PODE se perder por uma falha passageira: o canal só pode ser
// avisado de que o pedido foi recebido (ACK / "visto" / cursor) DEPOIS de ele estar gravado.
// Regra do iFood: "persista os eventos antes do acknowledgment — se a persistência falhar,
// você recebe o evento de novo no próximo polling".
describe('pedido de marketplace não se perde em falha passageira', () => {
  it('iFood: detalhe falhou → o evento PLC não pode ser reconhecido (ACK)', async () => {
    const acked: string[] = [];
    let tentativa = 0;
    const ifood: any = {
      integracoesAtivas: async () => [{ tenantId: 't1', unidadeId: null, merchantId: 'm1' }],
      // Como o iFood real: evento reconhecido (ACK) NÃO volta no próximo polling.
      polling: async () => (acked.includes('ev1') ? [] : [{ id: 'ev1', code: 'PLC', orderId: 'o1' }]),
      pedido: async () => (++tentativa === 1 ? null : { id: 'o1' }), // 1ª busca falha (rede)
      acknowledge: async (_ig: any, evs: any[]) => { acked.push(...evs.map((e) => e.id)); },
      reconciliarCancels: async () => 0,
    };
    const ingeridos: string[] = [];
    const delivery: any = { ingest: async (_t: any, _u: any, _c: any, raw: any) => { ingeridos.push(raw.id); } };
    const p = new IfoodPoller(ifood, delivery);
    await p.tick(); // 1º ciclo: detalhe falha
    await p.tick(); // 2º ciclo: o evento tem de voltar e o pedido entrar
    expect({ ingeridos, acked }).toEqual({ ingeridos: ['o1'], acked: ['ev1'] });
  });

  it('Anota Aí: gravação falhou → o pedido não pode ser marcado como visto nem aceito', async () => {
    const aceitos: string[] = [];
    const ingeridos: string[] = [];
    let falhas = 1;
    const svc: any = Object.create(AnotaAiService.prototype);
    const cfg: any = { seen: [] };
    svc.logger = { log() {}, warn() {}, error() {} };
    svc.integracaoDoTenant = async () => ({ id: 'ig1', tenantId: 't1', config: cfg });
    svc.unidadeDestino = async () => null;
    svc.listar = async () => [{ _id: 'a1', check: 0 }];
    svc.pedido = async () => ({ _id: 'a1' });
    svc.aceitar = async (_ig: any, id: string) => { aceitos.push(id); };
    svc.materializarSeNovo = async () => {};
    svc.abrirChamadoCancelamento = async () => {};
    svc.delivery = {
      ingest: async () => {
        if (falhas-- > 0) throw new Error('connection timeout'); // falha passageira do banco
        ingeridos.push('a1');
      },
      refletirStatusExterno: async () => {},
    };
    svc.db = { update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(cfg, v.config); } }) }) };
    await svc.sincronizar('t1'); // 1º ciclo: gravação falha
    await svc.sincronizar('t1'); // 2º ciclo: tem de tentar de novo
    expect({ ingeridos, aceitos }).toEqual({ ingeridos: ['a1'], aceitos: ['a1'] });
  });
});

describe('pedido de marketplace não se perde — 99Food, Open Delivery, Cardápio Web', () => {
  const log = { log() {}, warn() {}, error() {} };

  it('99Food webhook: detalhe indisponível → errno≠0 (a 99 reenvia); depois grava e responde 0', async () => {
    const segredo = 'segredo-teste';
    const svc: any = Object.create(Food99Service.prototype);
    svc.logger = log;
    svc.integracoesAtivas = async () => [{ id: 'ig', tenantId: 't1', unidadeId: null, appSecret: segredo, appShopId: 'loja1', config: {} }];
    svc.unidadeDestino = async () => null;
    let tentativa = 0;
    svc.pedido = async () => (++tentativa === 1 ? null : { order_id: '5764665043203457174', price: {} });
    const gravados: string[] = [];
    svc.delivery = { ingest: async (_t: any, _u: any, _c: any, raw: any) => { gravados.push(raw.order_id); } };
    const corpo = '{"app_shop_id":"loja1","type":"orderNew","data":{"order_id":5764665043203457174}}';
    const sign = createHash('md5').update(corpo + segredo).digest('hex');
    const r1 = await svc.processarWebhook(corpo, sign);
    const r2 = await svc.processarWebhook(corpo, sign); // reenvio da 99
    expect({ r1: r1.errno !== 0, r2: r2.errno, gravados }).toEqual({ r1: true, r2: 0, gravados: ['5764665043203457174'] });
  });

  it('Open Delivery: gravação falhou → sem ACK; próximo ciclo grava', async () => {
    const acked: string[] = [];
    let falhas = 1;
    const od: any = {
      integracoesAtivas: async () => [{ tenantId: 't1', unidadeId: null, canal: 'open_delivery' }],
      polling: async () => (acked.includes('e1') ? [] : [{ id: 'e1', eventType: 'CREATED', orderId: 'o1' }]),
      pedido: async () => ({ id: 'o1', total: {} }),
      confirmar: async () => {},
      acknowledge: async (_ig: any, evs: any[]) => { acked.push(...evs.map((e) => e.id)); },
    };
    const gravados: string[] = [];
    const delivery: any = {
      ingest: async () => {
        if (falhas-- > 0) throw new Error('deadlock detected');
        gravados.push('o1');
        return { displayId: '1' };
      },
    };
    const antes = process.env.EDGE_MODE;
    delete process.env.EDGE_MODE;
    const p = new OpenDeliveryPoller(od, delivery);
    (p as any).logger = log;
    await p.tick();
    await p.tick();
    if (antes !== undefined) process.env.EDGE_MODE = antes;
    expect({ gravados, acked }).toEqual({ gravados: ['o1'], acked: ['e1'] });
  });

  it('Cardápio Web: pedido falhou → o cursor não avança e o pedido entra no ciclo seguinte', async () => {
    const svc: any = Object.create(CardapioWebService.prototype);
    svc.logger = log;
    const cfg: any = { lastPollAt: new Date(Date.now() - 5 * 60000).toISOString() };
    const cursorInicial = cfg.lastPollAt;
    svc.doTenant = async () => ({ id: 'ig', tenantId: 't1', unidadeId: null, token: 'x', config: cfg });
    svc.autenticavel = () => true;
    svc.unidadeDestino = async () => null;
    svc.listarDesde = async () => [{ id: 'c1', status: 'confirmed' }];
    let falhas = 1;
    svc.pedido = async () => (falhas-- > 0 ? null : { id: 'c1' });
    const gravados: string[] = [];
    svc.delivery = {
      ingest: async () => { gravados.push('c1'); },
      refletirStatusExterno: async () => {},
    };
    svc.db = { update: () => ({ set: (v: any) => ({ where: async () => { Object.assign(cfg, v.config); } }) }) };
    await svc.sincronizar('t1');
    const cursorAposFalha = cfg.lastPollAt;
    await svc.sincronizar('t1');
    expect({ manteve: cursorAposFalha === cursorInicial, avancou: cfg.lastPollAt !== cursorInicial, gravados })
      .toEqual({ manteve: true, avancou: true, gravados: ['c1'] });
  });
});
