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
    const sock: any = { data: { ctx: { tenantId: 't1', role: 'gestor', categoria: 'gerente' } } };
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
    const sock: any = { data: { ctx: { tenantId: 't1', role: 'gestor', categoria: 'gerente' } } };
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

// AUDITORIA DO KDS (11/11/2026): o KDS entra com login e nunca recebia o alerta da LOJA; prioridades fora do padrão
// ('media'/'baixa') passavam na frente do cancelado; qualquer login mandava alerta a todas as telas.
describe('RealtimeGateway — salas da loja, prioridade e quem manda alerta', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const U2 = '22222222-2222-4222-8222-222222222222';
  const OUTRA = '33333333-3333-4333-8333-333333333333';
  const comBanco = () => {
    const g = new RealtimeGateway({} as any, {} as any, undefined, { execute: async () => ({ rows: [{ id: U1 }, { id: U2 }] }) } as any);
    (g as any).server = fakeServer();
    return g;
  };

  it('a loja do socket: a fixa do login vence; o presidente fica na escolhida (da empresa) ou em todas; outro nível sem loja, em nenhuma', async () => {
    const g = comBanco();
    expect(await g.lojasDoLogin('t1', { uni: U2, cat: 'gerente' }, U1)).toEqual([U2]); // a fixa vence o pedido
    expect(await g.lojasDoLogin('t1', { cat: 'presidente' }, U1)).toEqual([U1]);
    expect(await g.lojasDoLogin('t1', { cat: 'presidente' }, OUTRA)).toEqual([U1, U2]); // de outra empresa: ignorada
    expect(await g.lojasDoLogin('t1', { cat: 'presidente' }, 'todas')).toEqual([U1, U2]);
    expect(await g.lojasDoLogin('t1', { cat: 'presidente' }, undefined)).toEqual([U1, U2]);
    expect(await g.lojasDoLogin('t1', { cat: 'execucao' }, U1)).toEqual([]);
    const semBanco = new RealtimeGateway({} as any, {} as any);
    expect(await semBanco.lojasDoLogin('t1', { cat: 'presidente' }, U1)).toEqual([]);
  });

  it('o login entra na sala da empresa E na da loja (o alerta da loja chega)', async () => {
    const salas: string[] = [];
    const g = new RealtimeGateway({ verify: () => ({ tenant: 't1', sub: 'c1', cat: 'gerente', uni: U1 }) } as any, {} as any);
    (g as any).server = fakeServer();
    const sock: any = { handshake: { auth: { jwt: 'x' }, headers: {} }, data: {}, join: (s: string) => salas.push(s), emit: () => {}, disconnect: () => {} };
    await g.handleConnection(sock);
    expect(salas).toEqual(expect.arrayContaining(['tenant:t1', `unidade:${U1}`]));
    expect(sock.data.ctx).toMatchObject({ unidadeId: U1, categoria: 'gerente' });
  });

  it('o presidente em "todas as lojas" entra na sala de cada loja da empresa', async () => {
    const salas: string[] = [];
    const g = new RealtimeGateway(
      { verify: () => ({ tenant: 't1', sub: 'c1', cat: 'presidente', uni: null }) } as any,
      {} as any,
      undefined,
      { execute: async () => ({ rows: [{ id: U1 }, { id: U2 }] }) } as any,
    );
    (g as any).server = fakeServer();
    const sock: any = { handshake: { auth: { jwt: 'x', unidade: 'todas' }, headers: {} }, data: {}, join: (s: string) => salas.push(s), emit: () => {}, disconnect: () => {} };
    await g.handleConnection(sock);
    expect(salas).toEqual(expect.arrayContaining(['tenant:t1', `unidade:${U1}`, `unidade:${U2}`]));
    expect(sock.data.ctx.unidadeId).toBeNull();
  });

  it('alerta do sistema: "baixa" vira info, "media" vira alta, o resto como veio; sai na sala da loja', () => {
    const g = comBanco();
    const server = (g as any).server;
    g.onAlertaSistema({ tenantId: 't1', unidadeId: U1, titulo: 'Compra recebida', prioridade: 'baixa' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Contagem', prioridade: 'media' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Cancelado', prioridade: 'danger' });
    expect(server.emits.map((e: any) => [e.room, e.payload.prioridade])).toEqual([
      [`unidade:${U1}`, 'info'],
      ['tenant:t1', 'alta'],
      ['tenant:t1', 'danger'],
    ]);
  });

  it('pelo socket só presidente e gerente mandam alerta; vai para a loja de quem mandou', () => {
    const g = comBanco();
    const server = (g as any).server;
    const execucao: any = { data: { ctx: { tenantId: 't1', role: 'gestor', categoria: 'execucao', unidadeId: U1 } } };
    expect((g.onAlerta(execucao, { titulo: 'x' }) as any).ok).toBe(false);
    const gerente: any = { data: { ctx: { tenantId: 't1', role: 'gestor', categoria: 'gerente', unidadeId: U1 } } };
    expect((g.onAlerta(gerente, { titulo: 'Mesa 7', prioridade: 'baixa' }) as any).alerta.prioridade).toBe('info');
    expect(server.emits.map((e: any) => e.room)).toEqual([`unidade:${U1}`]);
  });
});
