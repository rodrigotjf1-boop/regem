import { acharEntregador, apresentacaoDoEntregador, conferirEntregador, recusaDoAcerto, resumoDoPagamento, type LinhaDoAcerto } from './mister-acoes-entregador';
import { ACOES, conferirAcao } from './mister-acoes';

const linha = (x: Partial<LinhaDoAcerto>): LinhaDoAcerto => ({
  colaboradorId: 'id-' + (x.nome ?? 'x'),
  nome: 'Jefferson Silva',
  modelo: 'diaria_taxas',
  periodicidade: 'dia',
  periodo: { inicio: '2026-11-24', fim: '2026-11-24' },
  entregas: 14,
  diaria: 6000,
  taxas: 9255,
  total: 15255,
  turnoAberto: true,
  pagoNoTurno: false,
  pagoCentavos: 0,
  ...x,
});

describe('o acerto dos entregadores pela conversa (etapa 2 de 24/11)', () => {
  it('é de PIN, pede o Delivery e "Ver valores"', () => {
    expect(ACOES.pagar_entregador).toMatchObject({ nivel: 'pin', permissao: 'delivery', pedeVerValores: true });
  });

  it('a conferência pede só o nome (o valor nunca vem da conversa)', () => {
    expect(conferirEntregador({})).toEqual({ erro: 'Diga o nome do entregador que vai receber.' });
    expect(conferirEntregador({ entregadorDoAcerto: '  Jefferson  ', valor: 999 })).toEqual({
      parametros: { acao: 'pagar_entregador', entregador: 'Jefferson' },
      resumo: 'Pagar o acerto de Jefferson.',
    });
    expect(conferirAcao('pagar_entregador', { entregadorDoAcerto: 'Rafa' })).toMatchObject({ parametros: { acao: 'pagar_entregador', entregador: 'Rafa' } });
  });

  it('acha pelo nome igual primeiro, depois pelo que contém; dois ou nenhum viram pergunta com os nomes', () => {
    const ls = [linha({ nome: 'Jefferson Silva' }), linha({ nome: 'Rafa' }), linha({ nome: 'Rafael Costa' })];
    expect(acharEntregador(ls, 'jefferson')).toMatchObject({ linha: { nome: 'Jefferson Silva' } });
    expect(acharEntregador(ls, 'Rafa')).toMatchObject({ linha: { nome: 'Rafa' } });
    expect(acharEntregador(ls, 'raf')).toEqual({ erro: 'Há mais de um entregador com "raf": Rafa, Rafael Costa. Diga o nome inteiro.' });
    expect(acharEntregador(ls, 'Zé')).toEqual({ erro: 'Não achei o entregador "Zé". Os cadastrados: Jefferson Silva, Rafa, Rafael Costa.' });
    expect(acharEntregador([], 'Zé')).toEqual({ erro: 'Não há entregador cadastrado nesta empresa (Delivery › Entregadores).' });
  });

  it('as travas da tela: caixa de entregas fechado, já pago no turno, nada a pagar', () => {
    expect(recusaDoAcerto(linha({}))).toBeNull();
    expect(recusaDoAcerto(linha({ turnoAberto: false }))).toBe('O caixa de entregas está fechado: abra o turno para pagar (o pagamento sai como sangria dele).');
    expect(recusaDoAcerto(linha({ pagoNoTurno: true, pagoCentavos: 9840 }))).toBe('Jefferson Silva já foi pago neste turno do caixa de entregas (R$ 98,40). Um novo pagamento só no próximo turno.');
    expect(recusaDoAcerto(linha({ entregas: 0, total: 0 }))).toBe('Nada a pagar para Jefferson Silva de 24/11: não há entrega concluída sem acerto.');
  });

  it('o resumo e a página do PIN com o valor do cálculo', () => {
    expect(resumoDoPagamento(linha({}))).toBe(
      'Pagar R$ 152,55 a Jefferson Silva (diária + taxas: 14 entregas de 24/11; diária R$ 60,00 + taxas R$ 92,55). Sai como sangria do caixa de entregas, e essas entregas ficam acertadas.',
    );
    expect(resumoDoPagamento(linha({ modelo: 'so_taxas', diaria: 0, taxas: 1200, total: 1200, entregas: 1, periodo: { inicio: '2026-11-18', fim: '2026-11-24' } }))).toBe(
      'Pagar R$ 12,00 a Jefferson Silva (só taxas: 1 entrega de 18/11 a 24/11; taxas R$ 12,00). Sai como sangria do caixa de entregas, e essas entregas ficam acertadas.',
    );
    expect(apresentacaoDoEntregador({ nomeDoEntregador: 'Jefferson Silva', entregas: 14, diaria: 6000, taxas: 9255, total: 15255, periodo: { inicio: '2026-11-24', fim: '2026-11-24' } })).toEqual({
      titulo: 'Pagar o entregador',
      itens: ['Entregador: Jefferson Silva', '14 entregas de 24/11', 'Diária: R$ 60,00', 'Taxas: R$ 92,55'],
      detalhe: 'Sai como sangria do caixa de entregas; as entregas ficam acertadas.',
      valor: 152.55,
      botao: 'Pagar',
    });
  });
});
