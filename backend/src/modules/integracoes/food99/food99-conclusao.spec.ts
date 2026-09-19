import { Food99Service } from './food99.service';
import { DeliveryService } from '../../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// 99Food — contrato da doc oficial (developer-food.99app.com):
//  • verifyDeliveryCode: campo `delivery_code` INTEIRO (ERR-059: o Regem mandava
//    `takeaway_code` e todo código válido era recusado);
//  • conclusão: retirada → /order/order/finish; entrega própria → /order/order/delivered;
//    entrega pela 99 → nada (ERR-060).
describe('99Food — código de entrega e conclusão conforme a doc', () => {
  const log = { log() {}, warn() {}, error() {} };

  function svc99() {
    const s: any = Object.create(Food99Service.prototype);
    s.logger = log;
    s.authToken = async () => 'tk';
    const chamadas: { caminho: string; corpo: string }[] = [];
    s.postJson = async (caminho: string, tk: string, campos: string[]) => {
      chamadas.push({ caminho, corpo: `{${[`"auth_token":${JSON.stringify(tk)}`, ...campos].join(',')}}` });
      return { errno: 0, errmsg: 'ok' };
    };
    return { s, chamadas };
  }

  it('verifyDeliveryCode manda delivery_code NUMÉRICO e order_id sem perder precisão', async () => {
    const { s, chamadas } = svc99();
    const r = await s.verificarCodigoEntrega({}, '5764665043203457174', ' 51-07 ');
    expect(r.ok).toBe(true);
    expect(chamadas[0].caminho).toBe('/v1/order/selfdelivery/verifyDeliveryCode');
    expect(chamadas[0].corpo).toBe('{"auth_token":"tk","order_id":5764665043203457174,"delivery_code":5107}');
    expect(chamadas[0].corpo).not.toContain('takeaway_code');
  });

  it('código sem dígitos é recusado sem chamar a 99', async () => {
    const { s, chamadas } = svc99();
    const r = await s.verificarCodigoEntrega({}, '5764665043203457174', 'abc');
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
  });

  it('erro da 99 volta com a mensagem dela (errmsg), não só o número', async () => {
    const { s } = svc99();
    s.postJson = async () => ({ errno: 10002, errmsg: 'delivery code error' });
    expect(await s.verificarCodigoEntrega({}, '1', '1234')).toEqual({ ok: false, errno: 10002, errmsg: 'delivery code error' });
  });

  describe('conclusão do pedido (status-back "delivered")', () => {
    const chamou: string[] = [];
    const food99: any = {
      integracaoDoTenant: async () => ({}),
      finalizarRetirada: async () => { chamou.push('finish'); return true; },
      entregue: async () => { chamou.push('delivered'); return true; },
    };
    const delivery: any = new DeliveryService({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, undefined, undefined, undefined, food99);
    const concluir = async (row: any) => {
      chamou.length = 0;
      await delivery.statusBackFood99('t1', { canal: '99food', externalId: '1', ...row }, 'delivered');
      return [...chamou];
    };

    it('retirada (fulfillment_mode=1) → finish', async () => {
      expect(await concluir({ tipo: 'retirada', raw: { fulfillment_mode: 1, delivery_type: 0 } })).toEqual(['finish']);
    });
    it('entrega própria (delivery_type=2) → delivered', async () => {
      expect(await concluir({ tipo: 'entrega', raw: { fulfillment_mode: 0, delivery_type: 2 } })).toEqual(['delivered']);
    });
    it('entrega pela 99 (delivery_type=1) → nada (a 99 conclui)', async () => {
      expect(await concluir({ tipo: 'entrega', raw: { fulfillment_mode: 0, delivery_type: 1 } })).toEqual([]);
    });
  });
});
