import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AtendimentoService, juntarMensagem, prioridadeDe } from './atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CHAMADO DO ROBÔ COM PRIORIDADE (mig 343, pedido do dono de 30/10/2026): cliente irritado → urgente, na frente da
// lista; o mesmo cliente com um chamado aberto não ganha outro (soma ao aberto e só sobe a prioridade). Contra o
// Postgres real: a chave do telefone (com/sem 55 e nono dígito) é SQL, e a regra da coluna é do banco.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('atendimento-robo-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

describe('prioridade pedida e mensagem somada (sem banco)', () => {
  it('só "urgente" (ou urgente: true) muda o padrão', () => {
    expect(prioridadeDe({ urgente: true })).toBe('urgente');
    expect(prioridadeDe({ urgente: 'true' })).toBe('urgente');
    expect(prioridadeDe({ prioridade: 'urgente' })).toBe('urgente');
    expect(prioridadeDe({ urgente: false })).toBe('normal');
    expect(prioridadeDe({ prioridade: 'altissima' })).toBe('normal');
    expect(prioridadeDe(undefined)).toBe('normal');
  });

  it('a mensagem nova vai junto, sem repetir e sem crescer sem fim', () => {
    expect(juntarMensagem('quer falar com alguém', 'pedido atrasado 1h')).toBe('quer falar com alguém\npedido atrasado 1h');
    expect(juntarMensagem('pedido atrasado 1h', 'pedido atrasado 1h')).toBe('pedido atrasado 1h');
    expect(juntarMensagem(null, 'oi')).toBe('oi');
    expect(juntarMensagem('oi', '')).toBe('oi');
    expect(juntarMensagem('a'.repeat(990), 'b'.repeat(50))!.length).toBe(1000);
  });
});

descrever('chamado do robô com prioridade (Postgres)', () => {
  let pool: Pool;
  let svc: AtendimentoService;
  const avisos: any[] = [];
  const T = randomUUID();
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const doTenant = () => q(`select * from atendimento_chamado where tenant_id = $1 order by criado_em`, [T]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const eventos: any = { emit: (nome: string, dados: any) => avisos.push({ nome, dados }) };
    svc = new AtendimentoService(drizzle(pool, { schema }) as any, eventos, {} as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste chamado urgente')`, [T]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
  });

  it('chamado comum nasce "normal"; o do cliente irritado, "urgente"', async () => {
    await svc.abrir(T, null, { tipo: 'humano', telefone: '21987654321' });
    await svc.abrir(T, null, { tipo: 'erro', telefone: '21911112222', prioridade: 'urgente' });
    expect((await doTenant()).map((c) => c.prioridade)).toEqual(['normal', 'urgente']);
  });

  it('o mesmo cliente (com 55, sem o nono dígito) não ganha um segundo chamado: soma ao aberto', async () => {
    const a = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '5521987654321', mensagem: 'quer ajuda para pedir' });
    const b = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '552187654321', mensagem: 'não acha o x-bacon' });
    expect(b).toMatchObject({ id: a.id, jaAberto: true });
    const linhas = await doTenant();
    expect(linhas).toHaveLength(1);
    expect(linhas[0].mensagem).toBe('quer ajuda para pedir\nnão acha o x-bacon');
    expect(avisos).toHaveLength(1); // nada mudou para a equipe ver de novo
  });

  it('urgente SOBE a prioridade do aberto e avisa a tela de novo; normal depois não desce', async () => {
    const a = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
    const b = await svc.abrirPeloRobo(T, null, { tipo: 'erro', telefone: '21987654321', mensagem: 'ABSURDO, 1 hora!', prioridade: 'urgente' });
    expect(b).toMatchObject({ id: a.id, prioridade: 'urgente', jaAberto: true });
    expect(avisos).toHaveLength(2);
    expect(avisos[1].dados.chamado.prioridade).toBe('urgente');
    const c = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
    expect(c.prioridade).toBe('urgente');
    expect(avisos).toHaveLength(2);
    expect((await doTenant())[0].prioridade).toBe('urgente');
  });

  it('pedido de CANCELAMENTO ligado a um pedido abre o seu próprio chamado (o botão "Aceitar cancelamento" depende dele)', async () => {
    const pedidoId = randomUUID();
    await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
    const cancel = await svc.abrirPeloRobo(T, null, { tipo: 'cancelamento', telefone: '21987654321', pedidoId, pedidoNumero: '4471' });
    expect((cancel as any).jaAberto).toBeUndefined();
    const linhas = await doTenant();
    expect(linhas.map((c) => c.tipo)).toEqual(['humano', 'cancelamento']);
    expect(linhas[1].pedido_id).toBe(pedidoId);
  });

  it('chamado já resolvido não conta: o cliente que volta abre um novo', async () => {
    const a = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
    await svc.resolver(T, a.id, randomUUID());
    const b = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
    expect(b.id).not.toBe(a.id);
  });

  it('chamado de OUTRA empresa com o mesmo telefone não é somado', async () => {
    const outra = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'outra')`, [outra]);
    try {
      await q(`insert into atendimento_chamado (tenant_id, tipo, telefone) values ($1, 'humano', '21987654321')`, [outra]);
      const meu = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21987654321' });
      expect((meu as any).jaAberto).toBeUndefined();
    } finally {
      await q(`delete from atendimento_chamado where tenant_id = $1`, [outra]);
      await q(`delete from empresa where id = $1`, [outra]);
    }
  });

  it('a lista põe o urgente na frente; dentro de cada grupo, o mais novo em cima', async () => {
    await q(
      `insert into atendimento_chamado (tenant_id, tipo, telefone, prioridade, criado_em) values
         ($1, 'humano', '21900000001', 'normal',  now() - interval '30 minutes'),
         ($1, 'erro',   '21900000002', 'urgente', now() - interval '20 minutes'),
         ($1, 'humano', '21900000003', 'normal',  now() - interval '10 minutes'),
         ($1, 'erro',   '21900000004', 'urgente', now() - interval '5 minutes')`,
      [T],
    );
    const lista = await svc.listar(T);
    expect(lista.map((c: any) => c.telefone)).toEqual(['21900000004', '21900000002', '21900000003', '21900000001']);
  });

  it('o banco recusa prioridade fora da lista', async () => {
    await expect(
      q(`insert into atendimento_chamado (tenant_id, tipo, prioridade) values ($1, 'humano', 'altissima')`, [T]),
    ).rejects.toThrow();
  });
});
