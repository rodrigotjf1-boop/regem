import { randomUUID } from 'node:crypto';
import { anotarEncerrada } from '../../auth/sessao-encerrada';
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

// ERR-495: a sala da empresa tem os aparelhos (KDS, terminal de ponto) e todo perfil, de todas as lojas. O aviso de caso
// novo do Atendimento levava a linha inteira do caso — nome e telefone do cliente, o resumo da conversa — a todos eles.
describe('RealtimeGateway — caso novo do Atendimento: só o aviso', () => {
  const ID = '99999999-9999-4999-8999-999999999999';
  const caso = {
    id: ID,
    tenantId: 't1',
    clienteNome: 'Maria de Teste',
    clienteTelefone: '5521999990000',
    resumo: 'Pedido veio sem a batata',
    detalhe: { pedido: { numero: 4821 }, conversa: ['oi', 'cadê meu pedido?'] },
  };

  it('vai o id e a hora — nada do cliente nem da conversa', () => {
    const { g, server } = make();
    g.onAtendimentoNovo({ tenantId: 't1', chamado: caso });
    expect(server.emits).toHaveLength(1);
    const { room, ev, payload } = server.emits[0];
    expect([room, ev]).toEqual(['tenant:t1', 'atendimento:novo']);
    expect(Object.keys(payload).sort()).toEqual(['em', 'id']);
    expect(payload.id).toBe(ID);
    const tudo = JSON.stringify(payload);
    for (const segredo of ['Maria', '5521999990000', 'batata', '4821', 'cadê']) expect(tudo).not.toContain(segredo);
  });

  it('caso sem id (ou id estranho): o aviso sai do mesmo jeito, com id nulo — a tela relê a fila', () => {
    const { g, server } = make();
    g.onAtendimentoNovo({ tenantId: 't1', chamado: { clienteNome: 'Sem id' } });
    g.onAtendimentoNovo({ tenantId: 't1', chamado: { id: '<script>', clienteNome: 'Id estranho' } });
    g.onAtendimentoNovo({ tenantId: 't1', chamado: null });
    expect(server.emits.map((e: any) => [e.ev, e.payload.id, Object.keys(e.payload).sort().join(',')])).toEqual([
      ['atendimento:novo', null, 'em,id'],
      ['atendimento:novo', null, 'em,id'],
      ['atendimento:novo', null, 'em,id'],
    ]);
  });
});

