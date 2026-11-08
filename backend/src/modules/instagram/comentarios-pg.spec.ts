import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { cifrar } from '../../common/cifra-segredo';
import { uuidDeChave } from '../../common/id-deterministico';
import { InstagramService } from './instagram.service';
import { InstagramController } from './instagram.controller';
import { LIMITE_DO_ROBO_POR_HORA, NOME_DO_MOTIVO_DO_COMENTARIO, cursorDe } from './comentarios';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RECUSA_NO_COMENTARIO, WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { RoboConsultasController } from '../cardapio/robo-consultas.controller';
import { RoboPedidoController } from '../cardapio/robo-pedido.controller';
import { RESPOSTA_DO_PEDIDO_NO_COMENTARIO, RoboPedidoService } from '../cardapio/robo-pedido.service';
import { VERSAO_DOS_COMENTARIOS } from '../cardapio/robo-instrucoes';
import { TEXTO_DO_PERFIL } from '../cardapio/perfis-do-atendente';
import { ClienteService } from '../cliente/cliente.service';
import { FilaEAvisosService } from '../atendimento/fila-e-avisos.service';
import { AtendimentoController } from '../atendimento/atendimento.controller';
import { AtendimentoLojaController } from '../atendimento/atendimento-loja.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6 do atendente virtual, mig 384), contra o Postgres real, uma META e um n8n DE
// MENTIRA locais (nada sai para fora): o aviso `comments` grava (o repetido não duplica; o da loja, o `live_comments`, a conta
// sem a permissão e a empresa apagada ficam de fora), o post lido uma vez, a entrega ao robô (a chave `cm:`, o corpo, a
// marca; o emoji, o robô desligado e o limite por hora não vão; a entrega que falha apaga a marca), a resposta do robô no
// post (o CORPO que sai para a Meta — V20 —, uma só, a trava), o "chamar atendente" (o caso, a privada — uma só, 7 dias —,
// a linha do Direct, a senha e a empresa), as rotas da tela (a lista com filtro, contagem e cursor; responder; privada;
// esconder; o caso; os 409; o RBAC; o servidor da loja pela nuvem), os ajustes e as ferramentas que recusam `cm:`. Aplica as
// migrations só da nuvem (o banco do CI é o de uma loja — ERR-329) com a trava da empresa na frente (ERR-377) e a repetição
// da corrida (ERR-405).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('comentarios-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
// Contas próprias deste spec (o ig_user_id é único entre as empresas — as outras specs usam outras).
const CONTA = '17841400000000277';
const CONTA2 = '17841400000000278';
const MIDIA = '18000000000000277';
const IGSID = '99887766554477';
const SENHA = 'senha-do-robo-dos-comentarios';
const TOKEN_IG = 'tok-ig-comentarios-1';
const PERMISSOES = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';

