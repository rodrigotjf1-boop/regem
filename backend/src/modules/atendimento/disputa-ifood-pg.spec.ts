import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import * as bcrypt from 'bcryptjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarDisputa, registrarEncerramento } from '../integracoes/ifood/ifood-disputa';
import { DisputaIfoodService } from './disputa-ifood.service';
import { AtendimentoService } from './atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DISPUTAS DO iFOOD NA CENTRAL (Onda 1, PR 2, mig 351), contra o Postgres real: o caso nasce da disputa uma vez só (o
// iFood reenvia o evento), liga ao pedido, termina com o resultado do iFood, e a resposta da loja passa pela senha de
// gerente/presidente (supervisão não), pela regra da documentação e por UMA resposta só. O iFood aqui é de mentira.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('disputa-ifood-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const evento = (disputa: string, pedido: string, extra: Record<string, unknown> = {}) => ({
  id: `evt-${disputa}`,
  code: 'HSD',
  fullCode: 'HANDSHAKE_DISPUTE',
  orderId: pedido,
  metadata: {
    id: disputa,
    action: 'PARTIAL_CANCELLATION',
    handshakeType: 'AFTER_DELIVERY_PARTIALLY',
    message: 'Faltou a batata.',
    expiresAt: new Date(Date.now() + 6 * 60_000).toISOString(),
    timeoutAction: 'ACCEPT_CANCELLATION',
    alternatives: [{ id: 'alt', type: 'REFUND', metadata: { maxAmount: { currency: 'BRL', value: '1290' } } }],
    acceptCancellationReasons: ['WRONG_ORDER', 'CUSTOMER_SATISFACTION'],
    evidences: [{ url: 'https://merchant-api.ifood.com.br/orders/x/evidences/1', contentType: 'image/jpeg' }],
    ...extra,
  },
});

