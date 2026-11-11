import { TAXAS_PADRAO, completarTaxas, conferirTaxas } from './taxas.regras';

// "％ Taxas e margem" (R3 F5): os valores de referência, a conferência de cada número (com a frase do campo) e o "o que não
// veio fica" (V16).

describe('as taxas e a margem da loja', () => {
  it('os valores de referência do protótipo: iFood 12% / 23% + 3,2%; 99 10,9% / 8,9% + 3,2%; o resto vem das vendas', () => {
    expect(TAXAS_PADRAO.ifood).toMatchObject({ plano: 'loja', baseComissao: 'loja', loja: { com: 12, pag: 3.2 }, app: { com: 23, pag: 3.2 } });
    expect(TAXAS_PADRAO['99food']).toMatchObject({ plano: 'app', baseComissao: 'cliente', loja: { com: 10.9 }, app: { com: 8.9 } });
    expect(TAXAS_PADRAO.geral).toMatchObject({ impostoModo: 'simples', margem: 20, rbt12: null, itensPedido: null });
    expect([TAXAS_PADRAO.ifood.parteNaEntrega, TAXAS_PADRAO['99food'].parteNaEntrega]).toEqual([null, null]);
  });

  it('confere cada número contra a faixa e diz o campo; o que não veio fica como estava', () => {
    const t = conferirTaxas({ ifood: { plano: 'app', app: { com: '25,5', taxaFixa: 4 } }, geral: { margem: 18, rbt12: '540.000,00', arred: false } }, TAXAS_PADRAO);
    expect(t.ifood).toMatchObject({ plano: 'app', app: { com: 25.5, pag: 3.2, taxaFixa: 4 }, loja: { com: 12 } });
    expect(t.geral).toMatchObject({ margem: 18, rbt12: 540000, arred: false, imposto: 6 });
    expect(t['99food']).toEqual(TAXAS_PADRAO['99food']);
    // `null` volta ao número das vendas
    expect(conferirTaxas({ geral: { rbt12: null, itensPedido: '' } }, t).geral).toMatchObject({ rbt12: null, itensPedido: null });
    expect(() => conferirTaxas({ ifood: { loja: { com: 120 } } }, TAXAS_PADRAO)).toThrow('Comissão do iFood (a loja entrega): use um número de 0 a 100.');
    expect(() => conferirTaxas({ '99food': { app: { taxaFixa: 'x' } } }, TAXAS_PADRAO)).toThrow('Taxa fixa por entrega da 99 (a 99 entrega)');
    expect(() => conferirTaxas({ geral: { margem: 95 } }, TAXAS_PADRAO)).toThrow('Margem (%): use um número de 0 a 90.');
    expect(() => conferirTaxas({ geral: { itensPedido: 0 } }, TAXAS_PADRAO)).toThrow('Itens por pedido');
    expect(() => conferirTaxas({ geral: { imposto: null } }, TAXAS_PADRAO)).toThrow('Imposto médio (%): informe um número.');
    expect(() => conferirTaxas({ ifood: { plano: 'moto' } }, TAXAS_PADRAO)).toThrow('O plano do iFood');
    expect(() => conferirTaxas({ geral: { antecipa: 'sim' } }, TAXAS_PADRAO)).toThrow('"Antecipo"');
  });

  it('completar: sem nada = os de referência; uma parte estragada não estraga as outras', () => {
    expect(completarTaxas(null)).toEqual(TAXAS_PADRAO);
    const t = completarTaxas({ ifood: { loja: { com: 999 } }, geral: { margem: 25 }, '99food': { plano: 'loja' } });
    expect(t.ifood).toEqual(TAXAS_PADRAO.ifood);
    expect(t.geral.margem).toBe(25);
    expect(t['99food'].plano).toBe('loja');
  });
});
