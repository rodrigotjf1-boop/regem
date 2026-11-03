import {
  aniversarioValendoEntre,
  lerData,
  naSemanaDoAniversario,
  noAno,
  ocorrenciasEntre,
  semanaDe,
  textoData,
  valeDesde,
  valePara,
} from './aniversario';

// A REGRA DO ANIVERSÁRIO (Onda 3, mig 357) — um lugar só para o presente automático, o cupom "só aniversariantes" e a
// campanha de aniversariantes. O lado SQL é conferido contra este no `aniversario-pg.spec.ts`.
describe('regra do aniversário', () => {
  it('dia e mês conferidos: o dia tem de existir no mês (29/02 aceito); tipo errado é recusado', () => {
    expect(lerData({ dia: 29, mes: 2 })).toEqual({ dia: 29, mes: 2 });
    expect(lerData({ dia: 31, mes: 12 })).toEqual({ dia: 31, mes: 12 });
    expect(() => lerData({ dia: 31, mes: 4 })).toThrow('dia que existe');
    expect(() => lerData({ dia: 30, mes: 2 })).toThrow('dia que existe');
    expect(() => lerData({ dia: '5', mes: 11 })).toThrow('dia que existe');
    expect(() => lerData({ dia: 5, mes: 13 })).toThrow('mês');
    expect(() => lerData({ dia: 5 })).toThrow('mês');
    expect(textoData(5, 11)).toBe('5 de novembro');
  });

  it('29/02 em ano comum vale como 28/02', () => {
    expect(noAno(29, 2, 2027)).toBe('2027-02-28');
    expect(noAno(29, 2, 2028)).toBe('2028-02-29');
    expect(noAno(5, 11, 2026)).toBe('2026-11-05');
  });

  it('carência: a data vale para o aniversário 30 dias ou mais depois de informada (no fuso da operação)', () => {
    // informada em 06/10/2026 às 22h de Brasília (07/10 01h UTC): o dia é 06/10 → vale desde 05/11
    expect(valeDesde('2026-10-07T01:00:00Z')).toBe('2026-11-05');
    expect(valePara('2026-10-07T01:00:00Z', '2026-11-05')).toBe(true);
    expect(valePara('2026-10-07T01:00:00Z', '2026-11-04')).toBe(false);
    expect(valePara(null, '2026-11-05')).toBe(false);
  });

  it('a semana do aniversário é a de domingo a sábado que o contém', () => {
    expect(semanaDe('2026-11-05')).toEqual({ inicio: '2026-11-01', fim: '2026-11-07' }); // quinta
    expect(semanaDe('2026-11-01')).toEqual({ inicio: '2026-11-01', fim: '2026-11-07' }); // domingo
    expect(semanaDe('2026-11-07')).toEqual({ inicio: '2026-11-01', fim: '2026-11-07' }); // sábado
  });

  it('"só aniversariantes": hoje na semana do aniversário VALENDO, inclusive na virada do ano', () => {
    const marina = { dia: 5, mes: 11, informadoEm: '2026-09-10T15:00:00Z' };
    expect(naSemanaDoAniversario(marina, '2026-11-02')).toBe('2026-11-05');
    expect(naSemanaDoAniversario(marina, '2026-11-08')).toBeNull(); // domingo seguinte: outra semana
    expect(naSemanaDoAniversario({ ...marina, informadoEm: '2026-10-20T15:00:00Z' }, '2026-11-05')).toBeNull(); // menos de 30 dias
    // 31/12, informado há muito tempo: a semana de 27/12/2026 a 02/01/2027 contém o aniversário
    const rui = { dia: 31, mes: 12, informadoEm: '2025-01-10T15:00:00Z' };
    expect(naSemanaDoAniversario(rui, '2027-01-02')).toBe('2026-12-31');
    expect(naSemanaDoAniversario(rui, '2027-01-03')).toBeNull();
    expect(naSemanaDoAniversario(null, '2026-11-05')).toBeNull();
    expect(naSemanaDoAniversario({ dia: null, mes: null }, '2026-11-05')).toBeNull();
  });

  it('as ocorrências da janela olham os dois anos da virada', () => {
    expect(ocorrenciasEntre(2, 1, '2026-12-28', '2027-01-03')).toEqual(['2027-01-02']);
    expect(ocorrenciasEntre(30, 12, '2026-12-28', '2027-01-03')).toEqual(['2026-12-30']);
    expect(ocorrenciasEntre(15, 6, '2026-12-28', '2027-01-03')).toEqual([]);
    expect(aniversarioValendoEntre({ dia: 2, mes: 1, informadoEm: '2026-11-01T12:00:00Z' }, '2026-12-28', '2027-01-03')).toBe('2027-01-02');
    expect(aniversarioValendoEntre({ dia: 2, mes: 1, informadoEm: '2026-12-10T12:00:00Z' }, '2026-12-28', '2027-01-03')).toBeNull();
  });
});
