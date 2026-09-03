import { RealtimeGateway } from './realtime.gateway';

// W1 (Bloco 7) — o kds:alerta broadcasta para TODO o tenant: precisa de RBAC (só gestor),
// sanitização (sem injeção de conteúdo nas telas) e rate-limit; o device:ping grava no banco →
// rate-limit. Testa o contrato observável com socket/server falsos (sem socket.io real).
const CTRL = String.fromCharCode(1); // caractere de controle p/ o teste de sanitização

function fakeServer() {
  const emits: any[] = [];
  return {
    emits,
    to: (room: string) => ({ emit: (ev: string, payload: any) => emits.push({ room, ev, payload }) }),
  };
}
function make(equip: any = { registrarPing: async () => {} }) {
  const g = new RealtimeGateway({} as any, equip as any);
  const server = fakeServer();
  (g as any).server = server;
  return { g, server };
}

describe('RealtimeGateway — kds:alerta (W1)', () => {
  it('device NAO dispara alerta (RBAC) — nada e emitido', () => {
    const { g, server } = make();
    const sock: any = { data: { ctx: { tenantId: 't1', role: 'device' } } };
    const r: any = g.onAlerta(sock, { titulo: 'x' });
    expect(r.ok).toBe(false);
    expect(server.emits.length).toBe(0);
  });

  it('gestor dispara: sanitiza (tira controle), corta o detalhe e broadcasta ao tenant', () => {
    const { g, server } = make();
    const sock: any = { data: { ctx: { tenantId: 't1', role: 'gestor' } } };
    const r: any = g.onAlerta(sock, { titulo: 'Mesa' + CTRL + '7', detalhe: 'a'.repeat(500), prioridade: 'hackerman' });
    expect(r.ok).toBe(true);
    expect(server.emits.length).toBe(1);
    expect(server.emits[0].room).toBe('tenant:t1');
    expect(r.alerta.titulo).toBe('Mesa 7'); // controle virou espaco
    expect(r.alerta.detalhe.length).toBeLessThanOrEqual(300);
    expect(r.alerta.prioridade).toBe('alta'); // valor invalido cai no default
  });

  it('rate-limit: 2o alerta imediato e barrado (so o 1o sai)', () => {
    const { g, server } = make();
    const sock: any = { data: { ctx: { tenantId: 't1', role: 'gestor' } } };
    g.onAlerta(sock, { titulo: 'a' });
    const r2: any = g.onAlerta(sock, { titulo: 'b' });
    expect(r2.ok).toBe(false);
    expect(server.emits.length).toBe(1);
  });
});

describe('RealtimeGateway — device:ping (W1)', () => {
  it('rate-limit: dois pings seguidos gravam so 1x', async () => {
    let pings = 0;
    const { g } = make({ registrarPing: async () => { pings++; } });
    const sock: any = { data: { ctx: { equipamentoId: 'e1', role: 'device' } } };
    await g.onPing(sock);
    await g.onPing(sock);
    expect(pings).toBe(1);
  });
});
