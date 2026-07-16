import {
  horasEntre,
  pausaHoras,
  intervaloMinimoHoras,
  validarAlocacao,
  bloqueios,
  gerarDiasTrabalho,
  pausaSugerida,
  precisaPerguntarFolga,
  jornadaMaximaHoras,
  avisosDsr,
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

  // ===== Geração recorrente (Fase 1) =====
  describe('gerarDiasTrabalho', () => {
    // 2026-07-13 é uma SEGUNDA-feira.
    it('12x36: alterna dia sim / dia não a partir da data-base', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '12x36', dataInicio: '2026-07-13', dataFim: '2026-07-19' });
      expect(dias).toEqual(['2026-07-13', '2026-07-15', '2026-07-17', '2026-07-19']);
    });

    it('5x2: folga sáb/dom → trabalha seg a sex', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '5x2', dataInicio: '2026-07-13', dataFim: '2026-07-19', folgasSemana: [0, 6] });
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17']);
      expect(dias).toHaveLength(5);
    });

    it('5x2: folgas em dias arbitrários (qua/dom)', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '5x2', dataInicio: '2026-07-13', dataFim: '2026-07-19', folgasSemana: [3, 0] });
      // pula quarta (15) e domingo (19)
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-16', '2026-07-17', '2026-07-18']);
    });

    it('6x1: por dia da semana (1 folga escolhida — ex.: domingo)', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '6x1', dataInicio: '2026-07-13', dataFim: '2026-07-19', folgasSemana: [0] });
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-18']);
    });

    it('4x3: por dia da semana (3 folgas escolhidas)', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '4x3', dataInicio: '2026-07-13', dataFim: '2026-07-19', folgasSemana: [0, 6, 5] });
      // pula dom(19), sáb(18), sex(17) → trabalha seg-qui
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16']);
    });

    it('5x1: ciclo 5 dias / 1 folga (revezamento, não fecha a semana)', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '5x1', dataInicio: '2026-07-13', dataFim: '2026-07-19' });
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-15', '2026-07-16', '2026-07-17', '2026-07-19']);
    });

    it('feriado é pulado quando informado (fechar nos feriados)', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '5x2', dataInicio: '2026-07-13', dataFim: '2026-07-17', folgasSemana: [0, 6], feriados: ['2026-07-15'] });
      expect(dias).toEqual(['2026-07-13', '2026-07-14', '2026-07-16', '2026-07-17']);
    });

    it('range invertido devolve vazio', () => {
      expect(gerarDiasTrabalho({ jornadaTipo: '5x2', dataInicio: '2026-07-19', dataFim: '2026-07-13' })).toEqual([]);
    });

    it('preenche ~1 ano de 12x36 sem estourar', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '12x36', dataInicio: '2026-01-01', dataFim: '2026-12-31' });
      expect(dias.length).toBeGreaterThan(180);
      expect(dias.length).toBeLessThan(184); // ~ metade de 365
    });
  });

  describe('precisaPerguntarFolga (soma 7 = por dia da semana)', () => {
    it('12x36 e 5x1 NÃO perguntam (ciclo automático)', () => {
      expect(precisaPerguntarFolga('12x36')).toBe(false);
      expect(precisaPerguntarFolga('5x1')).toBe(false);
    });
    it('5x2, 6x1 e 4x3 perguntam os dias de folga', () => {
      expect(precisaPerguntarFolga('5x2')).toBe(true);
      expect(precisaPerguntarFolga('6x1')).toBe(true);
      expect(precisaPerguntarFolga('4x3')).toBe(true);
    });
  });

  describe('jornadaMaximaHoras + alerta CLT', () => {
    it('máximos por tipo', () => {
      expect(jornadaMaximaHoras('12x36')).toBe(12);
      expect(jornadaMaximaHoras('4x3')).toBe(11);
      expect(jornadaMaximaHoras('5x2')).toBe(8.8);
      expect(jornadaMaximaHoras('6x1')).toBe(7.34);
      expect(jornadaMaximaHoras('horista')).toBeNull();
    });
    it('12h numa 5x2 gera aviso de carga horária', () => {
      const v = validarAlocacao({
        jornadaTipo: '5x2',
        data: '2026-07-13',
        turno: { horaInicio: '08:00', horaFim: '20:00', pausaInicio: '13:00', pausaFim: '14:00' },
        outrasNaSemana: [],
      });
      expect(v.find((x) => x.regra === 'carga_horaria')?.nivel).toBe('aviso');
    });
    it('12h numa 12x36 NÃO gera aviso de carga horária', () => {
      const v = validarAlocacao({
        jornadaTipo: '12x36',
        data: '2026-07-13',
        turno: { horaInicio: '09:00', horaFim: '21:00', pausaInicio: '14:30', pausaFim: '15:30' },
        outrasNaSemana: [],
      });
      expect(v.find((x) => x.regra === 'carga_horaria')).toBeUndefined();
    });
  });

  describe('avisosDsr (1 domingo de folga/mês)', () => {
    it('mês sem domingo de folga → aviso', () => {
      // trabalha TODOS os dias de julho/2026 (inclui todos os domingos)
      const dias: string[] = [];
      for (let d = 1; d <= 31; d++) dias.push(`2026-07-${String(d).padStart(2, '0')}`);
      const v = avisosDsr(dias, '2026-07-01', '2026-07-31');
      expect(v.find((x) => x.regra === 'dsr')?.nivel).toBe('aviso');
    });
    it('mês com domingos de folga (5x2 sáb/dom) → sem aviso', () => {
      const dias = gerarDiasTrabalho({ jornadaTipo: '5x2', dataInicio: '2026-07-01', dataFim: '2026-07-31', folgasSemana: [0, 6] });
      expect(avisosDsr(dias, '2026-07-01', '2026-07-31')).toEqual([]);
    });
  });

  describe('pausaSugerida (art. 71)', () => {
    it('12x36 09:00–21:00 → 1h centralizada (14:30–15:30)', () => {
      expect(pausaSugerida('09:00', '21:00')).toEqual({ pausaInicio: '14:30', pausaFim: '15:30' });
    });
    it('jornada 8h (08:00–16:00) → 1h (11:30–12:30)', () => {
      expect(pausaSugerida('08:00', '16:00')).toEqual({ pausaInicio: '11:30', pausaFim: '12:30' });
    });
    it('jornada de 5h (08:00–13:00) → 15min', () => {
      const p = pausaSugerida('08:00', '13:00');
      expect(pausaHoras(p.pausaInicio, p.pausaFim)).toBeCloseTo(0.25, 5);
    });
    it('jornada de 4h (08:00–12:00) → sem pausa', () => {
      expect(pausaSugerida('08:00', '12:00')).toEqual({ pausaInicio: null, pausaFim: null });
    });
  });
});
