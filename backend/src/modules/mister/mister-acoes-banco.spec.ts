import { ACOES, conferirAcao, sigaDaAcao } from './mister-acoes';
import { apresentacaoDaClassificacao, conferirClassificacao, resumoDaClassificacao, rotuloDoTipo } from './mister-acoes-banco';
import { instanteDeSaoPaulo } from '../../common/pedido-agendado';

// Versão 9, O5: classificar o lançamento do extrato pela conversa (puro). O banco e o PIN em `mister-pg.teste-spec.ts`.

const HOJE = '2026-11-24';
const AGORA = instanteDeSaoPaulo(`${HOJE}T20:00`)!;

describe('Mister · O5 — classificar o lançamento do banco', () => {
  it('é de PIN, pela permissão do Financeiro e com "Ver valores em R$"', () => {
    expect(ACOES.classificar_banco).toMatchObject({ nivel: 'pin', permissao: 'financeiro', prazoMin: 15, pedeVerValores: true });
    expect(sigaDaAcao('classificar_banco')).toContain('Abrir no Regem');
  });

  it('o dia (de hoje para trás), o valor sem sinal em centavos, o tipo da lista da tela e o "lembrar"', () => {
    expect(conferirAcao('classificar_banco', { diaDoLancamento: '2026-11-20', valorDoLancamento: -1200, tipoDoLancamento: 'retirada_dono', lembrarNosProximos: true }, AGORA)).toEqual({
      parametros: { acao: 'classificar_banco', dia: '2026-11-20', valorCentavos: 120000, trecho: null, tipo: 'retirada_dono', lembrar: true },
      resumo: '',
    });
    expect(conferirClassificacao({ diaDoLancamento: '2026-11-20', valorDoLancamento: 50.5, tipoDoLancamento: 'imposto', trechoDoLancamento: ' tarifa  pix ' }, HOJE)).toMatchObject({
      parametros: { valorCentavos: 5050, trecho: 'tarifa pix', lembrar: false },
    });
  });

  it('recusa: dia futuro ou fora do formato, valor zero ou em texto, tipo fora da lista', () => {
    const ruins: Record<string, unknown>[] = [
      { diaDoLancamento: '2026-11-25', valorDoLancamento: 10, tipoDoLancamento: 'imposto' },
      { diaDoLancamento: '20/11/2026', valorDoLancamento: 10, tipoDoLancamento: 'imposto' },
      { diaDoLancamento: '2026-02-30', valorDoLancamento: 10, tipoDoLancamento: 'imposto' },
      { diaDoLancamento: '2026-11-20', valorDoLancamento: 0, tipoDoLancamento: 'imposto' },
      { diaDoLancamento: '2026-11-20', valorDoLancamento: '10', tipoDoLancamento: 'imposto' },
      { diaDoLancamento: '2026-11-20', valorDoLancamento: 10, tipoDoLancamento: 'propina' },
      { diaDoLancamento: '2026-11-20', valorDoLancamento: 10 },
    ];
    for (const en of ruins) expect(conferirClassificacao(en, HOJE)).toHaveProperty('erro');
  });

  it('o resumo e a página do PIN: entrada ou saída, o tipo pelo nome da tela, e que nenhum dinheiro se move', () => {
    const l = { data: '2026-11-20', descricao: 'PIX ENVIADO J S', valorCentavos: -120000 };
    expect(resumoDaClassificacao(l, 'retirada_dono', true)).toBe(
      'Marcar o lançamento de 20/11/2026 "PIX ENVIADO J S" (saída de R$ 1.200,00) como Retirada do dono, e os próximos com a mesma descrição já entram assim. Fica em Financeiro › Banco e repasses; nenhum dinheiro se move.',
    );
    expect(resumoDaClassificacao({ ...l, valorCentavos: 5050 }, 'outra_entrada', false)).toContain('(entrada de R$ 50,50) como Outra entrada da loja. Fica');
    expect(apresentacaoDaClassificacao({ ...l, tipo: 'retirada_dono', lembrar: true })).toEqual({
      titulo: 'Classificar o lançamento do banco',
      itens: ['Dia: 20/11/2026', 'No extrato: PIX ENVIADO J S', 'Vai como: Retirada do dono', 'Os próximos com a mesma descrição entram assim'],
      detalhe: 'Fica em Financeiro › Banco e repasses. Nenhum dinheiro se move.',
      valor: 1200,
      botao: 'Classificar',
    });
    expect(rotuloDoTipo('nao_e_da_loja')).toBe('Não é da loja');
  });
});
