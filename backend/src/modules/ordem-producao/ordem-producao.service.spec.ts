import { qtdBaixaExplosao } from '../../common/regras-negocio';
import { OrdemProducaoService } from './ordem-producao.service';

// A conversão da ordem e a explosão da ficha são DOIS lados da mesma conta e moravam
// em arquivos diferentes: a ordem dividia pelo rendimento e a explosão dividia de novo.
// O que este teste trava não é cada metade, é o encontro das duas — produzir a ficha
// inteira tem que consumir o ingrediente inteiro, nem mais nem menos.
describe('ordem de produção — quantidade da ordem → explosão da ficha', () => {
  const svc = new OrdemProducaoService(null as any, null as any, null as any);
  const mult = (ficha: any, qtd: number) => (svc as any).multiplicadorFicha(ficha, qtd);

  // Quanto sai do estoque ao concluir uma ordem de `qtd` na ficha dada.
  const baixa = (ficha: any, qtd: number, qtdIngrediente: number, fc = 1) =>
    qtdBaixaExplosao(qtdIngrediente, fc, mult(ficha, qtd), Number(ficha.rendimento) || 1);

  describe('ficha com porção (rende 1000 ml em porções de 100 ml = 10 porções)', () => {
    const ficha = { rendimento: '1000', porcaoTamanho: '100' };
    const RECEITA = 500; // 500 g do insumo para os 1000 ml

    it('as 10 porções consomem a receita inteira', () => {
      expect(baixa(ficha, 10, RECEITA)).toBeCloseTo(500, 6);
    });

    it('1 porção consome um décimo', () => {
      expect(baixa(ficha, 1, RECEITA)).toBeCloseTo(50, 6);
    });

    it('conclusão parcial de 4 porções consome 40%', () => {
      expect(baixa(ficha, 4, RECEITA)).toBeCloseTo(200, 6);
    });

    it('o dobro das porções consome o dobro (proporcional)', () => {
      expect(baixa(ficha, 20, RECEITA)).toBeCloseTo(1000, 6);
    });
  });

  describe('ficha sem porção (a ordem é múltiplo da ficha — mig 130)', () => {
    const ficha = { rendimento: '1000', porcaoTamanho: null };

    it('1 ficha consome a receita inteira', () => {
      expect(baixa(ficha, 1, 500)).toBeCloseTo(500, 6);
    });

    it('2 fichas consomem o dobro', () => {
      expect(baixa(ficha, 2, 500)).toBeCloseTo(1000, 6);
    });
  });

  it('o fator de correção continua multiplicando a baixa', () => {
    const ficha = { rendimento: '1000', porcaoTamanho: '100' };
    expect(baixa(ficha, 10, 500, 1.2)).toBeCloseTo(600, 6);
  });

  it('ficha sem rendimento declarado trata a ordem como está (não zera a baixa)', () => {
    // rendimento 0/ausente: `qtdBaixaExplosao` usa 1, então o multiplicador não pode
    // multiplicar por 0 — senão a conclusão não baixaria nada.
    expect(baixa({ rendimento: '0', porcaoTamanho: null }, 3, 500)).toBeCloseTo(1500, 6);
  });

  // A regressão em si: enquanto o multiplicador dividia por `rendimento`, a baixa saía
  // `rendimento` vezes menor — uma ficha de 1000 ml consumia 0,5 g em vez de 500 g.
  it('não divide pelo rendimento duas vezes', () => {
    const ficha = { rendimento: '1000', porcaoTamanho: '100' };
    const errado = 500 / 1000;
    expect(baixa(ficha, 10, 500)).not.toBeCloseTo(errado, 6);
  });
});
