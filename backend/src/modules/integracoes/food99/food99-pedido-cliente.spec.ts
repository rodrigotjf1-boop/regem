import { ajusteDa99, AJUSTE_99_PADRAO, lerPedidoDoCliente, motivoDaRecusaAutomatica } from './food99-pedido-cliente';
import { montarRespostaAo99 } from '../../atendimento/pedido-99.service';

// O PEDIDO DO CLIENTE DA 99 lido como a documentação manda (Order Webhooks, conferida em 02/11/2026) e a resposta conferida
// antes de ir à 99. Os corpos abaixo são os exemplos da própria documentação (Event7 e Event8).

const CANCEL = `{"app_id":1152921654762997000,"app_shop_id":"0001","type":"orderCancelApply","timestamp":1592970557,"data":{"order_id":1152921654762996500,"apply_reason":"do not want","apply_id":1152921654813328100,"reason_list":[{"reason":"preparing"},{"reason":"prepared"},{"reason":"courier arrived"},{"reason":"courier taken"}]}}`;
const REFUND = `{"app_id":1152921654762997000,"app_shop_id":"0001","type":"orderRefundApply","timestamp":1592970557,"data":{"order_id":1152921654762996500,"apply_reason":"missing items, I want to refund","images":["https://user/missing/items/image.jpg"],"apply_id":1152921654813328100,"base_reason_list":[{"base_reason_id":"430001","base_reason":"Communication with user redo a Delivery"},{"base_reason_id":"430005","base_reason":"User misunderstands"},{"base_reason_id":"430008","base_reason":"Other"}]}}`;

describe('o pedido do cliente lido do aviso', () => {
  it('cancelamento: os ids de 64 bits EXATOS (texto, nunca JSON), a fala e os motivos de recusa', () => {
    expect(lerPedidoDoCliente(CANCEL, 'cancelamento')).toEqual({
      tipo: 'cancelamento',
      pedidoExterno: '1152921654762996500',
      applyId: '1152921654813328100',
      motivoDoCliente: 'do not want',
      motivosDeRecusa: ['preparing', 'prepared', 'courier arrived', 'courier taken'],
      motivosDoReembolso: [],
      fotos: [],
    });
  });

  it('reembolso: as fotos do cliente e os motivos com id', () => {
    const p = lerPedidoDoCliente(REFUND, 'reembolso')!;
    expect(p.fotos).toEqual(['https://user/missing/items/image.jpg']);
    expect(p.motivosDoReembolso).toEqual([
      { id: '430001', motivo: 'Communication with user redo a Delivery' },
      { id: '430005', motivo: 'User misunderstands' },
      { id: '430008', motivo: 'Other' },
    ]);
  });

  it('id de 64 bits que o JSON CORROMPERIA (o exemplo da doc já vem arredondado): chega exato', () => {
    const real = `{"type":"orderCancelApply","data":{"order_id":5764607523034234881,"apply_id":5764607523034234883,"reason_list":[]}}`;
    expect(String(JSON.parse(real).data.apply_id)).not.toBe('5764607523034234883'); // a prova de que o JSON perde
    expect(lerPedidoDoCliente(real, 'cancelamento')).toMatchObject({ pedidoExterno: '5764607523034234881', applyId: '5764607523034234883' });
  });

  it('sem o id do pedido ou do pedido do cliente: nada a registrar', () => {
    expect(lerPedidoDoCliente('{"data":{"order_id":1}}', 'cancelamento')).toBeNull();
  });
});

describe('o ajuste da 99', () => {
  it('padrão: decidir o cancelamento na fila; o Regem recusa o reembolso em 4 h com "Other"', () => {
    expect(ajusteDa99({})).toEqual(AJUSTE_99_PADRAO);
    expect(AJUSTE_99_PADRAO).toMatchObject({ decidirCancelamento: true, reembolsoRecusarEmHoras: 4, reembolsoMotivo: 'Other' });
  });

  it('o salvo vale; o fora do permitido volta ao padrão', () => {
    expect(ajusteDa99({ atendimento99: { decidirCancelamento: false, reembolsoRecusarEmHoras: 8 } })).toMatchObject({ decidirCancelamento: false, reembolsoRecusarEmHoras: 8 });
    expect(ajusteDa99({ atendimento99: { decidirCancelamento: 'nao', reembolsoRecusarEmHoras: 30 } })).toMatchObject({ decidirCancelamento: true, reembolsoRecusarEmHoras: 4 });
  });

  it('o motivo da recusa automática sai da lista DESTE pedido: o do ajuste, senão "Other", senão o último', () => {
    const lista = lerPedidoDoCliente(REFUND, 'reembolso')!.motivosDoReembolso;
    expect(motivoDaRecusaAutomatica(lista, { ...AJUSTE_99_PADRAO, reembolsoMotivo: 'user misunderstands' })).toEqual({ id: '430005', motivo: 'User misunderstands' });
    expect(motivoDaRecusaAutomatica(lista, { ...AJUSTE_99_PADRAO, reembolsoMotivo: 'Não existe' })).toEqual({ id: '430008', motivo: 'Other' });
    expect(motivoDaRecusaAutomatica([{ id: '1', motivo: 'A' }, { id: '2', motivo: 'B' }], AJUSTE_99_PADRAO)).toEqual({ id: '2', motivo: 'B' });
    expect(motivoDaRecusaAutomatica([], AJUSTE_99_PADRAO)).toBeNull();
  });
});

describe('a resposta conferida antes de ir à 99', () => {
  const cancel = lerPedidoDoCliente(CANCEL, 'cancelamento')!;
  const refund = lerPedidoDoCliente(REFUND, 'reembolso')!;

  it('aceitar: sem motivo', () => {
    expect(montarRespostaAo99(cancel, { aceita: true })).toMatchObject({ aceita: true, motivo: null, resumo: { acao: 'aceitar' } });
  });

  it('recusar o cancelamento: só um motivo da lista que veio', () => {
    expect(montarRespostaAo99(cancel, { aceita: false, motivo: 'preparing' })).toMatchObject({ aceita: false, motivo: 'preparing' });
    expect(() => montarRespostaAo99(cancel, { aceita: false, motivo: 'porque sim' })).toThrow('Escolha o motivo da recusa na lista da 99.');
  });

  it('recusar o reembolso: o motivo pelo id da lista, com a explicação', () => {
    expect(montarRespostaAo99(refund, { aceita: false, motivoId: '430005', explicacao: 'conferido na sacola' })).toMatchObject({
      recusa: { baseId: '430005', base: 'User misunderstands', explicacao: 'conferido na sacola' },
    });
    expect(() => montarRespostaAo99(refund, { aceita: false, motivoId: '999' })).toThrow('Escolha o motivo da recusa na lista da 99.');
  });

  it('aceita ausente ou fora de true/false: recusa (V15)', () => {
    expect(() => montarRespostaAo99(cancel, {})).toThrow('Informe "aceita" (true ou false).');
  });
});
