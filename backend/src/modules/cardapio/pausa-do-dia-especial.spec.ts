import { pausasDeAgora, pausasDoDiaEspecial } from './pausa-do-dia-especial';
import type { DiaEspecialDoHorario } from '../../common/horario-da-data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// H3 dos dias especiais (decisão 5): o que pausar no iFood e na 99, e quando. A semana do protótipo: segunda fechada, terça a
// quinta 18–23, sexta e sábado 18–00, domingo 18–23. Horas em São Paulo (UTC−3): 18:00 = 21:00Z.
const SEMANA = [
  { dia: 0, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 1, abre: '18:00', fecha: '23:00', ativo: false },
  { dia: 2, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 3, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 4, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 5, abre: '18:00', fecha: '00:00', ativo: true },
  { dia: 6, abre: '18:00', fecha: '00:00', ativo: true },
];
const dia = (p: Partial<DiaEspecialDoHorario>): DiaEspecialDoHorario =>
  ({ id: 'e1', data: '2026-12-25', dataFim: null, nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null, conjunto: 'todos', pausarCanais: true, ...p }) as any;
const resumo = (j: any) => `${j.canal} ${j.de.toISOString()} → ${j.ate.toISOString()} ${j.ateHora ?? 'fim do dia'}`;

describe('a pausa do iFood e da 99 no dia especial (H3)', () => {
  it('dia fechado (sexta, 18–00): o iFood de 1 h antes de abrir até a meia-noite; a 99 até o fim do dia', () => {
    const p = pausasDoDiaEspecial(dia({}), SEMANA, '2026-12-25');
    expect(p.map(resumo)).toEqual([
      'ifood 2026-12-25T20:00:00.000Z → 2026-12-26T03:00:00.000Z 00:00',
      'food99 2026-12-25T20:00:00.000Z → 2026-12-26T02:59:00.000Z fim do dia',
    ]);
    expect(p.map((j) => j.chave)).toEqual(['e1:2026-12-25:ifood:18:00', 'e1:2026-12-25:food99']);
    expect(p[0].motivoTexto).toBe('Fechado hoje: Natal');
  });

  it('outro horário (quinta, das 18 às 21; o normal é até 23): só o iFood, das 21 às 23; a 99 não', () => {
    const p = pausasDoDiaEspecial(dia({ data: '2026-12-24', nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00' }), SEMANA, '2026-12-24');
    expect(p.map(resumo)).toEqual(['ifood 2026-12-25T00:00:00.000Z → 2026-12-25T02:00:00.000Z 23:00']);
    expect(p[0].motivoTexto).toBe('Hoje fechamos às 21:00: Véspera de Natal');
  });

  it('outro horário que abre mais tarde (das 20 às 23): o iFood de 1 h antes das 18 até as 20', () => {
    const p = pausasDoDiaEspecial(dia({ data: '2026-12-24', funcionamento: 'horario', abre: '20:00', fecha: '23:00' }), SEMANA, '2026-12-24');
    expect(p.map(resumo)).toEqual(['ifood 2026-12-24T20:00:00.000Z → 2026-12-24T23:00:00.000Z 20:00']);
  });

  it('nada a pausar: horário normal, a chave desligada, o dia que a loja já não abre e o dia fora do período', () => {
    expect(pausasDoDiaEspecial(dia({ funcionamento: 'normal' }), SEMANA, '2026-12-25')).toEqual([]);
    expect(pausasDoDiaEspecial(dia({ pausarCanais: false }), SEMANA, '2026-12-25')).toEqual([]);
    expect(pausasDoDiaEspecial(dia({ data: '2026-12-28' }), SEMANA, '2026-12-28')).toEqual([]); // segunda já fechada
    expect(pausasDoDiaEspecial(dia({}), SEMANA, '2026-12-26')).toEqual([]);
    // O período: cada dia tem as suas (e a sua chave).
    const periodo = dia({ data: '2027-01-12', dataFim: '2027-01-14', nome: 'Reforma' });
    expect(pausasDoDiaEspecial(periodo, SEMANA, '2027-01-13').map((j) => j.chave)).toEqual(['e1:2027-01-13:ifood:18:00', 'e1:2027-01-13:food99']);
  });

  it('a loja sem horário da semana (o dia inteiro): o iFood o dia todo, a 99 até o fim do dia', () => {
    const p = pausasDoDiaEspecial(dia({}), [], '2026-12-25');
    expect(p.map(resumo)).toEqual([
      'ifood 2026-12-25T03:00:00.000Z → 2026-12-26T03:00:00.000Z 00:00',
      'food99 2026-12-25T03:00:00.000Z → 2026-12-26T02:59:00.000Z fim do dia',
    ]);
  });

  it('as que valem agora: começou e ainda não acabou', () => {
    const p = pausasDoDiaEspecial(dia({}), SEMANA, '2026-12-25');
    expect(pausasDeAgora(p, new Date('2026-12-25T19:59:00Z'))).toEqual([]); // 16:59 em São Paulo
    expect(pausasDeAgora(p, new Date('2026-12-25T20:00:00Z')).map((j) => j.canal)).toEqual(['ifood', 'food99']);
    expect(pausasDeAgora(p, new Date('2026-12-26T02:58:30Z')).map((j) => j.canal)).toEqual(['ifood']); // a 99 já no fim do dia
    expect(pausasDeAgora(p, new Date('2026-12-26T03:00:00Z'))).toEqual([]);
  });
});
