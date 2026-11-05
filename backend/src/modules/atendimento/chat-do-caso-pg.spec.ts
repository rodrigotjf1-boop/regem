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
import { casosDoChat, chaveDaConversa, chaveSql } from '../ponte-chat/casos-do-chat';
import { sql } from 'drizzle-orm';
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
  /** Uma mensagem do chat gravada direto, `min` minutos atrás (as "Conversas agora" olham a última hora). */
  const msg = (
    ext: string | null,
    o: { min: number; direcao?: string; autor?: string; texto?: string; unidade?: string | null; tenant?: string; pedidoId?: string | null; numero?: string | null; cliente?: string | null },
  ) =>
    q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_id, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto, estado, criado_em)
       values ($1, $2, 'ifood', $3, $4, $5, $6, $7, $8, $9, $10, now() - make_interval(mins => $11))`,
      [
        o.tenant ?? T,
        o.unidade === undefined ? loja : o.unidade,
        o.pedidoId ?? null,
        ext,
        o.numero ?? null,
        o.cliente === undefined ? 'Paulo T.' : o.cliente,
        o.direcao ?? 'entrada',
        o.autor ?? 'cliente',
        o.texto ?? 'Oi',
        (o.direcao ?? 'entrada') === 'saida' ? 'enviada' : 'recebida',
        o.min,
      ],
    );
  const chavesAgora = async (unidade: string | null = loja, t = T) =>
    ((await chat.conversasAgora(t, unidade)).conversas as any[]).map((c) => c.chave as string);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql']) await aplicar(m);
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

  // ───────────────────────── Conversas agora ─────────────────────────

  it('a chave em SQL é a MESMA da função da fila (id na plataforma > id do pedido > número)', async () => {
    const formas = [
      { pedidoExterno: 'ifood-zz', pedidoId: pedidoA, pedidoNumero: '4821' },
      { pedidoExterno: null, pedidoId: pedidoA, pedidoNumero: '4821' },
      { pedidoExterno: null, pedidoId: null, pedidoNumero: '4821' },
      { pedidoExterno: null, pedidoId: null, pedidoNumero: null },
    ];
    for (const f of formas) {
      const r = await db.execute(sql`
        select ${chaveSql('m')} as chave
          from (select ${f.pedidoExterno}::text as pedido_externo, ${f.pedidoId}::uuid as pedido_id, ${f.pedidoNumero}::text as pedido_numero) m`);
      expect((r.rows ?? r)[0].chave).toBe(chaveDaConversa(f));
    }
  });

  it('Conversas agora: só as da última hora SEM caso aberto, da loja em uso, com as últimas 8 mensagens em ordem e o pedido', async () => {
    const [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    const [{ id: pedidoK }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total)
       values ($1, $2, 'ifood', 'ifood-k', '4790', (floor(random()*90000)+10000)::int, 'entrega', 'despachado', 'Paulo T.', 40) returning id`,
      [T, loja],
    );
    // 10 mensagens na última hora (cliente e robô alternados): vêm as 8 últimas, da mais antiga para a mais nova
    for (let i = 1; i <= 10; i++)
      await msg('ifood-k', { min: 55 - i * 5, pedidoId: pedidoK, direcao: i % 2 ? 'entrada' : 'saida', autor: i % 2 ? 'cliente' : 'robo', texto: `m${i}` });
    await msg('ifood-velha', { min: 90, texto: 'Faz tempo' }); // fora da última hora
    await msg('ifood-loja-b', { min: 10, unidade: lojaB, texto: 'Da outra loja' });
    await msg('ifood-sem-loja', { min: 2, unidade: null, cliente: null, numero: '77', texto: 'Sem loja' });
    await msg('ifood-sem-loja', { min: 60 * 30, unidade: null, cliente: null, numero: '77', texto: 'De ontem' }); // fora do último dia
    await msg('ifood-t2', { min: 1, tenant: T2, unidade: null, texto: 'De outra empresa' });
    await doCliente('ifood-m', 'Cadê meu pedido?'); // abre caso: some daqui

    const r = await chat.conversasAgora(T, loja);
    const chaves = (r.conversas as any[]).map((c) => c.chave);
    expect(chaves).toEqual(expect.arrayContaining(['ext:ifood-k', 'ext:ifood-sem-loja']));
    for (const fora of ['ext:ifood-velha', 'ext:ifood-loja-b', 'ext:ifood-t2', 'ext:ifood-m']) expect(chaves).not.toContain(fora);
    expect(chaves.indexOf('ext:ifood-sem-loja')).toBeLessThan(chaves.indexOf('ext:ifood-k')); // a mais recente primeiro
    const k = (r.conversas as any[]).find((c) => c.chave === 'ext:ifood-k');
    expect(k).toMatchObject({ canal: 'ifood', cliente: 'Paulo T.', pedidoId: pedidoK, pedidoNumero: '4790', pedidoStatus: 'despachado' });
    expect(k.mensagens.map((m: any) => m.texto)).toEqual(['m3', 'm4', 'm5', 'm6', 'm7', 'm8', 'm9', 'm10']);
    expect(k.mensagens[1]).toMatchObject({ direcao: 'saida', autor: 'robo', estado: 'enviada', motivo: null });
    expect(new Date(k.ultima).getTime()).toBeGreaterThan(Date.now() - 6 * 60_000);
    const semLoja = (r.conversas as any[]).find((c) => c.chave === 'ext:ifood-sem-loja');
    expect(semLoja).toMatchObject({ cliente: null, pedidoId: null, pedidoNumero: '77', pedidoStatus: null });
    expect(semLoja.mensagens.map((m: any) => m.texto)).toEqual(['Sem loja']); // a leitura é do último dia, não do histórico
    expect(r.roboResponde).toBe(false);
    // todas as lojas (presidente, loja única): a da outra loja aparece; a de outra empresa nunca
    expect(await chavesAgora(null)).toEqual(expect.arrayContaining(['ext:ifood-loja-b', 'ext:ifood-k']));
    expect(await chavesAgora(null)).not.toContain('ext:ifood-t2');
    // resolvido o caso, a conversa volta (o robô volta a atender)
    await q(`update atendimento_chamado set status = 'resolvido', resolvido_em = now() where tenant_id = $1 and detalhe #>> '{chat,chave}' = 'ext:ifood-m'`, [T]);
    expect(await chavesAgora()).toContain('ext:ifood-m');
    // o robô do chat ligado vem junto (a tela diz "com o robô" só assim)
    await q(`update robo_config set chat_robo_responde = true where tenant_id = $1`, [T]);
    try {
      expect((await chat.conversasAgora(T, loja)).roboResponde).toBe(true);
    } finally {
      await q(`update robo_config set chat_robo_responde = false where tenant_id = $1`, [T]);
    }
  });

  it('Assumir a conversa: o caso nasce com quem assumiu; já aberto sem ninguém fica com ela; com outra pessoa, 409 com o nome', async () => {
    const [{ id: bia }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Bia', $2, 'ativo') returning id`, [T, loja]);
    await msg('ifood-n', { min: 3, texto: 'Qual a previsão?', cliente: 'Carla M.', numero: '95' });
    await msg('ifood-n', { min: 2, direcao: 'saida', autor: 'robo', texto: 'Chega por volta das 20h40.', cliente: 'Carla M.', numero: '95' });
    const r = await chat.assumir(user(), { canal: 'ifood', chave: 'ext:ifood-n' });
    expect(r).toMatchObject({ ok: true });
    let casos = await casosDo('ifood-n');
    expect(casos).toHaveLength(1);
    expect(casos[0]).toMatchObject({
      id: r.id,
      tipo: 'chat',
      canal: 'ifood',
      status: 'aberto',
      responsavel_id: ana,
      cliente: 'Carla M.',
      pedido_numero: '95',
      unidade_id: loja,
      mensagem: 'Qual a previsão?',
      prioridade: 'normal',
    });
    expect(casos[0].pego_em).not.toBeNull();
    expect(casos[0].detalhe).toMatchObject({ chat: { chave: 'ext:ifood-n', pedidoExterno: 'ifood-n', pedidoNumero: '95' }, assumida: true });
    expect(auditados).toEqual([
      expect.objectContaining({ acao: 'assumiu_conversa_do_chat', entidadeId: r.id, atorId: ana, detalhe: { canal: 'ifood', chave: 'ext:ifood-n' } }),
    ]);
    expect(eventos.map(([ev]) => ev)).toEqual(['atendimento.novo']);
    expect(await chavesAgora()).not.toContain('ext:ifood-n'); // virou caso: sai das "Conversas agora"
    // a fala seguinte do cliente soma no caso assumido; assumir de novo devolve o mesmo caso
    expect(await doCliente('ifood-n', 'Ok, obrigada')).toMatchObject({ casosNovos: 0, casosSomados: 1 });
    expect((await chat.assumir(user(), { canal: 'ifood', chave: 'ext:ifood-n' })).id).toBe(r.id);
    // com outra pessoa: 409 com o nome, e o caso não muda de mãos
    const e = await erro(chat.assumir(user(bia, 'supervisao'), { canal: 'ifood', chave: 'ext:ifood-n' }));
    expect([e?.status, e?.message]).toEqual([409, 'Ana já está com esta conversa.']);
    expect((await casosDo('ifood-n'))[0].responsavel_id).toBe(ana);
    // o caso que a fala do cliente abriu, sem ninguém: fica com quem assumiu (não abre outro)
    await doCliente('ifood-o', 'Veio sem o refrigerante');
    const [o] = await casosDo('ifood-o');
    expect(o.responsavel_id).toBeNull();
    expect((await chat.assumir(user(bia, 'supervisao'), { canal: 'ifood', chave: 'ext:ifood-o' })).id).toBe(o.id);
    casos = await casosDo('ifood-o');
    expect(casos.map((c: any) => [c.id, c.responsavel_id])).toEqual([[o.id, bia]]);
  });

  it('Assumir a conversa: as recusas vêm antes de gravar (inválida, sem usuário, inexistente, de outra empresa)', async () => {
    await msg('ifood-q', { min: 1, texto: 'Oi' });
    const contar = async () => (await q(`select count(*)::int as n from atendimento_chamado where tenant_id in ($1, $2)`, [T, T2]))[0].n as number;
    const antes = await contar();
    const assumir = (u: any, dto: any) => erro(chat.assumir(u, dto));
    expect((await assumir(user(), { canal: 'whatsapp', chave: 'ext:ifood-q' }))?.status).toBe(400);
    expect((await assumir(user(), { canal: 'ifood', chave: 'ifood-q' }))?.status).toBe(400);
    expect((await assumir(user(), { canal: 'ifood', chave: `ext:${'x'.repeat(121)}` }))?.status).toBe(400);
    expect((await assumir(user(), null))?.status).toBe(400);
    expect((await assumir({ tenantId: T, colaboradorId: null, categoria: 'gerente' }, { canal: 'ifood', chave: 'ext:ifood-q' }))?.status).toBe(403);
    expect((await assumir(user(), { canal: 'ifood', chave: 'ext:nao-existe' }))?.message).toBe('Esta conversa não está mais no chat.');
    expect((await assumir({ tenantId: T2, colaboradorId: deOutra, categoria: 'gerente' }, { canal: 'ifood', chave: 'ext:ifood-q' }))?.status).toBe(404);
    expect(await contar()).toBe(antes);
    expect(auditados).toEqual([]);
  });

  it('o cruzamento forçado: "assumir" e a fala do cliente ao mesmo tempo esperam a MESMA trava — um caso só, com quem assumiu', async () => {
    // L segura a trava da empresa (a linha do robo_config); "assumir" e a fala (B) têm de ficar presas ATRÁS de L (V72: pelas
    // sessões que L — ou B, na fila da mesma linha — bloqueia; a linha é desta empresa, ninguém mais a trava). Sem a trava
    // no "assumir", ele passaria direto e, com a fala, seriam dois casos.
    await msg('ifood-p', { min: 1, texto: 'Oi' });
    const l = await pool.connect();
    const b = await pool.connect();
    const dbB = drizzle(b as any, { schema }) as any;
    try {
      const [{ pid: pidL }] = (await l.query('select pg_backend_pid() as pid')).rows;
      const [{ pid: pidB }] = (await b.query('select pg_backend_pid() as pid')).rows;
      await l.query('begin');
      await l.query(`select 1 from robo_config where tenant_id = $1 for update`, [T]);
      let assumiu = false;
      const pa = chat.assumir(user(), { canal: 'ifood', chave: 'ext:ifood-p' }).finally(() => (assumiu = true));
      await b.query('begin');
      let falou = false;
      const fala = { canal: 'ifood', pedidoId: null, pedidoExterno: 'ifood-p', pedidoNumero: null, cliente: 'Paulo T.', unidadeId: loja, texto: 'Cadê?', criadoEm: new Date() };
      const pb = casosDoChat(dbB, T, [fala]).finally(() => (falou = true));
      // Presas: quem L bloqueia, a própria B e quem espera atrás de B (o 2º da fila da linha espera o 1º, não L).
      let presas = 0;
      for (let i = 0; i < 100 && !assumiu && !falou && presas < 2; i++) {
        await new Promise((r) => setTimeout(r, 50));
        [{ n: presas }] = await q(
          `select count(*)::int as n from pg_stat_activity
            where cardinality(pg_blocking_pids(pid)) > 0
              and ($1::int = any(pg_blocking_pids(pid)) or pid = $2::int or $2::int = any(pg_blocking_pids(pid)))`,
          [pidL, pidB],
        );
      }
      expect({ presas, assumiu, falou }).toEqual({ presas: 2, assumiu: false, falou: false });
      await l.query('commit');
      // Quem pegar a trava primeiro passa; a fala segura a dela até o commit de B — só então o "assumir" anda, se for o 2º.
      const rb = await pb;
      await b.query('commit');
      const ra = await pa;
      const casos = await casosDo('ifood-p');
      expect(casos).toHaveLength(1);
      expect(casos[0]).toMatchObject({ id: ra.id, responsavel_id: ana, status: 'aberto' });
      expect(rb.novos.length + rb.somados.length).toBe(1);
    } finally {
      await l.query('rollback').catch(() => {});
      await b.query('rollback').catch(() => {});
      l.release();
      b.release();
    }
  });

  it('a leitura das Conversas agora vai pelo índice por hora (367): não lê o histórico inteiro da empresa', async () => {
    // Uma empresa à parte com 3.000 mensagens antigas e nenhuma loja escolhida (loja única, presidente) — o caso em que o
    // índice da 366 (empresa, loja, hora) não serve.
    const T3 = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'teste plano do chat')`, [T3]);
    try {
      await q(
        `insert into chat_plataforma_msg (tenant_id, canal, pedido_externo, direcao, autor, texto, estado, criado_em)
         select $1, 'ifood', 'velho-' || (g % 300), 'entrada', 'cliente', 'antiga', 'recebida', now() - make_interval(days => 2 + g % 60)
           from generate_series(1, 3000) g`,
        [T3],
      );
      await msg('ifood-novo', { min: 3, tenant: T3, unidade: null });
      await q('analyze chat_plataforma_msg');
      const r = await db.execute(sql`explain (format json) ${chat.sqlDasConversasAgora(T3, null)}`);
      const nos: any[] = [];
      const andar = (n: any) => {
        nos.push(n);
        for (const f of n.Plans ?? []) andar(f);
      };
      andar((r.rows ?? r)[0]['QUERY PLAN'][0].Plan);
      expect(nos.filter((n) => n['Relation Name'] === 'chat_plataforma_msg').map((n) => n['Node Type'])).not.toContain('Seq Scan');
      // No Postgres 16 (CI) e 17 (produção) só o índice da 367 lê o intervalo; do 18 em diante o da 366 também (pula a loja).
      const [{ v }] = await q(`select current_setting('server_version_num')::int as v`);
      const aceitos = v < 180000 ? ['idx_chat_msg_empresa_hora'] : ['idx_chat_msg_empresa_hora', 'idx_chat_msg_loja'];
      const leituras = nos.filter((n) => aceitos.includes(n['Index Name']));
      expect(leituras.length).toBeGreaterThan(0);
      // e o índice corta pela hora (o intervalo do último dia), não só pela empresa
      for (const n of leituras) expect(String(n['Index Cond'] ?? '')).toContain('criado_em');
      expect(await chavesAgora(null, T3)).toEqual(['ext:ifood-novo']);
    } finally {
      await q(`delete from chat_plataforma_msg where tenant_id = $1`, [T3]);
      await q(`delete from empresa where id = $1`, [T3]);
    }
  });
});
