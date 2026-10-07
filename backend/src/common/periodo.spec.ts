import { BadRequestException } from '@nestjs/common';
import { periodoDaConsulta } from './periodo';

// Período das listas de histórico (`?inicio=&fim=`): ausente não limita; data errada é 400.
describe('período da consulta', () => {
  it('sem nada (ou vazio) não limita — quem não manda continua recebendo tudo', () => {
    expect(periodoDaConsulta()).toEqual({ inicio: null, fim: null });
    expect(periodoDaConsulta('', '')).toEqual({ inicio: null, fim: null });
    expect(periodoDaConsulta(undefined, '2026-10-07')).toEqual({ inicio: null, fim: '2026-10-07' });
    expect(periodoDaConsulta('2026-09-07')).toEqual({ inicio: '2026-09-07', fim: null });
  });

  it('aceita o período certo, inclusive de um dia só', () => {
    expect(periodoDaConsulta('2026-09-07', '2026-10-07')).toEqual({ inicio: '2026-09-07', fim: '2026-10-07' });
    expect(periodoDaConsulta('2026-10-07', '2026-10-07')).toEqual({ inicio: '2026-10-07', fim: '2026-10-07' });
    expect(periodoDaConsulta('2028-02-29', '2028-03-01').inicio).toBe('2028-02-29'); // bissexto
  });

  it('recusa formato errado, data que não existe e o que não é texto', () => {
    for (const ruim of ['07/10/2026', '2026-10-7', '2026-13-01', '2026-02-31', '2027-02-29', 'ontem', '2026-10-07T10:00:00Z', "2026-10-07' or 1=1 --"])
      expect(() => periodoDaConsulta(ruim)).toThrow(BadRequestException);
    expect(() => periodoDaConsulta(['2026-10-01', '2026-10-02'])).toThrow(/AAAA-MM-DD/);
    expect(() => periodoDaConsulta('2026-10-01', 20261007)).toThrow(/fim/);
  });

  it('recusa período invertido', () => {
    expect(() => periodoDaConsulta('2026-10-08', '2026-10-07')).toThrow(/início do período é depois do fim/);
  });
});
