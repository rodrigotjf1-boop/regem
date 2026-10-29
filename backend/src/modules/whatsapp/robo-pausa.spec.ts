import { decidirPausa, pausaDaConversa } from './robo-pausa';

// A REGRA do robô calado numa conversa (Fase 1 do robô, mig 342), caso a caso e sem banco. As consultas que alimentam
// esta decisão estão em robo-pausa-pg.spec.ts (Postgres real).
const T0 = new Date('2026-10-29T15:00:00.000Z');
const min = (n: number) => new Date(T0.getTime() + n * 60_000);
const chamado = (abertoEm: Date) => ({ id: 'c1', tipo: 'humano', pedidoNumero: '12', criadoEm: abertoEm });

describe('robô calado numa conversa — a decisão', () => {
  it('sem pausa nem chamado: o robô responde', () => {
    const e = decidirPausa({ pausa: null, chamado: null, minutos: 60, resolvidoEm: null, agora: T0 });
    expect(e).toEqual({ pausado: false, ate: null, motivo: null, chamado: null });
  });

  it('o atendente respondeu: calado até o fim do prazo, e volta sozinho depois', () => {
    const pausa = { ate: min(60), motivo: 'atendente', atualizadoEm: T0 };
    expect(decidirPausa({ pausa, chamado: null, minutos: 60, resolvidoEm: null, agora: min(30) })).toMatchObject({
      pausado: true,
      ate: min(60),
      motivo: 'atendente',
    });
    expect(decidirPausa({ pausa, chamado: null, minutos: 60, resolvidoEm: null, agora: min(61) }).pausado).toBe(false);
  });

  it('pausa "até eu retomar" (sem prazo) não vence sozinha', () => {
    const pausa = { ate: null, motivo: 'manual', atualizadoEm: T0 };
    const e = decidirPausa({ pausa, chamado: null, minutos: 60, resolvidoEm: null, agora: min(60 * 24 * 7) });
    expect(e).toMatchObject({ pausado: true, ate: null, motivo: 'manual' });
  });

  it('o robô chamou o atendente: fica calado pelo prazo da loja, contado da abertura do chamado', () => {
    const c = chamado(T0);
    expect(decidirPausa({ pausa: null, chamado: c, minutos: 30, resolvidoEm: null, agora: min(10) })).toMatchObject({
      pausado: true,
      ate: min(30),
      motivo: 'chamado',
      chamado: c,
    });
    // Ninguém atendeu em 30 min: o robô volta a responder (o chamado continua aberto e aparece na caixa).
    expect(decidirPausa({ pausa: null, chamado: c, minutos: 30, resolvidoEm: null, agora: min(31) })).toMatchObject({
      pausado: false,
      chamado: c,
    });
  });

  it('loja com prazo 0 ("até alguém retomar"): chamado aberto cala até ser resolvido', () => {
    const e = decidirPausa({ pausa: null, chamado: chamado(T0), minutos: 0, resolvidoEm: null, agora: min(600) });
    expect(e).toMatchObject({ pausado: true, ate: null, motivo: 'chamado' });
  });

  it('RESOLVER o chamado devolve a conversa ao robô, mesmo com a pausa do atendente no prazo', () => {
    const pausa = { ate: min(60), motivo: 'atendente', atualizadoEm: min(5) };
    const e = decidirPausa({ pausa, chamado: null, minutos: 60, resolvidoEm: min(20), agora: min(21) });
    expect(e.pausado).toBe(false);
  });

  it('chamado resolvido ANTES da pausa não encerra a pausa nova', () => {
    const pausa = { ate: min(60), motivo: 'manual', atualizadoEm: min(30) };
    const e = decidirPausa({ pausa, chamado: null, minutos: 60, resolvidoEm: min(10), agora: min(31) });
    expect(e.pausado).toBe(true);
  });

  it('Retomar vale contra o chamado já aberto; chamado aberto DEPOIS do Retomar cala de novo', () => {
    const retomado = { ate: min(10), motivo: 'retomado', atualizadoEm: min(10) };
    expect(
      decidirPausa({ pausa: retomado, chamado: chamado(T0), minutos: 60, resolvidoEm: null, agora: min(11) }).pausado,
    ).toBe(false);
    expect(
      decidirPausa({ pausa: retomado, chamado: chamado(min(20)), minutos: 60, resolvidoEm: null, agora: min(21) })
        .pausado,
    ).toBe(true);
  });

  it('pausa e chamado juntos: vale o fim mais distante; um deles sem prazo deixa sem prazo', () => {
    const pausa = { ate: min(15), motivo: 'atendente', atualizadoEm: T0 };
    expect(
      decidirPausa({ pausa, chamado: chamado(T0), minutos: 60, resolvidoEm: null, agora: min(5) }),
    ).toMatchObject({ pausado: true, ate: min(60), motivo: 'atendente' });
    const semPrazo = { ate: null, motivo: 'manual', atualizadoEm: T0 };
    expect(
      decidirPausa({ pausa: semPrazo, chamado: chamado(T0), minutos: 60, resolvidoEm: null, agora: min(5) }).ate,
    ).toBeNull();
  });
});

describe('a conversa na caixa', () => {
  it('pausa antiga (vetor robo_pausados) ainda aparece como pausada, sem prazo', () => {
    const r = pausaDaConversa(new Map(), new Set(['5521999998888']), '5521999998888');
    expect(r).toEqual({ pausada: true, pausadaAte: null, pausaMotivo: 'manual', chamado: null });
  });

  it('conversa sem telefone resolvido (só @lid) sai sem pausa', () => {
    expect(pausaDaConversa(new Map(), new Set(), '')).toMatchObject({ pausada: false, chamado: null });
  });
});
