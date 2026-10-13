import { linhaEntra, PEDIDO_EXTERNO, SO_INGREDIENTES, type CanalDaFicha } from './embalagem-da-ficha';

// Quem entra em qual venda: ingrediente, embalagem do balcão e embalagem do delivery — com a
// empresa usando dois cadastros (o padrão) ou a mesma embalagem nos dois.
describe('embalagem na ficha técnica: a linha entra na venda?', () => {
  const ingrediente = {};
  const doBalcao = { somenteBalcao: true };
  const doDelivery = { somenteDelivery: true };
  const CANAIS: CanalDaFicha[] = ['balcao', 'delivery', 'nenhum'];

  it('o ingrediente entra em toda venda, com a chave ligada ou desligada', () => {
    for (const canal of CANAIS) for (const mesma of [false, true]) expect([canal, mesma, linhaEntra(ingrediente, canal, mesma)]).toEqual([canal, mesma, true]);
    expect(linhaEntra({ somenteBalcao: false, somenteDelivery: null }, 'balcao', false)).toBe(true);
  });

  it('dois cadastros (o padrão): cada venda usa o seu', () => {
    expect(linhaEntra(doBalcao, 'balcao', false)).toBe(true);
    expect(linhaEntra(doBalcao, 'delivery', false)).toBe(false);
    expect(linhaEntra(doDelivery, 'delivery', false)).toBe(true);
    expect(linhaEntra(doDelivery, 'balcao', false)).toBe(false); // a conta de sempre: balcão não leva a embalagem do delivery
  });

  it('mesma embalagem: a do delivery vale para as duas vendas e a do balcão não conta em nenhuma', () => {
    expect(linhaEntra(doDelivery, 'balcao', true)).toBe(true);
    expect(linhaEntra(doDelivery, 'delivery', true)).toBe(true);
    expect(linhaEntra(doBalcao, 'balcao', true)).toBe(false);
    expect(linhaEntra(doBalcao, 'delivery', true)).toBe(false);
  });

  it('só os ingredientes (produção, feito na loja, perda na cozinha): nenhuma embalagem', () => {
    for (const mesma of [false, true]) {
      expect(linhaEntra(doBalcao, 'nenhum', mesma)).toBe(false);
      expect(linhaEntra(doDelivery, 'nenhum', mesma)).toBe(false);
    }
    expect(SO_INGREDIENTES).toEqual({ canal: 'nenhum', mesmaEmbalagem: false });
    expect(PEDIDO_EXTERNO).toEqual({ canal: 'delivery', mesmaEmbalagem: false });
  });
});
