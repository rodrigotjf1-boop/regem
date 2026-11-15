import { EntradaDoQueMelhorar, MOTIVO_NA_QUALIDADE, motivoNaQualidade, motivosAgrupados, nomeDaConsultaNaQualidade, padroesParaMelhorar, pct, periodoDaQualidade, temasAgrupados } from './mister-qualidade';
import { fraseDoMotivo } from './mister-agente.regras';

// O Mentor, parte 1: o que melhorar — cada padrão com a observação, a causa provável e a proposta, por regras fixas.
describe('a qualidade do Mister — o que melhorar', () => {
  const vazio: EntradaDoQueMelhorar = { temas: [], consultas: [], avaliacao: null, motivosDaEmpresa: [] };

  it('sem padrão, nada a melhorar', () => {
    expect(padroesParaMelhorar(vazio)).toEqual([]);
  });

  it('o tema que mais faltou (3 vezes ou mais, fora "outro assunto") = falta consulta', () => {
    const p = padroesParaMelhorar({ ...vazio, temas: [{ tema: 'outro assunto', quantas: 20, empresas: 4 }, { tema: 'clientes', quantas: 2, empresas: 1 }, { tema: 'estoque e compras', quantas: 8, empresas: 3 }] });
    expect(p).toEqual([{ causa: 'falta_consulta', observacao: '"estoque e compras" faltou 8 vezes, em 3 empresas (o que mais faltou)', porque: 'nenhuma consulta do Mister traz esse dado', proposta: 'Consulta nova de estoque e compras · abrir tarefa' }]);
    expect(padroesParaMelhorar({ ...vazio, temas: [{ tema: 'clientes', quantas: 2, empresas: 1 }] })).toEqual([]);
    expect(padroesParaMelhorar({ ...vazio, temas: [{ tema: 'clientes', quantas: 3, empresas: 1 }] })[0].observacao).toBe('"clientes" faltou 3 vezes, em 1 empresa (o que mais faltou)');
  });

  it('a consulta com 10 usos ou mais que falha mais de 10% = erro na consulta (até 3, a pior primeiro)', () => {
    const p = padroesParaMelhorar({
      ...vazio,
      consultas: [
        { nome: 'historia do pedido', vezes: 37, falhas: 5 },
        { nome: 'resumo do dia', vezes: 100, falhas: 10 },
        { nome: 'caixas e sangrias', vezes: 9, falhas: 5 },
        { nome: 'cancelamentos', vezes: 10, falhas: 4 },
      ],
    });
    expect(p.map((x) => x.observacao)).toEqual(['"cancelamentos" não leu 4 vezes, de 10 (40%)', '"historia do pedido" não leu 5 vezes, de 37 (14%)']);
    expect(p[0]).toMatchObject({ causa: 'erro_na_consulta', porque: 'a mesma consulta falhando mais de 10%', proposta: 'Ver o log das 4 falhas · abrir tarefa' });
  });

  it('a última avaliação com erradas = instrução; com tudo certo, nada', () => {
    const p = padroesParaMelhorar({ ...vazio, avaliacao: { quando: '14/11', acertos: 38, total: 40, primeiraErrada: { pergunta: 'Quanto vendi no iFood ontem?', falha: 'a resposta não traz 1.688,35' } } });
    expect(p).toEqual([
      { causa: 'instrucao', observacao: 'A avaliação de 14/11 errou 2 de 40: "Quanto vendi no iFood ontem?" — a resposta não traz 1.688,35', porque: 'a resposta não bateu com a conferência da pergunta fixa', proposta: 'Ver as erradas na avaliação, ajustar a instrução ou a consulta e rodar de novo' },
    ]);
    expect(padroesParaMelhorar({ ...vazio, avaliacao: { quando: '15/11', acertos: 40, total: 40, primeiraErrada: null } })).toEqual([]);
  });

  it('o motivo da empresa (3 ou mais) = da empresa, com a empresa quando é uma só', () => {
    const p = padroesParaMelhorar({
      ...vazio,
      motivosDaEmpresa: [
        { motivo: 'a chave de IA da empresa foi recusada', quantas: 6, empresas: 1, empresa: 'Pizzaria do Porto' },
        { motivo: 'sem crédito na conta de IA', quantas: 4, empresas: 2, empresa: null },
        { motivo: 'a empresa não tem chave de IA', quantas: 2, empresas: 1, empresa: 'X' },
      ],
    });
    expect(p.map((x) => x.observacao)).toEqual(['"a chave de IA da empresa foi recusada" em 6 perguntas, todas da Pizzaria do Porto', '"sem crédito na conta de IA" em 4 perguntas, em 2 empresas']);
    expect(p[0]).toMatchObject({ causa: 'da_empresa', proposta: 'Nada nas instruções · a empresa resolve no menu Mister, em "IA e uso"' });
  });

  it('a ordem: o que falta, o que quebra, a avaliação e o que é da empresa', () => {
    const p = padroesParaMelhorar({
      temas: [{ tema: 'clientes', quantas: 5, empresas: 2 }],
      consultas: [{ nome: 'cancelamentos', vezes: 10, falhas: 4 }],
      avaliacao: { quando: '14/11', acertos: 39, total: 40, primeiraErrada: null },
      motivosDaEmpresa: [{ motivo: 'sem crédito na conta de IA', quantas: 3, empresas: 1, empresa: 'Y' }],
    });
    expect(p.map((x) => x.causa)).toEqual(['falta_consulta', 'erro_na_consulta', 'instrucao', 'da_empresa']);
    expect(p[2].observacao).toBe('A avaliação de 14/11 errou 1 de 40');
  });
});

