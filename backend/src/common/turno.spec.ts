import { idadeDoTurno, TURNO_LIMITE_HORAS } from './turno';

// O turno aberto há mais de 24 horas pede o fechamento (pedido do dono, 12/11/2026).
describe('idadeDoTurno', () => {
  const agora = Date.parse('2026-11-12T12:00:00.000Z');
  const h = (n: number) => new Date(agora - n * 3_600_000);

  it('o limite é 24 horas', () => expect(TURNO_LIMITE_HORAS).toBe(24));

  it('até 23h59 não passou; com 24 h, passou', () => {
    expect(idadeDoTurno(h(3), agora)).toEqual({ horasAberto: 3, passouDoLimite: false });
    expect(idadeDoTurno(new Date(agora - (24 * 3_600_000 - 60_000)), agora)).toEqual({ horasAberto: 23, passouDoLimite: false });
    expect(idadeDoTurno(h(24), agora)).toEqual({ horasAberto: 24, passouDoLimite: true });
    expect(idadeDoTurno(h(24 * 70), agora)).toEqual({ horasAberto: 1680, passouDoLimite: true });
  });

  it('aceita o texto ISO; sem a hora de abertura (ou hora no futuro): não passou', () => {
    expect(idadeDoTurno(h(30).toISOString(), agora)).toEqual({ horasAberto: 30, passouDoLimite: true });
    expect(idadeDoTurno(null, agora)).toEqual({ horasAberto: 0, passouDoLimite: false });
    expect(idadeDoTurno('torto', agora)).toEqual({ horasAberto: 0, passouDoLimite: false });
    expect(idadeDoTurno(new Date(agora + 3_600_000), agora)).toEqual({ horasAberto: 0, passouDoLimite: false });
  });
});
