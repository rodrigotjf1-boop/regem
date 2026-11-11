import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { KdsAlertaService, passaDoLimite } from './kds-alerta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUDITORIA DO KDS (11/11/2026) — o motor dos alertas cadastrados:
//  • o CONDICIONAL olha cada loja, só os pedidos em andamento das últimas 12 h (sem a encomenda de outro dia) — antes
//    somava a empresa inteira sem janela, e as retiradas paradas para sempre (ERR-438) faziam o alerta disparar sempre;
//  • o disparo vai para a sala da LOJA (o agendado de uma loja também);
//  • a loja do alerta é conferida na empresa; editar valida como criar; liga/desliga explícito (V15).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-alerta.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

describe('passaDoLimite (regra pura)', () => {
  it('cada operador; sem operador = ">="; limite vazio = 0', () => {
    expect(passaDoLimite(3, { operador: '>=', limiar: 3 })).toBe(true);
    expect(passaDoLimite(3, { operador: '>', limiar: 3 })).toBe(false);
    expect(passaDoLimite(0, { operador: '<', limiar: 1 })).toBe(true);
    expect(passaDoLimite(1, { operador: '<=', limiar: 1 })).toBe(true);
    expect(passaDoLimite(2, { operador: '==', limiar: 2 })).toBe(true);
    expect(passaDoLimite(5, { limiar: 5 })).toBe(true);
  });
});