descrever('Comentários dos posts do Instagram (Postgres + Meta e n8n de mentira)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let CARD: string;
  let TOK: string;
  let TOK2: string;
  let svc: InstagramService;
  let resposta: RoboRespostaService;
  let cardapio: CardapioService;
  let consultas: RoboConsultasController;
  let pedidoCtl: RoboPedidoController;
  let clienteSvc: ClienteService;
  let fila: FilaEAvisosService;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aoRobo: Array<{ corpo: any; segredo: string | undefined }> = [];
  const aMeta: Array<{ metodo: string; caminho: string; consulta: Record<string, string>; auth: string | undefined; corpo: any }> = [];
  const aNuvem: Array<{ metodo: string; caminho: string; token: string | undefined; corpo: any }> = [];
  let respostaDaNuvem: { status: number; corpo: any } = { status: 200, corpo: { itens: [], via: 'nuvem' } };
  const falhar = { replies: false, messages: false, hide: false, midia: false };
  let n8nStatus = 200;
  const eventos: Array<{ nome: string; dados: any }> = [];
  const auditados: any[] = [];
  const pessoa: Record<string, string> = {};
  let n = 0;
  let nMeta = 0;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const cid = () => `1786${String(++n).padStart(12, '0')}`;
  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const r: any = await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
  const aviso = (o: { id: string; texto?: string; autorId?: string; usuario?: string | null; pai?: string; midia?: string; conta?: string; field?: string; em?: number }) => ({
    object: 'instagram',
    entry: [
      {
        id: o.conta ?? CONTA,
        time: Math.floor((o.em ?? Date.now()) / 1000),
        changes: [
          {
            field: o.field ?? 'comments',
            value: {
              id: o.id,
              from: { id: o.autorId ?? '555000111', ...(o.usuario === null ? {} : { username: o.usuario ?? 'joana.souza' }) },
              text: o.texto ?? 'Que delícia! Vocês abrem domingo?',
              media: { id: o.midia ?? MIDIA, media_product_type: 'FEED' },
              ...(o.pai ? { parent_id: o.pai } : {}),
            },
          },
        ],
      },
    ],
  });
  /** Um comentário pelo caminho de verdade (o aviso da Meta), esperando a entrega ao robô terminar. */
  const comentar = async (o: Parameters<typeof aviso>[0]) => {
    await svc.processar(aviso(o));
    await svc.comentarios.esperarEntregas();
  };
  const linha = async (comentarioId: string, tenant = T) =>
    (await q(`select * from instagram_comentario where tenant_id = $1 and comentario_id = $2`, [tenant, comentarioId]))[0];
  const ligar = (o: { robo?: boolean; fila?: boolean; permissoes?: string } = {}) =>
    q(`update instagram_conta set comentarios_robo = $2, comentarios_fila = $3, permissoes = $4 where tenant_id = $1`, [T, o.robo ?? true, o.fila ?? true, o.permissoes ?? PERMISSOES]);
  const responder = (chave: string, texto: string, extra: any = {}) => resposta.responder(SENHA, { instancia: chave, para: chave, texto, ...extra } as any);
  const chamar = (chave: string, extra: any = {}, segredo = SENHA, tok?: string) =>
    cardapio.abrirAtendimento(tok ?? TOK, { tipo: 'erro', telefone: chave, mensagem: 'Motivo: pedido veio frio\nQuer: resolver\nJá fiz: chamei a equipe', ...extra }, segredo);
  const user = (cat: string, quem = 'ana') => ({ tenantId: T, colaboradorId: pessoa[quem], categoria: cat }) as any;
  const doMeta = (tipo: 'replies' | 'messages' | 'hide' | 'midia') =>
    aMeta.filter((m) =>
      tipo === 'replies'
        ? m.caminho.endsWith('/replies')
        : tipo === 'messages'
          ? m.caminho.endsWith('/messages')
          : tipo === 'hide'
            ? m.metodo === 'POST' && 'hide' in m.consulta
            : m.metodo === 'GET',
    );
  const casosDoComentario = () => q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'instagram_comentario' order by criado_em`, [T]);
  const esperar = async (fn: () => Promise<boolean> | boolean, vezes = 80) => {
    for (let i = 0; i < vezes; i++) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '377_instagram_direct.sql',
      '378_instagram_robo_no_direct.sql',
      '379_horario_da_equipe.sql',
      '380_perfis_do_atendente.sql',
      '381_assuntos_do_atendente.sql',
      '382_treinar_atendente.sql',
      '384_comentarios_do_instagram.sql',
    ])
      await aplicar(m);
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const u = new URL(req.url ?? '/', 'http://x');
        const j = (s: number, b: any) => {
          res.statusCode = s;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(b));
        };
        const lido = corpo ? JSON.parse(corpo) : null;
        if (u.pathname === '/n8n') {
          aoRobo.push({ corpo: lido, segredo: req.headers['x-regem-robo-segredo'] as string });
          return j(n8nStatus, {});
        }
        if (u.pathname.startsWith('/nuvem/')) {
          aNuvem.push({ metodo: String(req.method), caminho: `${u.pathname}${u.search}`, token: req.headers['x-sync-token'] as string, corpo: lido });
          return j(respostaDaNuvem.status, respostaDaNuvem.corpo);
        }
        const registro = { metodo: String(req.method), caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), auth: req.headers.authorization, corpo: lido };
        aMeta.push(registro);
        const erro = () => j(400, { error: { message: 'Invalid parameter (o comentário sumiu)', code: 100 } });
        if (req.method === 'POST' && u.pathname.endsWith('/replies')) return falhar.replies ? erro() : j(200, { id: String(17900000000000000 + ++nMeta) });
        if (req.method === 'POST' && u.pathname.endsWith('/messages'))
          return falhar.messages ? erro() : j(200, { recipient_id: IGSID, message_id: `mid-priv-${++nMeta}` });
        if (req.method === 'POST' && u.searchParams.has('hide')) return falhar.hide ? erro() : j(200, { success: true });
        if (req.method === 'GET' && u.pathname.startsWith('/v27.0/'))
          return falhar.midia
            ? erro()
            : j(200, { permalink: 'https://www.instagram.com/p/ABC123/', caption: `Promo de domingo: trio por R$ 39,90! ${'#burger '.repeat(40)}`, media_product_type: 'FEED' });
        return j(404, { error: { message: 'rota desconhecida' } });
      });
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    const env: Record<string, string> = {
      INSTAGRAM_APP_ID: '990602627938098',
      INSTAGRAM_APP_SECRET: 'segredo-do-app',
      INSTAGRAM_GRAPH_URL: base,
      APP_URL: 'https://app.teste',
      CARDAPIO_PUBLIC_URL: 'https://app.teste',
      SEGREDOS_CHAVE: randomBytes(32).toString('base64'),
      BOT_RESOLVER_SECRET: SENHA,
      N8N_ROBO_WEBHOOK_URL: `${base}/n8n`,
      CLOUD_API: `${base}/nuvem`,
      SYNC_TOKEN: 'tok-do-servidor-da-loja',
    };
    for (const [k, v] of Object.entries(env)) {
      antes[k] = process.env[k];
      process.env[k] = v;
    }
    antes.EDGE_MODE = process.env.EDGE_MODE;
    delete process.env.EDGE_MODE;
    const emitir = { emit: (nome: string, dados: any) => (eventos.push({ nome, dados }), true) } as any;
    const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
    svc = new InstagramService(db, emitir, auditoria);
    resposta = new RoboRespostaService(db, {} as any, {} as any, svc);
    const u = {} as any;
    cardapio = new CardapioService(db, u, u, u, u, u, emitir, u, auditoria, undefined, undefined, svc);
    consultas = new RoboConsultasController(cardapio);
    pedidoCtl = new RoboPedidoController(new RoboPedidoService(db, cardapio, {} as any, {} as any));
    clienteSvc = new ClienteService(db, {} as any, auditoria);
    fila = new FilaEAvisosService(db, emitir, auditoria);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste comentários do instagram') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa dos comentários') returning id`);
    const funcao: Record<string, string> = {};
    for (const [t, cat] of [[T, 'gerente'], [T, 'execucao'], [T, 'supervisao'], [T2, 'gerente']] as const)
      [{ id: funcao[`${t}:${cat}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
    for (const [nome, t, cat] of [['ana', T, 'gerente'], ['edu', T, 'execucao'], ['sil', T, 'supervisao'], ['gil', T2, 'gerente']] as const)
      [{ id: pessoa[nome] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [t, nome, funcao[`${t}:${cat}`]]);
    TOK = `tok-coment-${T.slice(0, 8)}`;
    TOK2 = `tok-coment-${T2.slice(0, 8)}`;
    [{ id: CARD }] = await q(
      `insert into cardapio_config (tenant_id, token, ativo, aberto, nome_publico, robo_saudacao, evolution_instancia) values ($1, $2, true, true, 'Burger da Praça', 'Olá!', $3) returning id`,
      [T, TOK, `inst-coment-${T.slice(0, 8)}`],
    );
    await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Outra')`, [T2, TOK2]);
    await q(`insert into robo_config (tenant_id, pausa_minutos) values ($1, 60), ($2, 60) on conflict (tenant_id) do update set pausa_minutos = 60`, [T, T2]);
    await q(
      `insert into instagram_conta (tenant_id, ig_user_id, usuario, nome, token_cifrado, permissoes, cardapio_id, fila_ligada)
       values ($1, $2, 'burgerdapraca', 'Burger da Praça', $3, $4, $5, true),
              ($6, $7, 'outraloja', 'Outra', $3, 'instagram_business_basic,instagram_business_manage_messages', null, true)`,
      [T, CONTA, cifrar(TOKEN_IG), PERMISSOES, CARD, T2, CONTA2],
    );
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const s of soquetes) s.destroy();
    if (servidor) await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const t of [T, T2].filter(Boolean)) await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    n8nStatus = 200;
    Object.assign(falhar, { replies: false, messages: false, hide: false, midia: false });
    respostaDaNuvem = { status: 200, corpo: { itens: [], via: 'nuvem' } };
    aoRobo.length = 0;
    aMeta.length = 0;
    aNuvem.length = 0;
    eventos.length = 0;
    auditados.length = 0;
    await q(`delete from instagram_comentario where tenant_id in ($1, $2)`, [T, T2]);
    await q(`delete from instagram_mensagem where tenant_id in ($1, $2)`, [T, T2]);
    await q(`delete from atendimento_chamado where tenant_id in ($1, $2)`, [T, T2]);
    await q(`update robo_config set equipe_atende = 'sempre', atendente_perfis = '{}'::jsonb where tenant_id = $1`, [T]);
    await q(`update cardapio_config set horarios = '[]'::jsonb where id = $1`, [CARD]);
    await ligar();
  });

  it('a 384 de novo: idempotente, e a conferência no mesmo Run vem toda ok', async () => {
    const r: any = await aplicar('384_comentarios_do_instagram.sql');
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    expect(conferencia.length).toBe(7);
    expect(conferencia.filter((l: any) => l.ok !== true)).toEqual([]);
  });

  it('o aviso grava o comentário (id pela chave — V42) e lê o post UMA vez; o aviso repetido não duplica nem entrega de novo', async () => {
    const erros = jest.spyOn(Logger.prototype, 'error');
    try {
      const c1 = cid();
      await comentar({ id: c1, texto: 'Que delícia! Vocês abrem domingo?' });
      const l = await linha(c1);
      expect(l).toMatchObject({
        id: uuidDeChave('instagram-comentario', T, c1),
        ig_user_id: CONTA,
        pai_id: null,
        midia_id: MIDIA,
        midia_tipo: 'FEED',
        midia_link: 'https://www.instagram.com/p/ABC123/',
        autor_id: '555000111',
        autor_usuario: 'joana.souza',
        texto: 'Que delícia! Vocês abrem domingo?',
        resposta_id: null,
        escondido: false,
      });
      expect(l.midia_legenda).toMatch(/^Promo de domingo/);
      expect(doMeta('midia')).toHaveLength(1);
      expect(doMeta('midia')[0]).toMatchObject({ caminho: `/v27.0/${MIDIA}`, auth: `Bearer ${TOKEN_IG}` });
      expect(doMeta('midia')[0].consulta.fields).toBe('permalink,caption,media_product_type,thumbnail_url,media_url');
      expect(aoRobo).toHaveLength(1);
      expect(eventos.some((e) => e.nome === 'instagram.comentario' && e.dados.id === l.id && e.dados.motivo === 'novo')).toBe(true);
      // o mesmo aviso de novo (a Meta reentrega): nada — nem linha, nem post, nem robô, nem erro no log
      await comentar({ id: c1, texto: 'Que delícia! Vocês abrem domingo?' });
      expect(await q(`select id from instagram_comentario where tenant_id = $1`, [T])).toHaveLength(1);
      expect(doMeta('midia')).toHaveLength(1);
      expect(aoRobo).toHaveLength(1);
      expect(erros).not.toHaveBeenCalled();
      // outro comentário no MESMO post: o post já lido não é pedido de novo
      const c2 = cid();
      await comentar({ id: c2, texto: 'Tem opção vegetariana?' });
      expect((await linha(c2)).midia_link).toBe('https://www.instagram.com/p/ABC123/');
      expect(doMeta('midia')).toHaveLength(1);
    } finally {
      erros.mockRestore();
    }
  });

  it('o post que a Meta não devolve fica nulo e não derruba nada (o robô recebe sem a legenda)', async () => {
    falhar.midia = true;
    const c = cid();
    await comentar({ id: c, midia: '18000000000000999' });
    expect(await linha(c)).toMatchObject({ midia_link: null, midia_legenda: null });
    expect(aoRobo).toHaveLength(1);
    expect(aoRobo[0].corpo.comentario).toEqual({ midiaTipo: 'FEED', legenda: null });
  });

  it('fica de fora: o comentário da PRÓPRIA loja, o live_comments, a conta sem a permissão (de antes da F6) e a empresa apagada', async () => {
    const daLoja = cid();
    await comentar({ id: daLoja, autorId: CONTA, texto: 'Obrigado!' });
    expect(await linha(daLoja)).toBeUndefined();
    // o @ da conta conectada também é a loja (o id do autor pode vir em outra forma)
    const pelo = cid();
    await comentar({ id: pelo, autorId: '7777777', usuario: 'BurgerDaPraca', texto: 'Valeu!' });
    expect(await linha(pelo)).toBeUndefined();
    const aoVivo = cid();
    await comentar({ id: aoVivo, field: 'live_comments' });
    expect(await linha(aoVivo)).toBeUndefined();
    const semPermissao = cid();
    await comentar({ id: semPermissao, conta: CONTA2 });
    expect(await linha(semPermissao, T2)).toBeUndefined();
    await q(`update empresa set deleted_at = now() where id = $1`, [T]);
    try {
      const apagada = cid();
      await comentar({ id: apagada });
      expect(await linha(apagada)).toBeUndefined();
    } finally {
      await q(`update empresa set deleted_at = null where id = $1`, [T]);
    }
    expect(aoRobo).toHaveLength(0);
    expect(doMeta('midia')).toHaveLength(0);
  });

  it('o robô desligado grava sem entregar (sem marca); o emoji e a marcação de amigos não vão ao robô', async () => {
    await ligar({ robo: false });
    const c1 = cid();
    await comentar({ id: c1, texto: 'Abre domingo?' });
    expect((await linha(c1)).robo_entregue_em).toBeNull();
    expect(aoRobo).toHaveLength(0);
    await ligar({ robo: true });
    const c2 = cid();
    await comentar({ id: c2, texto: '😍😍🔥' });
    const c3 = cid();
    await comentar({ id: c3, texto: '@amigo @amiga' });
    expect((await linha(c2)).robo_entregue_em).toBeNull();
    expect((await linha(c3)).robo_entregue_em).toBeNull();
    expect(aoRobo).toHaveLength(0);
    // o robô sem o fluxo do n8n (a distribuição) também não recebe
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    const c4 = cid();
    await comentar({ id: c4, texto: 'Abre domingo?' });
    expect((await linha(c4)).robo_entregue_em).toBeNull();
  });

  it('a entrega ao robô: a chave cm: do comentário de CIMA, o comentário que ele responde, o post, a senha no cabeçalho e a marca', async () => {
    const pai = cid();
    await comentar({ id: pai, texto: 'Vocês entregam no Méier?' });
    const filho = cid();
    await comentar({ id: filho, pai, texto: 'E qual a taxa?', usuario: 'carlos.m' });
    expect(aoRobo).toHaveLength(2);
    expect(aoRobo.every((x) => x.segredo === SENHA)).toBe(true);
    expect(aoRobo[0].corpo).toMatchObject({ instancia: `cm:${pai}`, de: `cm:${pai}`, mensagemId: pai });
    expect(aoRobo[1].corpo).toEqual({
      provedor: 'instagram',
      tenantId: T,
      cardapioToken: TOK,
      phoneNumberId: null,
      instancia: `cm:${pai}`,
      jid: null,
      loja: { nome: 'Burger da Praça', aberto: true },
      de: `cm:${pai}`,
      nome: 'carlos.m',
      tipo: 'text',
      texto: 'E qual a taxa?',
      mensagemId: filho,
      timestamp: expect.any(Number),
      midiaId: null,
      opcaoId: null,
      roboSaudacao: 'Olá!',
      roboAusencia: null,
      roboPrompt: null,
      roboMensagens: [],
      conversa: null,
      comentario: { midiaTipo: 'FEED', legenda: expect.stringMatching(/^Promo de domingo: trio por R\$ 39,90!/) },
    });
    expect(Array.from(aoRobo[1].corpo.comentario.legenda).length).toBe(200);
    expect((await linha(filho)).robo_entregue_em).not.toBeNull();
    expect((await linha(filho)).pai_id).toBe(pai);
  });

  it('a entrega que o robô não recebe apaga a marca (fica "sem resposta", sem caso)', async () => {
    n8nStatus = 500;
    const c = cid();
    await comentar({ id: c, texto: 'Abre domingo?' });
    expect(aoRobo).toHaveLength(1);
    expect((await linha(c)).robo_entregue_em).toBeNull();
    expect(await casosDoComentario()).toHaveLength(0);
  });

  it(`o limite: ${LIMITE_DO_ROBO_POR_HORA} entregas ao robô por hora por conta — o seguinte fica sem resposta, sem caso`, async () => {
    const ids = Array.from({ length: LIMITE_DO_ROBO_POR_HORA }, () => cid());
    await q(
      `insert into instagram_comentario (id, tenant_id, ig_user_id, comentario_id, midia_id, texto, comentado_em, robo_entregue_em)
       select gen_random_uuid(), $1, $2, x, $3, 'oi', now(), now() - interval '10 minutes' from unnest($4::text[]) x`,
      [T, CONTA, MIDIA, ids],
    );
    const c = cid();
    await comentar({ id: c, texto: 'Abre domingo?' });
    expect((await linha(c)).robo_entregue_em).toBeNull();
    expect(aoRobo).toHaveLength(0);
    // as de mais de 1 hora não contam (nem as respondidas há mais de 1 hora)
    await q(`update instagram_comentario set robo_entregue_em = now() - interval '61 minutes' where tenant_id = $1 and comentario_id = $2`, [T, ids[0]]);
    const c2 = cid();
    await comentar({ id: c2, texto: 'E segunda?' });
    expect(aoRobo).toHaveLength(1);
    // a resposta do robô na última hora conta como entrega (mesmo sem a marca)
    await q(`update instagram_comentario set resposta_por = 'robo', respondido_em = now(), resposta_id = '1' where tenant_id = $1 and comentario_id = $2`, [T, ids[0]]);
    const c3 = cid();
    await comentar({ id: c3, texto: 'E terça?' });
    expect(aoRobo).toHaveLength(1);
  });

  it('a resposta do robô PUBLICA no post: o corpo que sai para a Meta (V20), UMA por comentário, e a marca sai', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Vocês abrem domingo?' });
    const r = await responder(`cm:${c}`, 'Abrimos sim!\nDomingo das 18h às 23h. 😉', { opcoes: [{ titulo: 'Ver cardápio' }] });
    expect(r).toEqual({ ok: true, enviado: true, enviados: ['texto'] });
    expect(doMeta('replies')).toEqual([
      { metodo: 'POST', caminho: `/v27.0/${c}/replies`, consulta: {}, auth: `Bearer ${TOKEN_IG}`, corpo: { message: 'Abrimos sim! Domingo das 18h às 23h. 😉' } },
    ]);
    const l = await linha(c);
    expect(l).toMatchObject({ resposta_por: 'robo', resposta_texto: 'Abrimos sim! Domingo das 18h às 23h. 😉', robo_entregue_em: null, respondido_por: null, erro: null });
    expect(l.resposta_id).toMatch(/^179/);
    // o robô de novo: a marca saiu — nada a responder
    expect(await responder(`cm:${c}`, 'Te esperamos!')).toEqual({ ok: true, enviado: false, motivo: 'nada_a_responder' });
    // marcado de novo (o n8n mandou duas vezes): já tem a resposta da loja — nada sai
    await q(`update instagram_comentario set robo_entregue_em = now() where id = $1`, [l.id]);
    expect(await responder(`cm:${c}`, 'Te esperamos!')).toEqual({ ok: true, enviado: false, motivo: 'ja_respondido' });
    expect(doMeta('replies')).toHaveLength(1);
  });

  it('a resposta do robô na conversa responde o comentário MAIS NOVO entregue a ele (a resposta de alguém no fio)', async () => {
    const pai = cid();
    await comentar({ id: pai, texto: 'Tem trio?' });
    expect(await responder(`cm:${pai}`, 'Temos! O trio sai por R$ 39,90.')).toMatchObject({ enviado: true });
    const filho = cid();
    await comentar({ id: filho, pai, texto: 'E com bacon?' });
    expect(aoRobo[1].corpo.instancia).toBe(`cm:${pai}`);
    expect(await responder(`cm:${pai}`, 'Tem sim, o X-Bacon.')).toMatchObject({ enviado: true });
    expect(doMeta('replies').map((m) => m.caminho)).toEqual([`/v27.0/${pai}/replies`, `/v27.0/${filho}/replies`]);
  });

  it('a trava: link, telefone/WhatsApp e "SEM RESPOSTA" não publicam — o motivo fica em erro e o comentário fica sem resposta', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Como peço?' });
    expect(await responder(`cm:${c}`, 'Peça em https://app.teste/c/abc')).toEqual({ ok: true, enviado: false, motivo: 'barrada_link' });
    expect((await linha(c)).erro).toBe(NOME_DO_MOTIVO_DO_COMENTARIO.link);
    expect(await responder(`cm:${c}`, 'Chama no zap (21) 99999-8888')).toEqual({ ok: true, enviado: false, motivo: 'barrada_contato' });
    expect((await linha(c)).erro).toBe(NOME_DO_MOTIVO_DO_COMENTARIO.contato);
    expect(await responder(`cm:${c}`, 'SEM RESPOSTA')).toEqual({ ok: true, enviado: false, motivo: 'robo_nao_respondeu' });
    expect((await linha(c)).erro).toBe(NOME_DO_MOTIVO_DO_COMENTARIO.silencio);
    expect(doMeta('replies')).toHaveLength(0);
    expect(await linha(c)).toMatchObject({ resposta_id: null, resposta_por: null });
    // só opções (o comentário não tem menu) e só voz: nada a publicar
    expect(await responder(`cm:${c}`, '', { opcoes: [{ titulo: 'Sim' }] })).toEqual({ ok: true, enviado: false, motivo: 'sem_texto' });
    expect(await responder(`cm:${c}`, '', { audio: { base64: 'AAAA' } })).toEqual({ ok: true, enviado: false, motivo: 'sem_voz_no_comentario' });
    // depois de tudo, uma resposta limpa sai e o erro some
    expect(await responder(`cm:${c}`, 'Pelo Direct a gente te manda o link do cardápio!')).toMatchObject({ enviado: true });
    expect((await linha(c)).erro).toBeNull();
  });

  it('a resposta do robô: a Meta recusa → 502 com o código (a reserva sai, o motivo fica); chaves de conversas diferentes, desconhecida e o robô desligado', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Abre hoje?' });
    falhar.replies = true;
    const e: any = await responder(`cm:${c}`, 'Abrimos às 18h!').catch((x) => x);
    expect(e).toBeInstanceOf(BadGatewayException);
    expect(e.getResponse()).toMatchObject({ statusCode: 502, code: 'META_COMENTARIO_INDISPONIVEL' });
    expect(JSON.stringify(e.getResponse())).not.toContain(TOKEN_IG);
    expect(await linha(c)).toMatchObject({ resposta_por: null, resposta_texto: null, resposta_id: null, erro: 'O Instagram recusou: o comentário pode ter sido apagado ou escondido.' });
    falhar.replies = false;
    await expect(resposta.responder(SENHA, { instancia: `cm:${c}`, para: 'cm:1786999999999999', texto: 'x' } as any)).rejects.toThrow(BadRequestException);
    await expect(responder('cm:1786999999999998', 'x')).rejects.toThrow(NotFoundException);
    await ligar({ robo: false });
    expect(await responder(`cm:${c}`, 'Abrimos às 18h!')).toEqual({ ok: true, enviado: false, motivo: 'robo_desligado' });
    await expect(resposta.responder('senha-errada', { instancia: `cm:${c}`, para: `cm:${c}`, texto: 'x' } as any)).rejects.toThrow(UnauthorizedException);
    expect(doMeta('replies')).toHaveLength(1);
  });

  it('chamar atendente com cm:: o caso instagram_comentario (id pela chave), a resposta PRIVADA (o corpo à Meta) e a linha do Direct', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Meu pedido de ontem veio frio!!', usuario: 'joana.souza' });
    const r: any = await chamar(`cm:${c}`, { urgente: true, paraOCliente: 'Oi, Joana! Vimos seu comentário. Me conta aqui o que aconteceu que a equipe já vai ver.' });
    const casoId = uuidDeChave('instagram-comentario-caso', T, c);
    expect(r).toMatchObject({ ok: true, id: casoId, prioridade: 'urgente', privada: { enviada: true } });
    expect(typeof r.comAlguem).toBe('boolean');
    const [caso] = await casosDoComentario();
    const l = await linha(c);
    expect(caso).toMatchObject({ id: casoId, tipo: 'instagram_comentario', canal: 'instagram', cliente: '@joana.souza', prioridade: 'urgente', status: 'aberto', unidade_id: null });
    expect(caso.detalhe).toMatchObject({
      plataforma: 'instagram',
      comentario: { id: l.id, comentarioId: c, midiaId: MIDIA, midiaLink: 'https://www.instagram.com/p/ABC123/', autorUsuario: 'joana.souza', texto: 'Meu pedido de ontem veio frio!!', conversa: c },
      robo: { motivo: 'pedido veio frio' },
    });
    expect(eventos.some((e) => e.nome === 'atendimento.novo' && e.dados.chamado.id === casoId)).toBe(true);
    expect(doMeta('messages')).toEqual([
      {
        metodo: 'POST',
        caminho: `/v27.0/${CONTA}/messages`,
        consulta: {},
        auth: `Bearer ${TOKEN_IG}`,
        corpo: { recipient: { comment_id: c }, message: { text: 'Oi, Joana! Vimos seu comentário. Me conta aqui o que aconteceu que a equipe já vai ver.' } },
      },
    ]);
    expect(l).toMatchObject({ chamado_id: casoId, privada_igsid: IGSID, privada_texto: 'Oi, Joana! Vimos seu comentário. Me conta aqui o que aconteceu que a equipe já vai ver.', privada_por: null });
    const [msg] = await q(`select * from instagram_mensagem where tenant_id = $1 and igsid = $2`, [T, IGSID]);
    expect(msg).toMatchObject({ ig_user_id: CONTA, direcao: 'saida', autor: 'robo', estado: 'enviada', chamado_id: null });
    expect(msg.mid).toMatch(/^mid-priv-/);
    // o eco da privada (a Meta avisa a mensagem da loja) não entra de novo nem vira "a loja respondeu"
    await svc.processar({
      object: 'instagram',
      entry: [{ id: CONTA, time: Date.now(), messaging: [{ sender: { id: CONTA }, recipient: { id: IGSID }, timestamp: Date.now(), message: { mid: msg.mid, text: msg.texto, is_echo: true } }] }],
    });
    expect(await q(`select autor from instagram_mensagem where tenant_id = $1 and igsid = $2`, [T, IGSID])).toEqual([{ autor: 'robo' }]);
    // chamar de novo: soma ao MESMO caso e a privada não sai de novo (uma só por comentário)
    const r2: any = await chamar(`cm:${c}`, { mensagem: 'Motivo: de novo' });
    expect(r2).toMatchObject({ id: casoId, privada: { enviada: false, motivo: 'ja_respondido_no_direct' } });
    expect(await casosDoComentario()).toHaveLength(1);
    expect(doMeta('messages')).toHaveLength(1);
    // a pessoa responde no Direct: a conversa do Direct segue (a privada está nela)
    await svc.processar({
      object: 'instagram',
      entry: [{ id: CONTA, time: Date.now(), messaging: [{ sender: { id: IGSID }, recipient: { id: CONTA }, timestamp: Date.now(), message: { mid: 'resp-da-joana', text: 'Veio frio sim, o trio 07' } }] }],
    });
    const [doDirect] = await q(`select id from atendimento_chamado where tenant_id = $1 and tipo = 'instagram' and detalhe #>> '{instagram,igsid}' = $2`, [T, IGSID]);
    expect(doDirect).toBeDefined();
    // o perfil do cliente é lido da Meta em segundo plano (o Direct): espera terminar, para não vazar para o teste seguinte
    expect(await esperar(async () => (await q(`select 1 from instagram_contato where tenant_id = $1 and igsid = $2`, [T, IGSID])).length > 0)).toBe(true);
    const conversa: any = await svc.conversa(T, doDirect.id);
    expect(conversa.mensagens.map((m: any) => m.autor)).toEqual(['robo', 'cliente']);
    expect(conversa.janela.aberta).toBe(true);
  });

  it('chamar atendente: mais de 7 dias = sem privada; fila dos comentários desligada = só a privada; sem a senha ou de outra empresa = 401', async () => {
    const velho = cid();
    await comentar({ id: velho, texto: 'O pedido de semana passada veio errado', em: Date.now() - 8 * 86_400_000 });
    const r: any = await chamar(`cm:${velho}`);
    expect(r).toMatchObject({ ok: true, privada: { enviada: false, motivo: 'prazo_vencido' } });
    expect(r.id).toBe(uuidDeChave('instagram-comentario-caso', T, velho)); // o caso nasce mesmo assim
    expect(doMeta('messages')).toHaveLength(0);
    await ligar({ fila: false });
    const novo = cid();
    await comentar({ id: novo, texto: 'Faltou a batata!' });
    const r2: any = await chamar(`cm:${novo}`);
    expect(r2).toEqual({ ok: true, id: null, prioridade: null, posicao: null, comAlguem: false, privada: { enviada: true } });
    expect((await casosDoComentario()).map((x: any) => x.id)).toEqual([r.id]);
    expect(doMeta('messages')).toHaveLength(1);
    expect(doMeta('messages')[0].corpo.message.text).toBe('Oi, @joana.souza! Vimos o seu comentário e a nossa equipe vai continuar o atendimento por aqui, no Direct.');
    await expect(chamar(`cm:${novo}`, {}, 'senha-errada')).rejects.toThrow(UnauthorizedException);
    await expect(chamar(`cm:${novo}`, {}, SENHA, TOK2)).rejects.toThrow(UnauthorizedException);
    await expect(chamar('cm:1786999999999997')).rejects.toThrow(UnauthorizedException);
    // a privada que a Meta recusa: a reserva sai (pode tentar de novo) e o motivo fica
    const outro = cid();
    await comentar({ id: outro, texto: 'Cadê meu pedido?' });
    falhar.messages = true;
    const r3: any = await chamar(`cm:${outro}`);
    expect(r3.privada).toEqual({ enviada: false, motivo: 'meta_recusou' });
    expect(await linha(outro)).toMatchObject({ privada_em: null, privada_igsid: null, erro: 'O Instagram recusou: o comentário pode ter sido apagado ou escondido.' });
  });

  // ───── HORÁRIO DA EQUIPE (F1, mig 379): fora do horário, o caso nasce RECADO e a privada leva quando a equipe volta ─────
  const FUSO = 'America/Sao_Paulo';
  const daqui3 = new Date(Date.now() + 3 * 86_400_000);
  const semanaSp = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(daqui3));
  const VOLTA = new Date(`${daqui3.toLocaleDateString('en-CA', { timeZone: FUSO })}T09:30:00-03:00`);
  it('fora do horário da equipe: o caso é RECADO e a privada é a frase de quando a equipe volta (sem a posição)', async () => {
    await q(`update robo_config set equipe_atende = 'loja' where tenant_id = $1`, [T]);
    await q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [CARD, JSON.stringify([{ dia: semanaSp, ativo: true, abre: '10:00', fecha: '11:00' }])]);
    const c = cid();
    await comentar({ id: c, texto: 'Pedido veio errado' });
    const r: any = await chamar(`cm:${c}`, { paraOCliente: 'isto não vai: fora do horário vale o recado' });
    expect(r).toMatchObject({ ok: true, foraDoHorario: true, posicao: null, comAlguem: false, privada: { enviada: true } });
    const [caso] = await casosDoComentario();
    expect(caso.detalhe.recado.ate).toBe(VOLTA.toISOString());
    expect(doMeta('messages')[0].corpo.message.text).toBe(r.paraOCliente);
    expect(r.paraOCliente).toMatch(/^Nossa equipe volta (na|no) .+ às 09:30\./);
  });

  it('as consultas do robô com cm:: o cardápio da conta (com o robô ligado) e as instruções dos comentários com o perfil do canal', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Abre domingo?' });
    const loja: any = await consultas.loja(`cm:${c}`, '', undefined, SENHA);
    expect(loja).toBeTruthy();
    await q(`update robo_config set atendente_perfis = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ comentarios: { perfil: 'cordial' } })]);
    const r: any = await consultas.instrucoes('1', `cm:${c}`, '', undefined, SENHA);
    expect(r).toMatchObject({ versao: VERSAO_DOS_COMENTARIOS, canal: 'comentarios', fluxo: 1 });
    expect(r.texto).toContain('O COMENTÁRIO É PÚBLICO');
    expect(r.texto).toContain(TEXTO_DO_PERFIL.cordial);
    expect(r.texto).not.toContain('ASSUNTOS QUE NÃO SÃO PEDIDO');
    await ligar({ robo: false });
    await expect(consultas.loja(`cm:${c}`, '', undefined, SENHA)).rejects.toThrow(NotFoundException);
    await expect(consultas.loja('cm:1786999999999996', '', undefined, SENHA)).rejects.toThrow(NotFoundException);
  });

  it('as ferramentas que recusam cm: (pedido, pedidos, situação, resolver, link do cliente, WhatsApp oficial) — nunca pelos dígitos do id', async () => {
    const c = cid();
    await comentar({ id: c, texto: 'Cadê meu pedido?' });
    expect(await pedidoCtl.ver({ instancia: `cm:${c}` }, SENHA)).toEqual(RESPOSTA_DO_PEDIDO_NO_COMENTARIO);
    expect(RESPOSTA_DO_PEDIDO_NO_COMENTARIO.motivo).toBe('comentario_do_instagram');
    await expect(pedidoCtl.ver({ instancia: `cm:${c}` }, 'senha-errada')).rejects.toThrow(UnauthorizedException);
    await expect(pedidoCtl.ver({ instancia: 'cm:1786999999999995' }, SENHA)).rejects.toThrow(NotFoundException);
    // um pedido cujo telefone termina como o id do comentário: a chave cm: nunca casa pelos últimos dígitos
    const falso = '5521999998888';
    await q(
      `insert into pedido_externo (tenant_id, canal, external_id, numero, status, cliente_nome, cliente_telefone, total) values ($1, 'cardapio', 'ext-cm-1', 4242, 'novo', 'Desconhecido', '21999998888', 30)`,
      [T],
    );
    try {
      const wa = new WhatsappService(db);
      const inst = `inst-coment-${T.slice(0, 8)}`;
      expect(await wa.pedidosPorTelefoneBot(inst, SENHA, `cm:${falso}`)).toEqual([]);
      expect(await wa.pedidosPorTelefoneBot(`cm:${c}`, SENHA, `cm:${c}`)).toEqual([]);
      expect((await wa.pedidosPorTelefoneBot(inst, SENHA, '5521999998888')).length).toBe(1); // controle: o telefone de verdade acha
      expect(await wa.statusPedidoBot(inst, SENHA, `cm:${falso}`, '4242')).toMatchObject({ encontrado: false });
      await expect(wa.resolver(`cm:${c}`, SENHA)).rejects.toThrow(NotFoundException);
    } finally {
      await q(`delete from pedido_externo where tenant_id = $1 and external_id = 'ext-cm-1'`, [T]);
    }
    await expect(clienteSvc.criarLink(TOK, { telefone: `cm:${c}` }, SENHA)).rejects.toThrow(BadRequestException);
    const cloud = new WhatsappCloudService(db);
    await expect(cloud.enviarPeloBot(SENHA, 'pid-1', `cm:${c}`, 'oi')).rejects.toThrow(RECUSA_NO_COMENTARIO);
    await expect(cloud.enviarTemplatePeloBot(SENHA, 'pid-1', `cm:${c}`, 'modelo', 'pt_BR', [])).rejects.toThrow(RECUSA_NO_COMENTARIO);
  });

  // ───────────────────────── a TELA (a gestão) ─────────────────────────

  it('a lista: os últimos 30 dias, o filtro e a contagem no where, 50 por página com o cursor', async () => {
    await ligar({ robo: false });
    const ids = Array.from({ length: 55 }, () => cid());
    // 55 sem resposta (um por minuto para trás), 3 respondidos, 2 escondidos, 1 só com a privada, 1 de 31 dias atrás
    await q(
      `insert into instagram_comentario (id, tenant_id, ig_user_id, comentario_id, midia_id, texto, comentado_em)
       select gen_random_uuid(), $1, $2, x, $3, 'oi ' || o, now() - make_interval(mins => o::int) from unnest($4::text[]) with ordinality as t(x, o)`,
      [T, CONTA, MIDIA, ids],
    );
    const extra = async (sufixo: string, set: string, quando = "now() - interval '2 hours'") => {
      const id = cid();
      await q(
        `insert into instagram_comentario (id, tenant_id, ig_user_id, comentario_id, midia_id, texto, comentado_em) values (gen_random_uuid(), $1, $2, $3, $4, $5, ${quando})`,
        [T, CONTA, id, MIDIA, sufixo],
      );
      if (set) await q(`update instagram_comentario set ${set} where tenant_id = $1 and comentario_id = $2`, [T, id]);
      return id;
    };
    for (let i = 0; i < 3; i++) await extra('respondido', `resposta_id = '9${i}', resposta_por = 'equipe', resposta_texto = 'valeu', respondido_em = now()`);
    for (let i = 0; i < 2; i++) await extra('escondido', `escondido = true, escondido_em = now()`);
    await extra('privada', `privada_igsid = '${IGSID}', privada_texto = 'oi', privada_em = now()`);
    await extra('velho', '', "now() - interval '31 days'");
    // a reserva em andamento (a Meta ainda não confirmou) ainda é "sem resposta"
    await q(`update instagram_comentario set resposta_por = 'equipe', resposta_texto = 'x', respondido_em = now() where tenant_id = $1 and comentario_id = $2`, [T, ids[0]]);
    const g = user('gerente');
    const p1: any = await svc.comentarios.listarPara(g, {});
    expect(p1.contagem).toEqual({ semResposta: 55, respondidos: 4, escondidos: 2, todos: 61 });
    expect(p1.itens).toHaveLength(50);
    expect(p1.itens[0]).toMatchObject({ comentarioId: ids[0], resposta: null, privada: null, escondido: false, podePrivada: true, casoId: null });
    expect(p1.itens[0].midia).toEqual({ id: MIDIA, tipo: null, link: null, legenda: null });
    expect(p1.permitido).toBe(true);
    expect(p1.proximo).toBe(cursorDe(p1.itens[49]));
    const p2: any = await svc.comentarios.listarPara(g, { antes: p1.proximo });
    expect(p2.itens.map((x: any) => x.comentarioId)).toEqual(ids.slice(50));
    expect(p2.proximo).toBeNull();
    const resp: any = await svc.comentarios.listarPara(g, { filtro: 'respondidos' });
    expect(resp.itens).toHaveLength(4);
    expect(resp.itens.filter((x: any) => x.resposta).every((x: any) => x.resposta.por === 'equipe' && x.resposta.texto === 'valeu')).toBe(true);
    expect(resp.itens.filter((x: any) => x.privada)).toHaveLength(1);
    expect(resp.itens.find((x: any) => x.privada).podePrivada).toBe(false);
    expect((await svc.comentarios.listarPara(g, { filtro: 'escondidos' })).itens.every((x: any) => x.escondido)).toBe(true);
    expect((await svc.comentarios.listarPara(g, { filtro: 'todos' })).itens).toHaveLength(50);
    expect((await svc.comentarios.listarPara(g, { filtro: 'todos', antes: 'lixo' })).itens).toHaveLength(50);
    // a conta sem a permissão: a privada não se oferece
    await ligar({ robo: false, permissoes: 'instagram_business_basic' });
    const semPerm: any = await svc.comentarios.listarPara(g, {});
    expect(semPerm.permitido).toBe(false);
    expect(semPerm.itens.some((x: any) => x.podePrivada)).toBe(false);
  });

  it('responder pela equipe: o corpo à Meta, a auditoria; uma resposta da loja por comentário (409 JA_RESPONDIDO, também depois do robô)', async () => {
    await ligar({ robo: false });
    const c = cid();
    await comentar({ id: c, texto: 'Que lindo esse lanche!' });
    const { id } = await linha(c);
    const r: any = await svc.comentarios.agirPara(user('gerente'), 'responder', id, { texto: '  Obrigado, Joana! 🧡 ' });
    expect(r).toMatchObject({ id, resposta: { texto: 'Obrigado, Joana! 🧡', por: 'equipe' } });
    expect(doMeta('replies')).toEqual([{ metodo: 'POST', caminho: `/v27.0/${c}/replies`, consulta: {}, auth: `Bearer ${TOKEN_IG}`, corpo: { message: 'Obrigado, Joana! 🧡' } }]);
    expect(await linha(c)).toMatchObject({ resposta_por: 'equipe', respondido_por: pessoa.ana });
    expect(auditados).toEqual([expect.objectContaining({ acao: 'instagram_comentario_respondido', entidadeTipo: 'instagram_comentario', entidadeId: id, atorId: pessoa.ana })]);
    const e: any = await svc.comentarios.agirPara(user('gerente'), 'responder', id, { texto: 'De novo' }).catch((x) => x);
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ code: 'JA_RESPONDIDO' });
    // o comentário que o robô respondeu: a equipe não responde por cima
    await ligar({ robo: true });
    const c2 = cid();
    await comentar({ id: c2, texto: 'Abre domingo?' });
    await responder(`cm:${c2}`, 'Abrimos às 18h!');
    const e2: any = await svc.comentarios.agirPara(user('gerente'), 'responder', (await linha(c2)).id, { texto: 'Isso!' }).catch((x) => x);
    expect(e2.getResponse()).toMatchObject({ code: 'JA_RESPONDIDO' });
    // texto vazio e longo: 400
    await expect(svc.comentarios.agirPara(user('gerente'), 'responder', id, { texto: '  ' })).rejects.toThrow(BadRequestException);
    await expect(svc.comentarios.agirPara(user('gerente'), 'responder', id, { texto: 'x'.repeat(1001) })).rejects.toThrow(BadRequestException);
    // a Meta recusa: 502 com o código, a reserva sai (pode tentar de novo)
    const c3 = cid();
    await comentar({ id: c3, texto: 'Oi' });
    falhar.replies = true;
    const e3: any = await svc.comentarios.agirPara(user('gerente'), 'responder', (await linha(c3)).id, { texto: 'Oi!' }).catch((x) => x);
    expect(e3).toBeInstanceOf(BadGatewayException);
    expect(e3.getResponse()).toMatchObject({ code: 'META_COMENTARIO_INDISPONIVEL' });
    expect(await linha(c3)).toMatchObject({ resposta_por: null, resposta_id: null });
  });

  it('a privada pela equipe: o corpo à Meta, a linha do Direct (autor equipe); 409 JA_RESPONDIDO_NO_DIRECT e PRAZO_VENCIDO', async () => {
    await ligar({ robo: false });
    const c = cid();
    await comentar({ id: c, texto: 'Quero fazer uma encomenda' });
    const { id } = await linha(c);
    const r: any = await svc.comentarios.agirPara(user('gerente'), 'privada', id, { texto: 'Oi! Me conta aqui a encomenda.' });
    expect(r).toMatchObject({ id, privada: { texto: 'Oi! Me conta aqui a encomenda.' }, podePrivada: false });
    expect(doMeta('messages')[0].corpo).toEqual({ recipient: { comment_id: c }, message: { text: 'Oi! Me conta aqui a encomenda.' } });
    expect((await q(`select autor, autor_id from instagram_mensagem where tenant_id = $1 and igsid = $2`, [T, IGSID]))[0]).toEqual({ autor: 'equipe', autor_id: pessoa.ana });
    expect(await linha(c)).toMatchObject({ privada_por: pessoa.ana, privada_igsid: IGSID });
    expect(auditados.map((a) => a.acao)).toEqual(['instagram_comentario_privada']);
    const e: any = await svc.comentarios.agirPara(user('gerente'), 'privada', id, { texto: 'De novo' }).catch((x) => x);
    expect(e.getResponse()).toMatchObject({ statusCode: 409, code: 'JA_RESPONDIDO_NO_DIRECT' });
    const velho = cid();
    await comentar({ id: velho, texto: 'oi', em: Date.now() - 8 * 86_400_000 });
    const e2: any = await svc.comentarios.agirPara(user('gerente'), 'privada', (await linha(velho)).id, { texto: 'Oi!' }).catch((x) => x);
    expect(e2.getResponse()).toMatchObject({ statusCode: 409, code: 'PRAZO_VENCIDO' });
    // até 1.000 bytes (a regra do Direct)
    await expect(svc.comentarios.agirPara(user('gerente'), 'privada', (await linha(velho)).id, { texto: 'é'.repeat(501) })).rejects.toThrow(BadRequestException);
    expect(doMeta('messages')).toHaveLength(1);
  });

  it('esconder e mostrar: o hide que sai para a Meta, no estado pedido não chama de novo; o comentário da loja não se esconde; escondido não recebe resposta', async () => {
    await ligar({ robo: false });
    const c = cid();
    await comentar({ id: c, texto: 'Comprem na loja X, é melhor' });
    const { id } = await linha(c);
    const r: any = await svc.comentarios.agirPara(user('gerente'), 'esconder', id, { esconder: true });
    expect(r).toMatchObject({ id, escondido: true });
    expect(doMeta('hide')).toEqual([{ metodo: 'POST', caminho: `/v27.0/${c}`, consulta: { hide: 'true' }, auth: `Bearer ${TOKEN_IG}`, corpo: null }]);
    expect(await linha(c)).toMatchObject({ escondido: true, escondido_por: pessoa.ana });
    await svc.comentarios.agirPara(user('gerente'), 'esconder', id, { esconder: 'true' });
    expect(doMeta('hide')).toHaveLength(1); // já escondido: nada muda
    const e: any = await svc.comentarios.agirPara(user('gerente'), 'responder', id, { texto: 'Oi' }).catch((x) => x);
    expect(e.getResponse()).toMatchObject({ code: 'COMENTARIO_ESCONDIDO' });
    await svc.comentarios.agirPara(user('gerente'), 'esconder', id, { esconder: false });
    expect(doMeta('hide')[1].consulta).toEqual({ hide: 'false' });
    expect(await linha(c)).toMatchObject({ escondido: false, escondido_por: null, escondido_em: null });
    expect(auditados.map((a) => [a.acao, a.detalhe.esconder])).toEqual([
      ['instagram_comentario_escondido', true],
      ['instagram_comentario_escondido', false],
    ]);
    await expect(svc.comentarios.agirPara(user('gerente'), 'esconder', id, { esconder: 'sim' })).rejects.toThrow(BadRequestException);
    // o comentário da própria loja (gravado à mão: o aviso não grava) não se esconde
    const daLoja = cid();
    await q(
      `insert into instagram_comentario (id, tenant_id, ig_user_id, comentario_id, midia_id, autor_id, texto, comentado_em) values (gen_random_uuid(), $1, $2, $3, $4, $2, 'nosso', now())`,
      [T, CONTA, daLoja, MIDIA],
    );
    const e2: any = await svc.comentarios.agirPara(user('gerente'), 'esconder', (await linha(daLoja)).id, { esconder: true }).catch((x) => x);
    expect(e2.getResponse()).toMatchObject({ code: 'COMENTARIO_DA_LOJA' });
    // comentário de outra empresa: 404
    await expect(svc.comentarios.agirPara({ ...user('gerente'), tenantId: T2 }, 'esconder', id, { esconder: true })).rejects.toThrow(NotFoundException);
  });

  it('RBAC: execução e supervisão 403 (as rotas e o serviço); o comentário do caso para a gestão (404 de outra empresa)', async () => {
    for (const m of ['comentarios', 'responderComentario', 'privadaDoComentario', 'esconderComentario', 'comentarioDoCaso'] as const)
      expect([m, Reflect.getMetadata(ROLES_KEY, (InstagramController.prototype as any)[m])]).toEqual([m, ['presidente', 'gerente']]);
    await ligar({ robo: true });
    const c = cid();
    await comentar({ id: c, texto: 'Veio errado!' });
    const r: any = await chamar(`cm:${c}`);
    const { id } = await linha(c);
    for (const cat of ['execucao', 'supervisao']) {
      await expect(svc.comentarios.listarPara(user(cat, cat === 'execucao' ? 'edu' : 'sil'), {})).rejects.toThrow(ForbiddenException);
      await expect(svc.comentarios.agirPara(user(cat), 'responder', id, { texto: 'oi' })).rejects.toThrow(ForbiddenException);
      await expect(svc.comentarios.agirPara(user(cat), 'esconder', id, { esconder: true })).rejects.toThrow(ForbiddenException);
      await expect(svc.comentarios.doCasoPara(user(cat), r.id)).rejects.toThrow(ForbiddenException);
    }
    const doCaso: any = await svc.comentarios.doCasoPara(user('presidente'), r.id);
    expect(doCaso).toMatchObject({ id, comentarioId: c, casoId: r.id, privada: { texto: expect.any(String) }, podePrivada: false });
    await expect(svc.comentarios.doCaso(T2, r.id)).rejects.toThrow(NotFoundException);
    expect(doMeta('replies')).toHaveLength(0);
  });

  it('o servidor da loja: a lista e a ação vão à NUVEM (token do servidor; o code da recusa volta); na nuvem, quem agiu é conferido', async () => {
    process.env.EDGE_MODE = 'true';
    try {
      const r: any = await svc.comentarios.listarPara(user('gerente'), { filtro: 'todos', antes: 'abc' });
      expect(r).toEqual({ itens: [], via: 'nuvem' });
      expect(aNuvem[0]).toMatchObject({ metodo: 'GET', caminho: '/nuvem/atendimento/instagram-comentarios-da-loja?filtro=todos&antes=abc', token: 'tok-do-servidor-da-loja' });
      respostaDaNuvem = { status: 409, corpo: { statusCode: 409, code: 'JA_RESPONDIDO', message: 'Este comentário já tem a resposta da loja.' } };
      const e: any = await svc.comentarios.agirPara(user('gerente'), 'responder', '5a1e0e7e-0000-4000-8000-000000000001', { texto: 'Oi!' }).catch((x) => x);
      expect(e).toBeInstanceOf(ConflictException);
      expect(e.getResponse()).toMatchObject({ code: 'JA_RESPONDIDO', message: 'Este comentário já tem a resposta da loja.' });
      expect(aNuvem[1]).toMatchObject({
        metodo: 'POST',
        caminho: '/nuvem/atendimento/instagram-comentarios-da-loja',
        corpo: { acao: 'responder', id: '5a1e0e7e-0000-4000-8000-000000000001', texto: 'Oi!', atorId: pessoa.ana },
      });
      // a recusa que a loja já sabe dar não vai à nuvem
      await expect(svc.comentarios.agirPara(user('gerente'), 'responder', '5a1e0e7e-0000-4000-8000-000000000001', { texto: '' })).rejects.toThrow(BadRequestException);
      await expect(svc.comentarios.listarPara(user('execucao', 'edu'), {})).rejects.toThrow(ForbiddenException);
      expect(aNuvem).toHaveLength(2);
    } finally {
      delete process.env.EDGE_MODE;
    }
    // na nuvem (a rota do servidor da loja): quem agiu tem de ser gestão ativa DESTA empresa
    await ligar({ robo: false });
    const c = cid();
    await comentar({ id: c, texto: 'Que lindo!' });
    const { id } = await linha(c);
    const loja = new AtendimentoLojaController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, svc);
    const ctx = { tenantId: T } as any;
    await expect(loja.agirNoComentarioDaLoja(ctx, { acao: 'responder', id, texto: 'Valeu!', atorId: pessoa.edu })).rejects.toThrow(ForbiddenException);
    await expect(loja.agirNoComentarioDaLoja(ctx, { acao: 'responder', id, texto: 'Valeu!', atorId: pessoa.gil })).rejects.toThrow(ForbiddenException);
    await expect(loja.agirNoComentarioDaLoja(ctx, { acao: 'apagar', id, atorId: pessoa.ana })).rejects.toThrow(BadRequestException);
    expect(await loja.agirNoComentarioDaLoja(ctx, { acao: 'responder', id, texto: 'Valeu!', atorId: pessoa.ana })).toMatchObject({ resposta: { por: 'equipe' } });
    expect((await loja.comentariosDaLoja(ctx, { filtro: 'respondidos' })).itens.map((x: any) => x.id)).toEqual([id]);
  });

  it('os ajustes: permitido pela permissão da conta; liga e desliga com booleano (ausente fica); o robô só liga permitido e disponível; a recusa vem antes de gravar qualquer grupo (V86)', async () => {
    await ligar({ robo: false, fila: true });
    const nulo = () => new Proxy({}, { get: () => async () => null });
    const ctl = new AtendimentoController(
      nulo() as any, nulo() as any, nulo() as any, nulo() as any, fila, nulo() as any, nulo() as any, nulo() as any, nulo() as any, nulo() as any,
      undefined, undefined, undefined, undefined, svc,
    );
    const g = user('gerente');
    const a: any = await ctl.ajustes(g, null);
    expect(a.instagram.comentarios).toEqual({ permitido: true, roboResponde: false, naFila: true });
    expect(JSON.stringify(a.instagram)).not.toMatch(/permissoes|manage_comments|tok-ig/);
    const r: any = await ctl.salvarAjustes(g, null, { instagram: { comentarios: { roboResponde: true } } });
    expect(r.instagram.comentarios).toEqual({ permitido: true, roboResponde: true, naFila: true });
    const r2: any = await ctl.salvarAjustes(g, null, { instagram: { comentarios: { naFila: 'false' } } });
    expect(r2.instagram.comentarios).toEqual({ permitido: true, roboResponde: true, naFila: false });
    expect(auditados.map((x) => x.acao)).toEqual(['robo_nos_comentarios_ligado', 'comentarios_na_fila_desligado']);
    await expect(ctl.salvarAjustes(g, null, { instagram: { comentarios: { roboResponde: 1 } } })).rejects.toThrow(BadRequestException);
    await expect(ctl.salvarAjustes(g, null, { instagram: { comentarios: 'sim' } })).rejects.toThrow(BadRequestException);
    // a conta de antes da F6 (sem a permissão): não é permitido e o robô não liga — e a recusa vem antes dos outros grupos
    await ligar({ robo: false, fila: true, permissoes: 'instagram_business_basic,instagram_business_manage_messages' });
    expect(((await ctl.ajustes(g, null)) as any).instagram.comentarios).toEqual({ permitido: false, roboResponde: false, naFila: true });
    await expect(
      ctl.salvarAjustes(g, null, { perfis: { comentarios: { perfil: 'gentil' } }, instagram: { comentarios: { roboResponde: true } } }),
    ).rejects.toThrow('A conta do Instagram foi conectada antes dos comentários: reconecte o Instagram para dar a permissão dos comentários.');
    expect((await q(`select atendente_perfis from robo_config where tenant_id = $1`, [T]))[0].atendente_perfis).toEqual({});
    // o robô indisponível na distribuição
    await ligar({ robo: false });
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    await expect(ctl.salvarAjustes(g, null, { instagram: { comentarios: { roboResponde: true } } })).rejects.toThrow('O robô ainda não está disponível');
    // desligar sempre pode
    expect(((await ctl.salvarAjustes(g, null, { instagram: { comentarios: { roboResponde: false } } })) as any).instagram.comentarios.roboResponde).toBe(false);
    // o perfil do canal comentarios grava como os outros
    expect((await ctl.salvarAjustes(g, null, { perfis: { comentarios: { perfil: 'gentil' } } })).perfis.comentarios).toEqual({ perfil: 'gentil', foraDoHorario: 'mesmo', jeito: null });
  });
});