// F5.2: o que pediram e o Mister não tem, por tema (o tema fora da lista soma em "outro assunto").
describe('a qualidade do Mister — o que falta', () => {
  it('os temas somam pelo texto do console, do maior para o menor; o que não é da lista vira "outro assunto"', () => {
    expect(
      temasAgrupados([
        { tema: 'estoque', n: 3 },
        { tema: 'financeiro', n: 1 },
        { tema: 'inventado', n: 1 },
        { tema: null, n: 1 },
        { tema: 'outro', n: 1 },
      ]),
    ).toEqual([
      { tema: 'estoque e compras', quantas: 3 },
      { tema: 'outro assunto', quantas: 3 },
      { tema: 'financeiro e contas', quantas: 1 },
    ]);
    expect(temasAgrupados([])).toEqual([]);
  });
});

// F5, parte 1: a qualidade do Mister no console (só números).
describe('a qualidade do Mister', () => {
  it('o período: 7 ou 30 dias; qualquer outra coisa vira 7', () => {
    expect(periodoDaQualidade(30)).toBe(30);
    expect(periodoDaQualidade('30')).toBe(30);
    expect(periodoDaQualidade(7)).toBe(7);
    expect(periodoDaQualidade('90')).toBe(7);
    expect(periodoDaQualidade(undefined)).toBe(7);
  });

  it('todo motivo de não responder tem o seu texto (a lista é a mesma do agente)', () => {
    // `fraseDoMotivo` cobre a mesma união: um motivo novo no agente sem texto aqui cai em "outro motivo" — este teste pega.
    for (const m of Object.keys(MOTIVO_NA_QUALIDADE)) {
      expect(motivoNaQualidade(m)).not.toBe('outro motivo');
      expect(() => fraseDoMotivo(m as any, 'presidente')).not.toThrow();
    }
    expect(motivoNaQualidade('inventado')).toBe('outro motivo');
    expect(motivoNaQualidade(null)).toBe('outro motivo');
  });

  it('os motivos que dizem a mesma coisa somam, do maior para o menor', () => {
    expect(
      motivosAgrupados([
        { motivo: 'indisponivel', n: 2 },
        { motivo: 'erro', n: 1 },
        { motivo: 'chave_recusada', n: 4 },
        { motivo: 'demorou', n: 1 },
        { motivo: 'interrompida', n: 1 },
      ]),
    ).toEqual([
      { motivo: 'a chave de IA da empresa foi recusada', quantas: 4 },
      { motivo: 'a IA não respondeu (passageiro)', quantas: 3 },
      { motivo: 'passou do tempo', quantas: 2 },
    ]);
  });

  it('o nome da consulta e o percentual', () => {
    expect(nomeDaConsultaNaQualidade('resumo_do_dia')).toBe('resumo do dia');
    expect(nomeDaConsultaNaQualidade('')).toBe('consulta sem nome');
    expect(pct(395, 412)).toBe(96);
    expect(pct(1, 0)).toBe(0);
  });
});