descrever('Alertas do KDS — motor por loja (Postgres)', () => {
  let pool: Pool;
  let svc: KdsAlertaService;
  const emitidos: any[] = [];
  const T = randomUUID();
  const OUTRA = randomUUID();
  const [A, B, C, LOJA_OUTRA] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const doTeste = () => emitidos.filter((e) => e.tenantId === T);
  let ext = 0;
  const pedido = (loja: string, o: { tipo?: string; status?: string; criado?: string; agendamento?: string | null } = {}) =>
    q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, tipo, status, itens, total, criado_em, agendamento)
       values ($1,$2,'ifood',$3,$4,$5,'[]'::jsonb,10, now() - ($6)::interval, $7::timestamptz)`,
      [T, loja, `alerta-${++ext}-${randomUUID()}`, o.tipo ?? 'entrega', o.status ?? 'confirmado', o.criado ?? '10 minutes', o.agendamento ?? null],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const db = drizzle(pool, { schema });
    svc = new KdsAlertaService(db as any, { emit: (_n: string, d: any) => (emitidos.push(d), true) } as any, { registrar: async () => undefined } as any);
    await q(`insert into empresa (id, nome) values ($1,'alertas kds'), ($2,'outra empresa')`, [T, OUTRA]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$5,'Loja A'), ($2,$5,'Loja B'), ($3,$5,'Loja C'), ($4,$6,'Loja de outra empresa')`, [A, B, C, LOJA_OUTRA, T, OUTRA]);
    // Loja A: 3 em andamento agora. Loja B: 1 agora + 5 parados há 2 dias + 1 encomenda de amanhã. Loja C: nenhum.
    for (let i = 0; i < 3; i++) await pedido(A);
    await pedido(B, { tipo: 'retirada', status: 'pronto' });
    for (let i = 0; i < 5; i++) await pedido(B, { tipo: 'retirada', status: 'pronto', criado: '2 days' });
    await pedido(B, { agendamento: new Date(Date.now() + 24 * 3600_000).toISOString() });
    await pedido(A, { status: 'concluido' }); // concluído não conta
  });

  afterAll(async () => {
    if (!pool) return;
    for (const t of ['kds_alerta_config', 'pedido_externo', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await pool.end();
  });

  beforeEach(() => {
    emitidos.length = 0;
  });

  it('a contagem é por loja, só das últimas 12 h e sem a encomenda de outro dia (a loja vazia vem com zero)', async () => {
    const m = (await svc.contarPedidos([T])).get(T)!;
    expect(m.get(A)).toEqual({ balcao: 0, delivery: 3, total: 3 });
    expect(m.get(B)).toEqual({ balcao: 1, delivery: 0, total: 1 });
    expect(m.get(C)).toEqual({ balcao: 0, delivery: 0, total: 0 });
  });

  it('o condicional da EMPRESA avisa só a loja que passou do limite, na sala dela, com o número dela', async () => {
    await svc.criar(T, null, { titulo: 'Muitos pedidos', tipo: 'condicional', condicao: { fonte: 'pedidos_total', operador: '>=', limiar: 3 }, duracaoSeg: 30 });
    await (svc as any).umaVolta();
    expect(doTeste().map((e) => [e.unidadeId, e.titulo])).toEqual([[A, 'Muitos pedidos (3)']]);
    // Repetido logo depois: o cooldown segura (não empilha cópias).
    emitidos.length = 0;
    await (svc as any).umaVolta();
    expect(doTeste()).toEqual([]);
    await q(`update kds_alerta_config set ativo = false where tenant_id = $1`, [T]);
  });

  it('o condicional de UMA loja olha só ela; "menos de N" vale na loja vazia', async () => {
    await svc.criar(T, null, { titulo: 'Balcão cheio em B', unidadeId: B, tipo: 'condicional', condicao: { fonte: 'pedidos_balcao', operador: '>=', limiar: 2 } });
    await svc.criar(T, null, { titulo: 'Loja parada', tipo: 'condicional', condicao: { fonte: 'pedidos_total', operador: '<', limiar: 1 } });
    await (svc as any).umaVolta();
    // B tem 1 de balcão nas últimas 12 h (os 5 parados há 2 dias não contam): não dispara. C está vazia: "parada".
    expect(doTeste().map((e) => [e.unidadeId, e.titulo])).toEqual([[C, 'Loja parada (0)']]);
    await q(`update kds_alerta_config set ativo = false where tenant_id = $1`, [T]);
  });

  it('o agendado de uma loja vai para a sala dela; o da empresa, para a empresa', async () => {
    const daLoja = await svc.criar(T, null, { titulo: 'Fechar caixa', unidadeId: A, tipo: 'agendado', horarios: ['10:00'], diasSemana: [1] });
    const daEmpresa = await svc.criar(T, null, { titulo: 'Lavar as mãos', tipo: 'agendado', horarios: ['10:00'], diasSemana: [1] });
    (svc as any).tickAgendado(daLoja, '10:00', 1, '2026-11-09');
    (svc as any).tickAgendado(daEmpresa, '10:00', 1, '2026-11-09');
    expect(doTeste().map((e) => [e.unidadeId ?? null, e.titulo])).toEqual([[A, 'Fechar caixa'], [null, 'Lavar as mãos']]);
    await q(`update kds_alerta_config set ativo = false where tenant_id = $1`, [T]);
  });

  it('a loja do alerta é conferida na empresa; editar valida como criar; liga/desliga explícito', async () => {
    await expect(svc.criar(T, null, { titulo: 'x', unidadeId: LOJA_OUTRA, tipo: 'agendado', horarios: ['10:00'] })).rejects.toThrow(/não encontrada/);
    await expect(svc.criar(T, null, { titulo: 'x', unidadeId: 'nao-e-uuid', tipo: 'agendado', horarios: ['10:00'] })).rejects.toThrow(/da lista/);
    await expect(svc.criar(T, null, { titulo: 'x', tipo: 'condicional', condicao: { fonte: 'pedidos_total', limiar: '' } })).rejects.toThrow(/limite/);
    await expect(svc.criar(T, null, { titulo: 'x', tipo: 'agendado', horarios: ['10:00'], ativo: 'talvez' })).rejects.toThrow(/true ou false/);
    const a = await svc.criar(T, null, { titulo: 'Agendado', tipo: 'agendado', horarios: ['10:00'] });
    // Virar condicional sem condição era aceito e disparava sempre ("≥ 0").
    await expect(svc.atualizar(T, a.id, { tipo: 'condicional' })).rejects.toThrow(/condição/);
    await expect(svc.atualizar(T, a.id, { unidadeId: LOJA_OUTRA })).rejects.toThrow(/não encontrada/);
    expect((await svc.atualizar(T, a.id, { ativo: 'false' })).ativo).toBe(false); // texto "false" desliga (não liga)
    expect((await svc.atualizar(T, a.id, { ativo: true })).ativo).toBe(true);
  });
});
