import { LIMITE_IDENTIFICACAO_UF } from '../fiscal/destinatario';
import { fiscalParaTotem } from './fiscal-totem';

// O totem exige o CPF acima deste limite ANTES de cobrar. Se o número aqui divergir do que
// o fiscal usa para recusar a emissão, o cliente paga e a nota é recusada depois.
describe('fiscalParaTotem', () => {
  it('loja sem fiscal (ou sem configuração): sem limite nenhum', () => {
    expect(fiscalParaTotem(null)).toEqual({ ativo: false, limiteIdentificacaoCentavos: null });
    expect(fiscalParaTotem(undefined)).toEqual({ ativo: false, limiteIdentificacaoCentavos: null });
    expect(fiscalParaTotem({ ativo: false, uf: 'RJ' })).toEqual({
      ativo: false,
      limiteIdentificacaoCentavos: null,
    });
  });

  it('RJ: R$ 2.000,00 → 200000 centavos (a mesma tabela que o fiscal usa)', () => {
    expect(fiscalParaTotem({ ativo: true, uf: 'RJ' })).toEqual({
      ativo: true,
      limiteIdentificacaoCentavos: LIMITE_IDENTIFICACAO_UF.RJ * 100,
    });
    expect(LIMITE_IDENTIFICACAO_UF.RJ * 100).toBe(200000);
  });

  it('o valor configurado pela loja vence a tabela da UF', () => {
    expect(fiscalParaTotem({ ativo: true, uf: 'RJ', limiteIdentificacao: '1500.50' })).toEqual({
      ativo: true,
      limiteIdentificacaoCentavos: 150050,
    });
  });

  it('UF fora da tabela: o piso conservador do fiscal, nunca os R$ 10.000 da norma', () => {
    const r = fiscalParaTotem({ ativo: true, uf: 'ZZ' });
    expect(r.limiteIdentificacaoCentavos).toBe(
      Math.min(...Object.values(LIMITE_IDENTIFICACAO_UF)) * 100,
    );
    expect(r.limiteIdentificacaoCentavos).toBeLessThan(1_000_000);
  });
});
