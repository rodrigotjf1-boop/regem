import { MOTIVO_NA_QUALIDADE, motivoNaQualidade, motivosAgrupados, nomeDaConsultaNaQualidade, pct, periodoDaQualidade, temasAgrupados } from './mister-qualidade';
import { fraseDoMotivo } from './mister-agente.regras';

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