// ERR-495, o mesmo no ponto: a cada batida ia o comprovante inteiro (nome do colaborador, hora, NSR, hash) à sala da empresa.
describe('RealtimeGateway — ponto marcado: só o aviso', () => {
  const LOJA = '11111111-1111-4111-8111-111111111111';

  it('vai a loja e a hora do aviso — nada de quem bateu, nem o NSR, nem o hash', () => {
    const { g, server } = make();
    g.onPontoMarcado({
      tenantId: 't1',
      unidadeId: LOJA,
      origem: 'terminal',
      comprovante: { nsr: 918273, tipo: 'entrada', colaboradorId: 'c1', colaboradorNome: 'João de Teste', marcadoEm: '2026-11-16T11:02:00Z', hash: 'abc123def456' },
    });
    expect(server.emits).toHaveLength(1);
    const { room, ev, payload } = server.emits[0];
    expect([room, ev]).toEqual(['tenant:t1', 'ponto:marcado']);
    expect(Object.keys(payload).sort()).toEqual(['em', 'unidadeId']);
    expect(payload.unidadeId).toBe(LOJA);
    const tudo = JSON.stringify(payload);
    for (const dado of ['João', '918273', 'abc123def456', 'c1', 'entrada', '11:02']) expect(tudo).not.toContain(dado);
  });

  it('sem loja (ou loja estranha): o aviso sai com a loja nula', () => {
    const { g, server } = make();
    g.onPontoMarcado({ tenantId: 't1', origem: 'web', comprovante: { colaboradorNome: 'Sem loja' } });
    g.onPontoMarcado({ tenantId: 't1', unidadeId: 'nao-e-uuid', origem: 'web', comprovante: {} });
    expect(server.emits.map((e: any) => [e.payload.unidadeId, Object.keys(e.payload).sort().join(',')])).toEqual([
      [null, 'em,unidadeId'],
      [null, 'em,unidadeId'],
    ]);
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

  // Onda 2 da auditoria do KDS (mig 408): cada tela escolhe os tipos de aviso que recebe — o tipo vai junto.
  it('alerta do sistema leva o tipo (estoque, gestão…); sem tipo ou desconhecido = alerta da loja', () => {
    const g = comBanco();
    const server = (g as any).server;
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Compra recebida', prioridade: 'baixa', tipo: 'gestao' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Produto esgotado', prioridade: 'alta', tipo: 'estoque' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Lavar as mãos', prioridade: 'info' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Inventado', prioridade: 'info', tipo: 'cancelado' });
    expect(server.emits.map((e: any) => e.payload.tipo)).toEqual(['gestao', 'estoque', 'loja', 'loja']);
    const gerente: any = { data: { ctx: { tenantId: 't1', role: 'gestor', categoria: 'gerente', unidadeId: U1 } } };
    expect((g.onAlerta(gerente, { titulo: 'Mesa 7', tipo: 'gestao' }) as any).alerta.tipo).toBe('loja');
  });

  // Onda 2 (mig 409): o alerta cadastrado vai para os KDS escolhidos e pode ficar até o "Ciente".
  it('alerta do sistema leva os KDS (só ids válidos; vazio = todos) e o "fica até o Ciente" (só verdadeiro de verdade)', () => {
    const g = comBanco();
    const server = (g as any).server;
    const K = '11111111-2222-4333-8444-555555555555';
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Óleo', kds: [K, 'lixo'], fica: true });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Mãos', kds: [], fica: 'true' });
    g.onAlertaSistema({ tenantId: 't1', titulo: 'Sem nada' });
    expect(server.emits.map((e: any) => [e.payload.kds, e.payload.fica])).toEqual([
      [[K], true],
      [null, false],
      [null, false],
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

// SEGUNDA RODADA DA AVALIAÇÃO DE SEGURANÇA (16/11/2026, B-01): o guarda das rotas recusava a sessão do terminal de ponto
// fora das duas rotas dela, e o tempo real aceitava o mesmo token — entrava nas salas da empresa e recebia o ponto dos
// colegas, os pedidos e os alertas (com nível de gerente, ainda mandava alerta ao KDS).
describe('RealtimeGateway — só a sessão geral abre o tempo real (B-01)', () => {
  const U1 = '11111111-1111-4111-8111-111111111111';
  const PESSOA = '44444444-4444-4444-8444-444444444444';
  function conectar(payload: any, banco?: any) {
    const salas: string[] = [];
    const erros: any[] = [];
    let derrubado = false;
    const g = new RealtimeGateway({ verify: () => payload } as any, {} as any, undefined, banco);
    (g as any).server = fakeServer();
    const sock: any = {
      handshake: { auth: { jwt: 'x' }, headers: {} },
      data: {},
      join: (s: string) => salas.push(s),
      emit: (ev: string, p: any) => erros.push([ev, p]),
      disconnect: () => { derrubado = true; },
    };
    return g.handleConnection(sock).then(() => ({ salas, erros, derrubado: () => derrubado, sock }));
  }
  const base = { tenant: 't1', sub: PESSOA, cat: 'gerente', uni: U1 };

  it('a sessão do terminal de ponto é recusada: nenhuma sala, sem contexto, desconectada', async () => {
    const r = await conectar({ ...base, so: 'ponto' });
    expect(r.salas).toEqual([]);
    expect(r.sock.data.ctx).toBeUndefined();
    expect(r.derrubado()).toBe(true);
    expect(r.erros).toEqual([['erro', { motivo: 'esta sessão não abre o tempo real' }]]);
  });

  it('qualquer marca de sessão restrita é recusada, não só a do ponto; a do app de atendimento (presa ao aparelho) também', async () => {
    for (const marca of [{ so: 'outra-coisa' }, { so: true }, { ap: '55555555-5555-4555-8555-555555555555' }]) {
      const r = await conectar({ ...base, ...marca });
      expect([marca, r.salas, r.derrubado()]).toEqual([marca, [], true]);
    }
  });

  it('a sessão geral segue entrando (o controle do teste acima)', async () => {
    const r = await conectar(base);
    expect(r.derrubado()).toBe(false);
    expect(r.salas).toEqual(expect.arrayContaining(['tenant:t1', `unidade:${U1}`, `pdv:${PESSOA}`]));
  });

  it('o excluído e o bloqueado não entram (a regra do guarda das rotas); quem segue ativo, entra', async () => {
    const banco = (linha: any) => ({ execute: async () => ({ rows: linha ? [linha] : [] }) });
    const excluido = await conectar(base, banco({ status: 'ativo', deleted_at: new Date() }));
    expect([excluido.salas, excluido.derrubado()]).toEqual([[], true]);
    expect(excluido.erros).toEqual([['erro', { motivo: 'acesso encerrado ou bloqueado' }]]);
    const bloqueado = await conectar(base, banco({ status: 'bloqueado', deleted_at: null }));
    expect([bloqueado.salas, bloqueado.derrubado()]).toEqual([[], true]);
    const ativo = await conectar(base, banco({ status: 'ativo', deleted_at: null }));
    expect(ativo.derrubado()).toBe(false);
    expect(ativo.salas).toContain('tenant:t1');
    // sem linha de colaborador (a sessão de suporte), segue pelo token, como no guarda
    const semLinha = await conectar({ ...base, sub: 'sup:tecnico', cat: 'suporte', uni: null }, banco(null));
    expect(semLinha.derrubado()).toBe(false);
  });

  it('o banco fora do ar na conferência: a conexão é recusada (fecha, não abre)', async () => {
    const r = await conectar(base, { execute: async () => { throw new Error('banco fora'); } });
    expect([r.salas, r.derrubado()]).toEqual([[], true]);
  });

  // R3-01 (mig 457, V97): a sessão que "Sair" encerrou não abre o tempo real, e as abertas com ela caem na hora.
  it('a sessão encerrada por "Sair" é recusada na entrada; outra sessão entra e fica na sala dela', async () => {
    const encerrada = randomUUID();
    anotarEncerrada(encerrada, Date.now() + 60_000);
    const r = await conectar({ ...base, jti: encerrada });
    expect([r.salas, r.derrubado()]).toEqual([[], true]);
    expect(r.erros).toEqual([['erro', { motivo: 'sessão encerrada' }]]);
    const outra = randomUUID();
    const ok = await conectar({ ...base, jti: outra });
    expect(ok.derrubado()).toBe(false);
    expect(ok.salas).toEqual(expect.arrayContaining(['tenant:t1', `sessao:${outra}`]));
  });

  it('o aviso "sessao.encerrada" derruba os sockets da sala daquela sessão (e só ela)', () => {
    const g = new RealtimeGateway({} as any, {} as any);
    const emits: any[] = [];
    const derrubadas: string[] = [];
    (g as any).server = {
      to: (room: string) => ({ emit: (ev: string, p: any) => emits.push({ room, ev, p }) }),
      in: (room: string) => ({ disconnectSockets: () => derrubadas.push(room) }),
    };
    const jti = randomUUID();
    g.onSessaoEncerrada({ jti });
    expect(derrubadas).toEqual([`sessao:${jti}`]);
    expect(emits).toEqual([{ room: `sessao:${jti}`, ev: 'erro', p: { motivo: 'sessão encerrada' } }]);
    g.onSessaoEncerrada({ jti: 'nao-e-uuid' }); // lixo: não derruba nada
    expect(derrubadas).toHaveLength(1);
  });
});
