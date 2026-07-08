import {
  horasEntre,
  pausaHoras,
  intervaloMinimoHoras,
  validarAlocacao,
  bloqueios,
  type AlocSemana,
} from './regras-escala';

describe('regras-escala (CLT)', () => {
  describe('horasEntre', () => {
    it('turno normal', () => {
      expect(horasEntre('08:00', '16:00')).toBe(8);
    });
    it('cruza a meia-noite', () => {
      expect(horasEntre('22:00', '06:00')).toBe(8);
    });
    it('aceita segundos', () => {
      expect(horasEntre('08:00:00', '12:30:00')).toBe(4.5);
    });
  });

  describe('pausaHoras', () => {
    it('sem pausa = 0', () => {
      expect(pausaHoras(null, null)).toBe(0);
      expect(pausaHoras('12:00', null)).toBe(0);
    });
    it('1h de pausa', () => {
      expect(pausaHoras('12:00', '13:00')).toBe(1);
    });
  });

  describe('intervaloMinimoHoras (art. 71)', () => {
    it('jornada > 6h → 1h', () => {
      expect(intervaloMinimoHoras(8)).toBe(1);
      expect(intervaloMinimoHoras(6.5)).toBe(1);
    });
    it('jornada 4h–6h → 15min', () => {
      expect(intervaloMinimoHoras(6)).toBe(0.25);
      expect(intervaloMinimoHoras(4.5)).toBe(0.25);
    });
    it('jornada ≤ 4h → 0', () => {
      expect(intervaloMinimoHoras(4)).toBe(0);
    });
  });

  describe('validarAlocacao', () => {
    const T8semPausa = { horaInicio: '08:00', horaFim: '16:00' };
    const T8comPausa = { horaInicio: '08:00', horaFim: '16:00', pausaInicio: '12:00', pausaFim: '13:00' };

    it('jornada 8h com 1h de pausa e sem vizinhos = sem violação', () => {
      const v = validarAlocacao({ jornadaTipo: '5x2', data: '2026-07-08', turno: T8comPausa, outrasNaSemana: [] });
      expect(v).toHaveLength(0);
    });

    it('jornada > 6h SEM intervalo = BLOQUEIO', () => {
      const v = validarAlocacao({ data: '2026-07-08', turno: T8semPausa, outrasNaSemana: [] });
      expect(bloqueios(v)).toHaveLength(1);
      expect(v[0].regra).toBe('intrajornada');
    });

    it('intervalo insuficiente (30min numa jornada de 8h) = AVISO', () => {
      const t = { horaInicio: '08:00', horaFim: '16:00', pausaInicio: '12:00', pausaFim: '12:30' };
      const v = validarAlocacao({ data: '2026-07-08', turno: t, outrasNaSemana: [] });
      expect(bloqueios(v)).toHaveLength(0);
      expect(v.find((x) => x.regra === 'intrajornada')?.nivel).toBe('aviso');
    });

    it('interjornada < 11h entre dias adjacentes = BLOQUEIO', () => {
      // fecha 08→16 hoje, abre 06→14 amanhã → só 14h? não. Testar fecho tarde + abre cedo.
      const hoje = { horaInicio: '14:00', horaFim: '23:00', pausaInicio: '18:00', pausaFim: '19:00' }; // termina 23h
      const amanha: AlocSemana = { data: '2026-07-09', turno: { horaInicio: '06:00', horaFim: '14:00', pausaInicio: '10:00', pausaFim: '11:00' } }; // abre 6h (7h depois)
      const v = validarAlocacao({ data: '2026-07-08', turno: hoje, outrasNaSemana: [amanha] });
      expect(bloqueios(v).some((x) => x.regra === 'interjornada')).toBe(true);
    });

    it('interjornada ≥ 11h = ok', () => {
      const hoje = { horaInicio: '08:00', horaFim: '16:00', pausaInicio: '12:00', pausaFim: '13:00' };
      const amanha: AlocSemana = { data: '2026-07-09', turno: { horaInicio: '08:00', horaFim: '16:00', pausaInicio: '12:00', pausaFim: '13:00' } };
      const v = validarAlocacao({ data: '2026-07-08', turno: hoje, outrasNaSemana: [amanha] });
      expect(bloqueios(v)).toHaveLength(0);
    });

    it('5x2 com 6 dias de trabalho = AVISO de folga', () => {
      const T = { horaInicio: '08:00', horaFim: '16:00', pausaInicio: '12:00', pausaFim: '13:00' };
      // semana de 2026-07-06 (seg) a 12 (dom): 5 outros dias + o atual = 6
      const outras: AlocSemana[] = ['2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11'].map((data) => ({ data, turno: T }));
      const v = validarAlocacao({ jornadaTipo: '5x2', data: '2026-07-06', turno: T, outrasNaSemana: outras });
      expect(v.find((x) => x.regra === 'folgas')?.nivel).toBe('aviso');
    });
  });
});
