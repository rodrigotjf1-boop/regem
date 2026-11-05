import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { PonteChatGuard, type PonteCtx } from '../ponte-chat/ponte-chat.guard';
import { PonteChatService } from '../ponte-chat/ponte-chat.service';
import { casosDoChat } from '../ponte-chat/casos-do-chat';
import { ChatDoCasoService } from './chat-do-caso.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT DO iFOOD E DA 99 NA FILA DO ATENDIMENTO (ponte do chat, Etapa 2), contra o Postgres real: a mensagem do cliente
// que a ponte traz abre (ou soma) o caso "Mensagem no chat" do pedido; a conversa do caso vem em ordem, com quem escreveu e
// o estado de cada envio; a resposta da equipe entra na fila de saída que a ponte pega — e toda recusa vem antes de gravar.
// No servidor da loja, ler e responder vão à nuvem pelo token do servidor (V37). As tabelas da ponte são só da nuvem: o
// teste aplica as migrations, com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('chat-do-caso-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('o chat do iFood e da 99 na fila do Atendimento (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const eventos: Array<[string, any]> = [];
  const events = { emit: (ev: string, p: any) => void eventos.push([ev, p]) } as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const equipamentos = new EquipamentoService(db, { registrar: async () => {} } as any);
  const ponte = new PonteChatService(db, events);
  const chat = new ChatDoCasoService(db, events, ponte, auditoria);
  const guarda = new PonteChatGuard(equipamentos);
  const T = randomUUID();
  const T2 = randomUUID();
  let loja: string;
  let ana: string; // gerente
  let deOutra: string; // colaborador de outra empresa
  let delivery: { id: string; segredo: string };
  let servidor: { id: string; segredo: string };
  let pedidoA: string;

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  async function ponteNova(nome: string) {
    const criado = await equipamentos.criar(T, ana, 'gerente', { tipo: 'ponte_chat', nome, unidadeId: loja } as any);
    const { codigo } = await equipamentos.gerarCodigo(T, criado.id, ana, 'gerente');
    const p = await equipamentos.parearPorCodigo(codigo, `PC ${nome}`, 'ponte_chat');
    return { id: p.terminalId as string, segredo: p.segredo as string };
  }
  const entrar = async (p: { id: string; segredo: string }): Promise<PonteCtx> => {
    const req: any = { headers: { 'x-terminal-id': p.id, 'x-terminal-secret': p.segredo } };
    await guarda.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.ponteChat;
  };
  const erro = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  const ligar = (v: boolean) =>
    q(`insert into robo_config (tenant_id, chat_ponte_ligada) values ($1, $2) on conflict (tenant_id) do update set chat_ponte_ligada = $2`, [T, v]);
  let n = 0;
  /** A ponte do delivery traz do chat uma fala do cliente (id da plataforma novo a cada vez). */
  const doCliente = async (ext: string, texto: string, por = delivery) =>
    ponte.receber(await entrar(por), { mensagens: [{ canal: 'ifood', id: `sb-${++n}-${randomUUID().slice(0, 6)}`, pedido: { externo: ext }, cliente: 'Maria S.', autor: 'cliente', texto }] });
  const casosDo = (ext: string) =>
    q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'chat' and detalhe #>> '{chat,chave}' = $2 order by criado_em`, [T, `ext:${ext}`]);
  const user = (id = ana, categoria = 'gerente') => ({ tenantId: T, colaboradorId: id, categoria }) as any;
  const saidas = async () => (await q(`select count(*)::int as n from chat_plataforma_msg where tenant_id = $1 and direcao = 'saida'`, [T]))[0].n as number;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql']) await aplicar(m);
    for (const t of [T, T2]) await q(`insert into empresa (id, nome) values ($1, 'teste chat do caso')`, [t]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Ana', $2, 'ativo') returning id`, [T, loja]);
    [{ id: deOutra }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Intrusa', 'ativo') returning id`, [T2]);
    delivery = await ponteNova('Ponte do delivery');
    servidor = await ponteNova('Ponte do servidor');
    [{ id: pedidoA }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total)
       values ($1, $2, 'ifood', 'ifood-a', '4821', (floor(random()*90000)+10000)::int, 'entrega', 'despachado', 'Maria S.', 50) returning id`,
      [T, loja],
    );
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    await ligar(true);
    eventos.length = 0;
    auditados.length = 0;
  });
  afterAll(async () => {
    delete process.env.EDGE_MODE;
    for (const t of [T, T2]) {
      for (const tab of ['atendimento_chamado', 'chat_plataforma_msg', 'chat_ponte', 'robo_config', 'pedido_externo', 'equipamento', 'colaborador', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });

  it('a fala do cliente abre o caso "Mensagem no chat" do pedido; a seguinte soma; agradecimento sem caso não abre, com caso soma', async () => {
    expect(await doCliente('ifood-a', 'Cadê meu pedido?')).toMatchObject({ recebidas: 1, casosNovos: 1, casosSomados: 0 });
    let [c] = await casosDo('ifood-a');
    expect(c).toMatchObject({ tipo: 'chat', canal: 'ifood', status: 'aberto', pedido_id: pedidoA, cliente: 'Maria S.', unidade_id: loja, mensagem: 'Cadê meu pedido?', responsavel_id: null });
    expect(c.detalhe.chat).toMatchObject({ chave: 'ext:ifood-a', pedidoExterno: 'ifood-a' });
    expect(eventos.map(([ev]) => ev)).toEqual(['atendimento.novo']);
    expect(await doCliente('ifood-a', 'Alguém aí?')).toMatchObject({ casosNovos: 0, casosSomados: 1 });
    [c] = await casosDo('ifood-a');
    expect(c.mensagem).toBe('Alguém aí?');
    expect(await casosDo('ifood-a')).toHaveLength(1);
    // o "obrigada" de quem recebeu o aviso "saiu": sem caso aberto, não abre
    expect(await doCliente('ifood-b', 'Obrigada!')).toMatchObject({ recebidas: 1, casosNovos: 0, casosSomados: 0 });
    expect(await casosDo('ifood-b')).toHaveLength(0);
    // com o caso aberto, a mesma palavra soma (a equipe vê)
    expect(await doCliente('ifood-a', 'Obrigada!')).toMatchObject({ casosSomados: 1 });
    expect((await casosDo('ifood-a'))[0].mensagem).toBe('Obrigada!');
  });

  it('aguardando o cliente volta para a fila com o mesmo responsável; resolvido não reabre — a fala nova abre OUTRO caso', async () => {
    await doCliente('ifood-c', 'Vocês entregam na portaria?');
    let [c] = await casosDo('ifood-c');
    await q(`update atendimento_chamado set responsavel_id = $2, pego_em = now(), aguardando_desde = now() where id = $1`, [c.id, ana]);
    await doCliente('ifood-c', 'Pode ser na portaria sim');
    [c] = await casosDo('ifood-c');
    expect(c).toMatchObject({ aguardando_desde: null, responsavel_id: ana, status: 'aberto' });
    await q(`update atendimento_chamado set status = 'resolvido', resolvido_em = now() where id = $1`, [c.id]);
    expect(await doCliente('ifood-c', 'Esqueci de pedir o molho')).toMatchObject({ casosNovos: 1, casosSomados: 0 });
    const casos = await casosDo('ifood-c');
    expect(casos.map((x: any) => [x.status, x.mensagem])).toEqual([
      ['resolvido', 'Pode ser na portaria sim'],
      ['aberto', 'Esqueci de pedir o molho'],
    ]);
    expect(casos[1].responsavel_id).toBeNull(); // o caso novo nasce na fila
  });

  it('duas pontes ao mesmo tempo, falas diferentes do mesmo pedido: um caso só', async () => {
    await Promise.all([doCliente('ifood-d', 'Oi', delivery), doCliente('ifood-d', 'Cadê?', servidor), doCliente('ifood-d', 'Alô', delivery)]);
    expect(await casosDo('ifood-d')).toHaveLength(1);
  });

  it('o cruzamento forçado: a 2ª transação espera a 1ª (a trava da empresa) e soma no caso dela — sem a trava, seriam dois', async () => {
    // Duas transações de verdade: A abre o caso e NÃO confirma; B chega com outra fala do mesmo pedido. O teste espera B
    // ficar presa ATRÁS de A (pg_blocking_pids a partir do pid de B — V72) ou terminar (sem a trava), e só então confirma A.
    const a = await pool.connect();
    const b = await pool.connect();
    const dbA = drizzle(a as any, { schema }) as any;
    const dbB = drizzle(b as any, { schema }) as any;
    try {
      const [{ pid: pidA }] = (await a.query('select pg_backend_pid() as pid')).rows;
      const [{ pid: pidB }] = (await b.query('select pg_backend_pid() as pid')).rows;
      const fala = (texto: string) => ({ canal: 'ifood', pedidoId: null, pedidoExterno: 'ifood-x', pedidoNumero: null, cliente: 'Maria S.', unidadeId: loja, texto, criadoEm: new Date() });
      await a.query('begin');
      await b.query('begin');
      const ra = await casosDoChat(dbA, T, [fala('Oi, alguém aí?')]);
      expect(ra.novos).toHaveLength(1);
      let bTerminou = false;
      const pb = casosDoChat(dbB, T, [fala('Cadê meu pedido?')]).finally(() => (bTerminou = true));
      let presaAtrasDeA = false;
      for (let i = 0; i < 100 && !bTerminou && !presaAtrasDeA; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const [{ presa }] = await q(`select $2::int = any(pg_blocking_pids($1::int)) as presa`, [pidB, pidA]);
        presaAtrasDeA = presa === true;
      }
      expect({ presaAtrasDeA, bTerminou }).toEqual({ presaAtrasDeA: true, bTerminou: false });
      await a.query('commit');
      const rb = await pb;
      await b.query('commit');
      expect([rb.novos.length, rb.somados.length]).toEqual([0, 1]);
      const casos = await casosDo('ifood-x');
      expect(casos.map((c: any) => c.mensagem)).toEqual(['Cadê meu pedido?']);
    } finally {
      await a.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      a.release();
      b.release();
    }
  });

  it('a conversa do caso: as mensagens do pedido em ordem, quem escreveu, o estado de cada envio e se a ponte responde', async () => {
    await doCliente('ifood-a', 'Cheguei a pedir sem cebola?');
    const [c] = (await casosDo('ifood-a')).filter((x: any) => x.status === 'aberto');
    // o aviso automático "saiu" (ligado pelo pedido do Regem, como a rotina grava) já tinha saído
    await q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_id, direcao, autor, motivo, texto, estado, enviado_em)
       values ($1, $2, 'ifood', $3, 'saida', 'aviso', 'saiu', 'Seu pedido saiu para entrega!', 'enviada', now())`,
      [T, loja, pedidoA],
    );
    await chat.responderNaEmpresa(T, c.id, 'Sem cebola, sim!', { id: ana, perfil: 'gerente' }, 'web');
    let conversa = await chat.conversaDaEmpresa(T, c.id);
    expect(conversa.disponivel).toBe(true);
    expect(conversa.canal).toBe('ifood');
    expect(conversa.mensagens.slice(-3).map((m) => [m.direcao, m.autor, m.motivo, m.texto, m.estado, m.quem])).toEqual([
      ['entrada', 'cliente', null, 'Cheguei a pedir sem cebola?', 'recebida', null],
      ['saida', 'aviso', 'saiu', 'Seu pedido saiu para entrega!', 'enviada', null],
      ['saida', 'equipe', null, 'Sem cebola, sim!', 'pendente', 'Ana'],
    ]);
    expect(conversa.mensagens[0]).toMatchObject({ autor: 'cliente', texto: 'Cadê meu pedido?' }); // a 1ª fala do 1º teste
    expect(conversa.ponte).toEqual({ ligada: true, responde: false }); // nenhuma ponte com sinal de vida
    await ponte.estado(await entrar(delivery), { plataformas: { ifood: { logado: true } }, versao: '0.4.0', maquina: 'CX-DELIVERY' });
    conversa = await chat.conversaDaEmpresa(T, c.id);
    expect(conversa.ponte).toEqual({ ligada: true, responde: true });
    // caso de outro canal (WhatsApp): não tem chat de plataforma
    const [{ id: zap }] = await q(`insert into atendimento_chamado (tenant_id, tipo, canal, telefone) values ($1, 'humano', 'whatsapp', '21999990000') returning id`, [T]);
    expect(await chat.conversaDaEmpresa(T, zap)).toMatchObject({ disponivel: false, mensagens: [] });
  });

  it('responder: entra na fila de saída que a ponte pega, o caso fica com quem respondeu e a auditoria guarda o tamanho', async () => {
    await doCliente('ifood-e', 'Meu lanche veio frio');
    const [c] = await casosDo('ifood-e');
    const r = await chat.responderNaEmpresa(T, c.id, '  Vamos mandar outro agora.  ', { id: ana, perfil: 'gerente' }, 'web');
    expect(r).toMatchObject({ ok: true, estado: 'pendente' });
    const [m] = await q(`select * from chat_plataforma_msg where id = $1`, [r.id]);
    expect(m).toMatchObject({ direcao: 'saida', autor: 'equipe', autor_id: ana, texto: 'Vamos mandar outro agora.', estado: 'pendente', pedido_externo: 'ifood-e', canal: 'ifood', cliente_nome: 'Maria S.' });
    expect((await casosDo('ifood-e'))[0].responsavel_id).toBe(ana);
    expect(auditados).toEqual([expect.objectContaining({ acao: 'respondeu_no_chat_da_plataforma', entidadeId: c.id, detalhe: { canal: 'ifood', mensagemId: r.id, letras: 25 } })]);
    expect(eventos).toContainEqual(['atendimento.mudou', { tenantId: T, id: c.id, motivo: 'respondeu_no_chat' }]);
    // a ponte que responde pelo canal pega a mensagem para digitar no chat
    const d = await entrar(delivery);
    await ponte.estado(d, { plataformas: { ifood: { logado: true } }, versao: '0.4.0', maquina: 'CX-DELIVERY' });
    const pegou = await ponte.pegar(d, { canal: 'ifood' });
    expect(pegou.itens.find((i: any) => i.id === r.id)).toMatchObject({ texto: 'Vamos mandar outro agora.', pedidoExterno: 'ifood-e', cliente: 'Maria S.' });
  });

  it('as recusas vêm antes de gravar: vazio, longo, contato proibido, caso resolvido, ponte desligada, sem chat, caso de outra empresa', async () => {
    await doCliente('ifood-f', 'Oi?');
    const [c] = await casosDo('ifood-f');
    const antes = await saidas();
    const responder = (texto: unknown, id = c.id) => erro(chat.responderNaEmpresa(T, id, texto, { id: ana, perfil: 'gerente' }, 'web'));
    expect((await responder('   '))?.message).toBe('Escreva a mensagem.');
    expect((await responder('x'.repeat(301)))?.message).toBe('No chat da plataforma cabem até 300 letras.');
    expect((await responder('Me chama no whats 21 99999-0000'))?.message).toBe(
      'O iFood proíbe telefone, WhatsApp, Instagram e link no chat. Tire isso da mensagem para enviar.',
    );
    expect((await responder('Veja em www.loja.com.br'))?.status).toBe(400);
    await ligar(false);
    expect((await responder('Oi!'))?.message).toBe('A ponte do chat está desligada. Responda pelo Gestor de Pedidos do iFood.');
    await ligar(true);
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [c.id]);
    expect((await responder('Oi!'))?.status).toBe(409);
    const [{ id: zap }] = await q(`insert into atendimento_chamado (tenant_id, tipo, canal) values ($1, 'humano', 'whatsapp') returning id`, [T]);
    expect((await responder('Oi!', zap))?.message).toBe('Este caso não tem chat do iFood nem da 99.');
    expect((await erro(chat.responderNaEmpresa(T2, c.id, 'Oi!', { id: null, perfil: 'gerente' }, 'web')))?.status).toBe(404);
    expect((await responder('Oi!', 'nao-e-uuid'))?.status).toBe(404);
    expect(await saidas()).toBe(antes);
  });

  it('do servidor da loja: o ator de outra empresa não vale (a mensagem sai sem autor e o caso não muda de mãos)', async () => {
    await doCliente('ifood-g', 'Tem troco para 50?');
    const [c] = await casosDo('ifood-g');
    const r = await chat.responderVindoDaLoja(T, { chamadoId: c.id, texto: 'Temos sim!', atorId: deOutra, atorPerfil: 'gerente' });
    const [m] = await q(`select autor_id from chat_plataforma_msg where id = $1`, [r.id]);
    expect(m.autor_id).toBeNull();
    expect((await casosDo('ifood-g'))[0].responsavel_id).toBeNull();
    expect(auditados[0]).toMatchObject({ origem: 'servidor_loja', atorId: null });
  });

  it('no servidor da loja, ler e responder vão à nuvem pelo token do servidor; a recusa da nuvem chega igual', async () => {
    await doCliente('ifood-h', 'Oi');
    const [c] = await casosDo('ifood-h');
    const fetchAntes = global.fetch;
    const pedidos: Array<{ url: string; init: any }> = [];
    let resposta: { status: number; corpo: any } = { status: 200, corpo: { disponivel: true, canal: 'ifood', ponte: { ligada: true, responde: true }, mensagens: [] } };
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      return new Response(JSON.stringify(resposta.corpo), { status: resposta.status, headers: { 'content-type': 'application/json' } });
    }) as any;
    const antes = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
    process.env.EDGE_MODE = 'true';
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1/';
    process.env.SYNC_TOKEN = 'token-do-servidor';
    try {
      expect(await chat.conversa(user(), c.id)).toMatchObject({ disponivel: true });
      expect(pedidos[0].url).toBe(`https://nuvem.teste/api/v1/atendimento/chat-da-loja?chamado=${c.id}`);
      expect(pedidos[0].init.headers['x-sync-token']).toBe('token-do-servidor');
      resposta = { status: 200, corpo: { ok: true, id: randomUUID(), estado: 'pendente' } };
      await chat.responder(user(), c.id, { texto: 'Oi! Já vamos ver.' });
      expect(pedidos[1].url).toBe('https://nuvem.teste/api/v1/atendimento/chat-da-loja');
      expect(JSON.parse(pedidos[1].init.body)).toEqual({ chamadoId: c.id, texto: 'Oi! Já vamos ver.', atorId: ana, atorPerfil: 'gerente' });
      expect((await casosDo('ifood-h'))[0].responsavel_id).toBe(ana); // aqui também, sem esperar o sincronismo
      resposta = { status: 409, corpo: { message: 'Este caso já foi resolvido.' } };
      const e = await erro(chat.responder(user(), c.id, { texto: 'Oi' }));
      expect([e?.status, e?.message]).toEqual([409, 'Este caso já foi resolvido.']);
      delete process.env.SYNC_TOKEN;
      expect((await erro(chat.conversa(user(), c.id)))?.status).toBe(502);
    } finally {
      global.fetch = fetchAntes;
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