descrever('disputas do iFood na central (Postgres)', () => {
  let pool: Pool;
  let db: any;
  const avisos: any[] = [];
  const auditoria: any[] = [];
  const chamadasIfood: any[] = [];
  let respostaIfood: any = { ok: true, status: 200, codigo: null, mensagem: null };
  const T = randomUUID();
  let gerente: string;
  const ig = { id: 'ig', tenantId: T, unidadeId: null, merchantId: 'm' } as any;
  const ifood: any = {
    integracaoDoTenant: async () => ig,
    responderDisputa: async (...a: any[]) => {
      chamadasIfood.push(a);
      return respostaIfood;
    },
  };
  const emitir = (ev: string, p: any) => avisos.push({ ev, p });
  let svc: DisputaIfoodService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const usuario = () => ({ tenantId: T, colaboradorId: gerente, categoria: 'execucao' }) as any; // o PC é da equipe

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    svc = new DisputaIfoodService(db, ifood, { emit: emitir } as any, { registrar: async (e: any) => void auditoria.push(e) } as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste disputa ifood')`, [T]);
    const funcao = async (cat: string) => (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,$2,$3) returning id`, [T, `F ${cat}`, cat]))[0].id;
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Ana gerente',$2,$3) returning id`, [
      T,
      await funcao('gerente'),
      await bcrypt.hash('senha-gerente', 4),
    ]);
    await q(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Sara supervisora',$2,$3)`, [
      T,
      await funcao('supervisao'),
      await bcrypt.hash('senha-supervisao', 4),
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from colaborador where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from funcao where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    chamadasIfood.length = 0;
    respostaIfood = { ok: true, status: 200, codigo: null, mensagem: null };
    delete process.env.EDGE_MODE;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
  });

  it('o evento vira UM caso (o iFood reenvia): canal ifood, prazo do iFood, ligado ao pedido, com o detalhe', async () => {
    const [{ id: ped }] = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, external_id, display_id, numero, cliente_nome)
       values ($1,'ifood','delivery','[]',54.8,'concluido','ord-1','4521',12,'Ana P.') returning id`,
      [T],
    );
    const ev = evento('disp-1', 'ord-1');
    expect(await registrarDisputa(db, emitir, ig, ev)).toMatchObject({ aberto: true });
    expect(await registrarDisputa(db, emitir, ig, ev)).toMatchObject({ aberto: false });
    const casos = await q(`select * from atendimento_chamado where tenant_id = $1`, [T]);
    expect(casos.length).toBe(1);
    expect(casos[0]).toMatchObject({ tipo: 'disputa', canal: 'ifood', externo_id: 'disp-1', pedido_id: ped, cliente: 'Ana P.', pedido_numero: '12', status: 'aberto' });
    expect(new Date(casos[0].prazo_em).getTime()).toBe(new Date(ev.metadata.expiresAt).getTime());
    expect(casos[0].detalhe.disputa).toMatchObject({ id: 'disp-1', acaoAutomatica: 'ACCEPT_CANCELLATION', alternativas: [{ tipo: 'REFUND', maxCentavos: 1290 }] });
    expect(avisos.filter((a) => a.ev === 'atendimento.novo').length).toBe(1);
  });

  it('a FILA devolve o detalhe da disputa (a tela mostra o que o iFood mandou — V6, ERR-216)', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-fila', 'ord-fila'));
    const atendimento = new AtendimentoService(db, { emit: () => true } as any, {} as any);
    const { casos } = await atendimento.fila({ tenantId: T, colaboradorId: gerente, categoria: 'gerente' } as any, null);
    const caso: any = casos.find((x: any) => x.id === id);
    expect(caso).toMatchObject({ tipo: 'disputa', canal: 'ifood', externoId: 'disp-fila', posicao: null });
    expect(caso.detalhe.disputa).toMatchObject({ mensagem: 'Faltou a batata.', alternativas: [{ tipo: 'REFUND', maxCentavos: 1290 }] });
  });

  it('o iFood encerra (prazo vencido): o caso sai da fila com "expirou" e o resultado', async () => {
    await registrarDisputa(db, emitir, ig, evento('disp-2', 'ord-x'));
    expect(await registrarEncerramento(db, emitir, T, { code: 'HSS', metadata: { disputeId: 'disp-2', status: 'EXPIRED' } })).toBe(true);
    const [c] = await q(`select status, decisao, prazo_em, detalhe from atendimento_chamado where tenant_id = $1`, [T]);
    expect(c).toMatchObject({ status: 'resolvido', decisao: 'expirou', prazo_em: null });
    expect(c.detalhe.encerramento.status).toBe('EXPIRED');
    expect(await registrarEncerramento(db, emitir, T, { code: 'HSS', metadata: { disputeId: 'nunca-vista', status: 'ACCEPTED' } })).toBe(false);
  });

  it('responder: com a senha de GERENTE, pelo motivo da disputa — vai ao iFood, resolve o caso e fica na auditoria', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-3', 'ord-3'));
    const r = await svc.responder(usuario(), id!, { acao: 'aceitar', motivo: 'WRONG_ORDER', senha: 'senha-gerente' });
    expect(r.resposta).toMatchObject({ acao: 'aceitar', motivo: 'WRONG_ORDER', por: 'Ana gerente', porId: gerente });
    expect(chamadasIfood).toEqual([[ig, 'disp-3', 'accept', { reason: 'WRONG_ORDER' }]]);
    const [c] = await q(`select status, decisao, resolvido_por_id, prazo_em, detalhe from atendimento_chamado where id = $1`, [id]);
    expect(c).toMatchObject({ status: 'resolvido', decisao: 'aceito', resolvido_por_id: gerente, prazo_em: null });
    expect(c.detalhe.resposta.acao).toBe('aceitar');
    expect(auditoria[0]).toMatchObject({ acao: 'respondeu_disputa_ifood', entidadeId: id, detalhe: { acao: 'aceitar', liberadoPor: gerente } });
    // uma resposta só
    await expect(svc.responder(usuario(), id!, { acao: 'recusar', motivo: 'INVENTORY_CHECK', senha: 'senha-gerente' })).rejects.toThrow('Esta disputa já foi respondida.');
  });

  it('a senha da SUPERVISÃO não responde disputa (só gerente e presidente — decisão do dono)', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-4', 'ord-4'));
    await expect(svc.responder(usuario(), id!, { acao: 'aceitar', motivo: 'WRONG_ORDER', senha: 'senha-supervisao' })).rejects.toThrow('Senha de gestor inválida.');
    expect(chamadasIfood).toEqual([]);
  });

  it('o que o iFood não aceitaria é recusado aqui, sem gastar a resposta; o prazo vencido também', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-5', 'ord-5'));
    await expect(svc.responder(usuario(), id!, { acao: 'propor', tipo: 'REFUND', centavos: 5000, senha: 'senha-gerente' })).rejects.toThrow('O iFood aceita no máximo');
    expect(chamadasIfood).toEqual([]);
    const { id: vencida } = await registrarDisputa(db, emitir, ig, evento('disp-6', 'ord-6', { expiresAt: new Date(Date.now() - 1000).toISOString() }));
    await expect(svc.responder(usuario(), vencida!, { acao: 'aceitar', motivo: 'WRONG_ORDER', senha: 'senha-gerente' })).rejects.toThrow('O prazo do iFood acabou');
  });

  it('o iFood diz que já foi respondida (pelo app dele): a tela ouve isso, e o caso fica como estava', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-7', 'ord-7'));
    respostaIfood = { ok: false, status: 422, codigo: 'DISPUTE_ALREADY_ANSWERED', mensagem: 'Já respondida' };
    await expect(svc.responder(usuario(), id!, { acao: 'recusar', motivo: 'INVENTORY_CHECK', senha: 'senha-gerente' })).rejects.toThrow('O iFood já recebeu uma resposta para esta disputa.');
    expect((await q(`select status from atendimento_chamado where id = $1`, [id]))[0].status).toBe('aberto');
  });

  it('no SERVIDOR DA LOJA: a senha é conferida aqui e a resposta vai à nuvem — sem a senha no corpo', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-8', 'ord-8'));
    process.env.EDGE_MODE = 'true';
    const antes = { api: process.env.CLOUD_API, tok: process.env.SYNC_TOKEN };
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1';
    process.env.SYNC_TOKEN = 'tok';
    const enviados: any[] = [];
    const fetchAntes = global.fetch;
    global.fetch = (async (url: any, init: any) => {
      enviados.push({ url: String(url), corpo: JSON.parse(init.body), token: init.headers['x-sync-token'] });
      return new Response(JSON.stringify({ ok: true, resposta: { acao: 'recusar', motivo: 'INVENTORY_CHECK', por: 'Ana gerente' } }), { status: 200 });
    }) as any;
    try {
      await svc.responder(usuario(), id!, { acao: 'recusar', motivo: 'INVENTORY_CHECK', senha: 'senha-gerente' });
    } finally {
      global.fetch = fetchAntes;
      process.env.CLOUD_API = antes.api;
      process.env.SYNC_TOKEN = antes.tok;
      delete process.env.EDGE_MODE;
    }
    expect(enviados.length).toBe(1);
    expect(enviados[0].url).toBe('https://nuvem.teste/api/v1/atendimento/disputa-da-loja');
    expect(enviados[0].token).toBe('tok');
    expect(enviados[0].corpo).toMatchObject({ chamadoId: id, acao: 'recusar', motivo: 'INVENTORY_CHECK', liberadorId: gerente, liberadorNome: 'Ana gerente' });
    expect(enviados[0].corpo.senha).toBeUndefined();
    expect(chamadasIfood).toEqual([]); // quem fala com o iFood é a nuvem
    expect((await q(`select status from atendimento_chamado where id = $1`, [id]))[0].status).toBe('resolvido');
  });

  it('na NUVEM, vindo da loja: responde ao iFood com quem a loja disse que liberou', async () => {
    const { id } = await registrarDisputa(db, emitir, ig, evento('disp-9', 'ord-9'));
    const r = await svc.responderVindoDaLoja(T, { chamadoId: id!, acao: 'recusar', motivo: 'INVENTORY_CHECK', liberadorId: gerente, liberadorNome: 'Ana gerente' });
    expect(r.resposta).toMatchObject({ acao: 'recusar', por: 'Ana gerente' });
    expect(chamadasIfood).toEqual([[ig, 'disp-9', 'reject', { reason: 'INVENTORY_CHECK' }]]);
    expect(auditoria[0]).toMatchObject({ origem: 'servidor_local' });
  });
});
