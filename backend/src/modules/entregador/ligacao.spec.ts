import { ligacaoDoPedido, numeroParaDiscar } from './ligacao';

// COMO O ENTREGADOR LIGA PARA O CLIENTE (pedido do dono, 09/11/2026): no iFood, a central (0800) e o localizador do pedido
// — a forma que o iFood dá; na 99 e no cardápio, o celular direto ("na 99 não precisamos usar a central"). O formato dos
// dados é o da nuvem em 09/11: o iFood guarda o 0800 em `cliente_telefone` e manda `customer.phone` com o localizador; a
// 99 manda "+55 21…" (o app discava "5521…", que não completa no Brasil).
describe('ligação do entregador ao cliente', () => {
  const ifood = (phone: any, clienteTelefone = '08007050000') => ({ canal: 'ifood', clienteTelefone, raw: { customer: { phone } } });

  it('iFood: a central e o localizador (com a validade que o iFood manda)', () => {
    expect(ligacaoDoPedido(ifood({ number: '0800 705 0000', localizer: '1234 5678', localizerExpiration: '2026-11-10T02:30:00Z' }))).toEqual({
      tipo: 'central',
      numero: '08007050000',
      localizador: '12345678',
      validoAte: '2026-11-10T02:30:00.000Z',
    });
    // o raw guardado como texto (pedido antigo) e a validade que não é data
    expect(ligacaoDoPedido({ canal: 'ifood', clienteTelefone: '08007050000', raw: JSON.stringify({ customer: { phone: { number: '08007050000', localizer: '87654321', localizerExpiration: 'x' } } }) })).toEqual({
      tipo: 'central',
      numero: '08007050000',
      localizador: '87654321',
      validoAte: null,
    });
  });

  it('iFood sem localizador: o número do pedido, direto (nunca a central sem o código, que não completa)', () => {
    expect(ligacaoDoPedido(ifood({ number: '08007050000' }, '21987654321'))).toEqual({ tipo: 'direto', numero: '21987654321', localizador: null, validoAte: null });
  });

  it('99: o celular direto, com o "+" do DDI (a 99 manda "+55 21…"); nunca a central', () => {
    const raw = { delivery_type: 2, receive_address: { phone: '21987654321', virtual_phone_number: '06234421637', locator: '56244631' } };
    expect(ligacaoDoPedido({ canal: '99food', clienteTelefone: '+55 21987654321', raw })).toEqual({
      tipo: 'direto',
      numero: '+5521987654321',
      localizador: null,
      validoAte: null,
    });
  });

  it('cardápio: o número como o cadastro guarda (sem o 55) vai como está; com o 55 ganha o "+"', () => {
    expect(ligacaoDoPedido({ canal: 'cardapio', clienteTelefone: '(21) 98765-4321' })?.numero).toBe('21987654321');
    expect(ligacaoDoPedido({ canal: 'cardapio', clienteTelefone: '5521987654321' })?.numero).toBe('+5521987654321');
  });

  it('sem número de verdade: nada a discar (vazio, mascarado pela plataforma, curto ou longo demais)', () => {
    expect(ligacaoDoPedido({ canal: 'cardapio', clienteTelefone: null })).toBeNull();
    expect(ligacaoDoPedido({ canal: '99food', clienteTelefone: '000****1406' })).toBeNull();
    expect(numeroParaDiscar('1234')).toBeNull();
    expect(numeroParaDiscar('1234567890123456')).toBeNull();
  });
});
