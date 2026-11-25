import { apresentacaoDoCaixa, conferirCaixa, lerCaixa, nomeDoCaixa, resumoDaSangria, resumoDoFechamento } from './mister-acoes-caixa';
import { ACOES_DO_MISTER, ACOES, conferirAcao } from './mister-acoes';

describe('o caixa à distância pela conversa (etapa 1 de 24/11)', () => {
  it('qual caixa: o balcão e o delivery pelo que a pessoa diz', () => {
    expect(lerCaixa('balcão')).toBe('pdv');
    expect(lerCaixa('Caixa 1')).toBe('pdv');
    expect(lerCaixa('o do salão')).toBe('pdv');
    expect(lerCaixa('delivery')).toBe('delivery');
    expect(lerCaixa('entregas')).toBe('delivery');
    expect(lerCaixa('')).toBeNull();
    expect(lerCaixa('cozinha')).toBeNull();
  });

  it('as duas ações são de PIN e pedem o PDV; a sangria pede "Ver valores"', () => {
    expect(ACOES_DO_MISTER).toEqual(expect.arrayContaining(['fechar_caixa', 'sangria']));
    expect(ACOES.fechar_caixa).toMatchObject({ nivel: 'pin', permissao: 'pdv' });
    expect(ACOES.sangria).toMatchObject({ nivel: 'pin', permissao: 'pdv', pedeVerValores: true });
  });

  it('o fechamento é cego: o dinheiro contado OU sem contagem, nunca os dois nem nenhum', () => {
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'balcão' })).toEqual({ erro: 'O fechamento é cego: diga quanto de dinheiro foi contado na gaveta, ou que fecha sem contagem.' });
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'balcão', semContagem: true, dinheiroContado: 10 })).toEqual({ erro: 'Ou a pessoa contou o dinheiro, ou fecha sem contagem: não os dois.' });
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'balcão', dinheiroContado: -1 })).toEqual({ erro: 'O dinheiro contado é um valor em reais (0 ou mais).' });
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'balcão', dinheiroContado: '200' })).toEqual({ erro: 'O dinheiro contado é um valor em reais (0 ou mais).' });
    expect(conferirCaixa('fechar_caixa', { semContagem: true })).toEqual({ erro: 'Diga qual caixa: o do balcão ou o do delivery.' });
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'balcão', semContagem: true })).toEqual({
      parametros: { acao: 'fechar_caixa', caixa: 'pdv', operador: null, dinheiroContado: null, semContagem: true, motivo: null },
      resumo: 'Fechar o caixa do balcão sem contagem.',
    });
    expect(conferirCaixa('fechar_caixa', { caixaDaLoja: 'delivery', dinheiroContado: 152.456, operadorDoCaixa: '  Bruna  ', motivoDoCaixa: 'pedido preso no iFood' })).toEqual({
      parametros: { acao: 'fechar_caixa', caixa: 'delivery', operador: 'Bruna', dinheiroContado: 152.46, semContagem: false, motivo: 'pedido preso no iFood' },
      resumo: 'Fechar o caixa do delivery com R$ 152,46 de dinheiro contado.',
    });
  });

  it('a sangria: valor positivo em reais e o motivo', () => {
    expect(conferirCaixa('sangria', { caixaDaLoja: 'balcão', motivoDoCaixa: 'gás' })).toEqual({ erro: 'Diga o valor da sangria em reais.' });
    expect(conferirCaixa('sangria', { caixaDaLoja: 'balcão', valorDaSangria: 0, motivoDoCaixa: 'gás' })).toEqual({ erro: 'Diga o valor da sangria em reais.' });
    expect(conferirCaixa('sangria', { caixaDaLoja: 'balcão', valorDaSangria: 50 })).toEqual({ erro: 'Diga o motivo da sangria (ex.: "pagar o gás", "dinheiro demais na gaveta").' });
    expect(conferirCaixa('sangria', { caixaDaLoja: 'balcão', valorDaSangria: 200, motivoDoCaixa: 'pagar o gás' })).toEqual({
      parametros: { acao: 'sangria', caixa: 'pdv', operador: null, valor: 200, motivo: 'pagar o gás' },
      resumo: 'Lançar a sangria de R$ 200,00 (motivo: pagar o gás) no caixa do balcão.',
    });
  });

  it('a conferência geral despacha para a do caixa (a mesma que a avaliação usa)', () => {
    expect(conferirAcao('sangria', { caixaDaLoja: 'balcão', valorDaSangria: 200, motivoDoCaixa: 'pagar o gás' })).toMatchObject({ parametros: { acao: 'sangria', valor: 200 } });
    expect(conferirAcao('fechar_caixa', { caixaDaLoja: 'delivery' })).toMatchObject({ erro: expect.stringContaining('fechamento é cego') });
  });

  it('o nome do caixa achado, os resumos e a página do PIN (o fechamento sem o esperado)', () => {
    const nome = nomeDoCaixa({ caixa: 'pdv', terminal: 'PDV 1', abertoPor: 'Bruna', abertoEm: '23/11 18:02', abertoHaHoras: 26.4 });
    expect(nome).toBe('o caixa do balcão (PDV 1, aberto por Bruna em 23/11 18:02, há 26,4 h)');
    expect(nomeDoCaixa({ caixa: 'delivery', terminal: null, abertoPor: null, abertoEm: '24/11 10:00', abertoHaHoras: 2 })).toBe('o caixa do delivery (aberto em 24/11 10:00, há 2 h)');
    const fechar = { acao: 'fechar_caixa' as const, caixa: 'pdv' as const, operador: null, dinheiroContado: null, semContagem: true, motivo: null };
    expect(resumoDoFechamento(nome, fechar, 0)).toBe(
      'Fechar o caixa do balcão (PDV 1, aberto por Bruna em 23/11 18:02, há 26,4 h), sem contagem: tudo o que não foi contado fica como diferença no relatório de turnos. O comprovante sai na impressora do caixa.',
    );
    expect(resumoDoFechamento('o caixa do delivery (aberto em 24/11 10:00, há 2 h)', { ...fechar, caixa: 'delivery', motivo: 'pedido preso no iFood' }, 2)).toContain(
      'Há 2 entregas pendentes: fecha mesmo assim, com o motivo "pedido preso no iFood" na auditoria.',
    );
    expect(resumoDaSangria(nome, { acao: 'sangria', caixa: 'pdv', operador: null, valor: 200, motivo: 'pagar o gás' })).toBe(
      'Lançar a sangria de R$ 200,00 (motivo: pagar o gás) no caixa do balcão (PDV 1, aberto por Bruna em 23/11 18:02, há 26,4 h). O comprovante sai na impressora do caixa; o dinheiro sai da gaveta de quem está lá.',
    );
    const pinFechar = apresentacaoDoCaixa({ ...fechar, nomeDoCaixa: nome, pendencias: 0 });
    expect(pinFechar).toEqual({
      titulo: 'Fechar o caixa',
      itens: [`Caixa: ${nome}`, 'Sem contagem'],
      detalhe: 'O fechamento é cego: a diferença aparece depois, no relatório de turnos.',
      valor: null,
      botao: 'Fechar o caixa',
    });
    expect(apresentacaoDoCaixa({ acao: 'sangria', valor: 200, motivo: 'pagar o gás', nomeDoCaixa: nome })).toMatchObject({ titulo: 'Lançar a sangria', valor: 200, botao: 'Lançar a sangria' });
  });
});
