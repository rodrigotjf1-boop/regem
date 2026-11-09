import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { cifrar, decifrar } from '../../common/cifra-segredo';
import { uuidDeChave } from '../../common/id-deterministico';
import {
  assinarConversa,
  assinarConversaDoDirect,
  assinarConversaDoMessenger,
  lerConversa,
  lerConversaDoDirect,
  lerConversaDoMessenger,
} from '../../common/conversa-do-robo';
import { esquecerPendentes } from '../whatsapp/juntar-mensagens';
import { MessengerService } from './messenger.service';
import { MessengerPublicoController } from './messenger.controller';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { RECUSA_NO_MESSENGER, WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { RoboConsultasController } from '../cardapio/robo-consultas.controller';
import { RoboPedidoController } from '../cardapio/robo-pedido.controller';
import { RoboPedidoService } from '../cardapio/robo-pedido.service';
import { VERSAO_DO_MESSENGER } from '../cardapio/robo-instrucoes';
import { ClienteService } from '../cliente/cliente.service';
import { ChatDoCasoService } from '../atendimento/chat-do-caso.service';
import { FilaEAvisosService } from '../atendimento/fila-e-avisos.service';
import { AtendimentoController } from '../atendimento/atendimento.controller';
import { AtendimentoLojaController } from '../atendimento/atendimento-loja.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MESSENGER DO FACEBOOK (mig 386), contra o Postgres real, um FACEBOOK e um n8n DE MENTIRA locais (nada sai para fora):
// conectar (1 página; 2 = a escolha, a lista sem o acesso, escolher; a página de outra empresa = 409; os avisos ligados com
// a consulta da doc; o acesso da página CIFRADO), o aviso assinado (o sem assinatura recusado), a mensagem do cliente (vira
// caso com o robô desligado; vai ao robô com a chave `fb:` e o corpo certo; o repetido não duplica; o eco da loja cala o
// robô e o eco do nosso app é ignorado), a resposta do robô pela Send API (o corpo que sai), o quieto com o caso aberto, a
// janela de 24 h, a resposta da equipe, o "chamar atendente" (a ficha do Messenger, UM "já chamei" — V83), as rotas de
// telefone que recusam `fb:` (V79), "Conversas agora" e o "Assumir", os ajustes (V15/V16/V86), o "sem resposta" (V84/V42),
// desconectar e o servidor da loja pela nuvem (V37). Ids no formato da Meta: só dígitos (ERR-409).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('messenger-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const APP_ID = '880011223344';
const SEGREDO_APP = 'segredo-do-app-facebook';
const PAGINA = '104857600123456';
const PAGINA2 = '104857600654321';
const PSID = '7712345678901234';
const SENHA = 'senha-do-robo-de-teste';

descrever('Messenger do Facebook (Postgres + Facebook e n8n de mentira)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let CARD: string;
  let CARD2: string;
  let svc: MessengerService;
  let resposta: RoboRespostaService;
  let cardapio: CardapioService;
  let chat: ChatDoCasoService;
  let fila: FilaEAvisosService;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aoRobo: any[] = [];
  const pedidos: Array<{ metodo: string; caminho: string; consulta: Record<string, string>; auth: string | undefined; corpo: any }> = [];
  const eventos: Array<{ nome: string; dados: any }> = [];
  const auditados: any[] = [];
  const pessoa: Record<string, string> = {};
  let paginasDaVez: any[] = [];
  let permissoesDaVez: any[] = [];
  let falharEnvio: null | { code: number; message: string } = null;
  let nMid = 0;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
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
  const PERMISSOES_OK = [
    { permission: 'pages_show_list', status: 'granted' },
    { permission: 'pages_messaging', status: 'granted' },
    { permission: 'pages_manage_metadata', status: 'granted' },
    { permission: 'public_profile', status: 'granted' },
  ];
  const pagina = (id: string, nome: string, token: string, tasks = ['ANALYZE', 'ADVERTISE', 'MODERATE', 'CREATE_CONTENT', 'MANAGE', 'MESSAGING']) => ({
    id,
    name: nome,
    access_token: token,
    category: 'Restaurante',
    tasks,
  });
  const aviso = (o: { mid: string; texto?: string; eco?: boolean; appId?: string | number; psid?: string; pagina?: string; em?: number; audio?: boolean }) => {
    const pg = o.pagina ?? PAGINA;
    const cl = o.psid ?? PSID;
    return {
      object: 'page',
      entry: [
        {
          id: pg,
          time: Date.now(),
          messaging: [
            {
              sender: { id: o.eco ? pg : cl },
              recipient: { id: o.eco ? cl : pg },
              timestamp: o.em ?? Date.now(),
              message: {
                mid: o.mid,
                ...(o.texto ? { text: o.texto } : {}),
                ...(o.audio ? { attachments: [{ type: 'audio', payload: { url: 'https://cdn.fbsbx.com/v/t59/audio.mp4' } }] } : {}),
                ...(o.eco ? { is_echo: true } : {}),
                ...(o.appId !== undefined ? { app_id: o.appId } : {}),
              },
            },
          ],
        },
      ],
    };
  };
  const esperar = async (fn: () => Promise<boolean> | boolean, vezes = 60) => {
    for (let i = 0; i < vezes; i++) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const quieto = () => new Promise((r) => setTimeout(r, 400));
  const user = (cat: string, quem = 'ana', tenant?: string) => ({ tenantId: tenant ?? T, colaboradorId: pessoa[quem], categoria: cat }) as any;
  const casos = (psid = PSID, tenant = T) =>
    q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'messenger' and detalhe #>> '{messenger,psid}' = $2 order by criado_em`, [tenant, psid]);
  const ligarConta = (o: { robo?: boolean; fila?: boolean; tenant?: string; pagina?: string } = {}) =>
    q(
      `insert into messenger_conta (tenant_id, pagina_id, pagina_nome, token_cifrado, fila_ligada, robo_responde, conectado_por)
       values ($1, $2, 'Burger da Praça', $3, $4, $5, $6)`,
      [o.tenant ?? T, o.pagina ?? PAGINA, cifrar('tok-pagina-1'), o.fila ?? true, o.robo ?? false, pessoa.ana],
    );
  const ligarRobo = (ligado = true) => q(`update messenger_conta set robo_responde = $2 where tenant_id = $1`, [T, ligado]);
  const responderComoRobo = (texto: string, extra: any = {}) =>
    resposta.responder(SENHA, { instancia: `fb:${PAGINA}`, para: `fb:${PSID}`, texto, ...extra } as any);
  const envios = () => pedidos.filter((p) => p.metodo === 'POST' && p.caminho.endsWith('/messages'));
  const conectarPeloLogin = async (tenant = T, quem = 'ana', codigo = 'codigo-bom') => {
    const urlLogin = new URL((svc.conectar(user('gerente', quem, tenant)) as any).url);
    return svc.retorno({ code: `${codigo}#_=_`, state: urlLogin.searchParams.get('state') ?? '' });
  };
  const tok = () => `tok-msgr-${T.slice(0, 8)}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '366_ponte_do_chat.sql', // "Conversas agora" lê o chat da plataforma e o `chat_robo_responde` (ERR-273)
      '367_chat_ordem_e_indices.sql',
      '379_horario_da_equipe.sql', // o caso do Messenger fora do horário da equipe vira recado (ERR-273)
      '380_perfis_do_atendente.sql', // o perfil do canal `messenger` nas instruções e nos ajustes (ERR-273)
      '381_assuntos_do_atendente.sql', // os assuntos que não são pedido (o recado para o responsável) (ERR-273)
      '386_messenger.sql',
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
        let json: any = null;
        try {
          json = corpo ? JSON.parse(corpo) : null;
        } catch {
          json = corpo;
        }
        if (u.pathname === '/n8n') {
          aoRobo.push({ corpo: json, segredo: req.headers['x-regem-robo-segredo'] });
          return j(200, { ok: true });
        }
        pedidos.push({ metodo: req.method ?? '', caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), auth: req.headers.authorization, corpo: json });
        if (u.pathname === '/v27.0/oauth/access_token') {
          if (u.searchParams.get('grant_type') === 'fb_exchange_token')
            return u.searchParams.get('fb_exchange_token') === 'curto-1'
              ? j(200, { access_token: 'longo-1', token_type: 'bearer', expires_in: 5183944 })
              : j(400, { error: { message: 'Invalid OAuth access token.', type: 'OAuthException', code: 190 } });
          if (u.searchParams.get('code') !== 'codigo-bom') return j(400, { error: { message: 'This authorization code has been used.', type: 'OAuthException', code: 100 } });
          return j(200, { access_token: 'curto-1', token_type: 'bearer', expires_in: 5183 });
        }
        if (u.pathname === '/v27.0/me/accounts') return j(200, { data: paginasDaVez, paging: { cursors: { before: 'a', after: 'b' } } });
        if (u.pathname === '/v27.0/me/permissions') return j(200, { data: permissoesDaVez });
        if (u.pathname.endsWith('/subscribed_apps')) return j(200, { success: true });
        if (req.method === 'POST' && u.pathname.endsWith('/messages')) {
          if (falharEnvio) return j(400, { error: { message: falharEnvio.message, type: 'OAuthException', code: falharEnvio.code } });
          return j(200, { recipient_id: json?.recipient?.id, message_id: `m_resp_${++nMid}` });
        }
        if (req.method === 'GET' && u.pathname === `/v27.0/${PSID}`) return j(200, { first_name: 'Joana', last_name: 'Souza', id: PSID });
        return j(404, { error: { message: 'rota desconhecida', code: 803 } });
      });
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    const env: Record<string, string> = {
      FACEBOOK_APP_ID: APP_ID,
      FACEBOOK_APP_SECRET: SEGREDO_APP,
      FACEBOOK_VERIFY_TOKEN: 'verifica-fb',
      FACEBOOK_GRAPH_URL: base,
      FACEBOOK_LOGIN_URL: base,
      FACEBOOK_REDIRECT_URI: 'https://api.teste/api/v1/publico/messenger/retorno',
      APP_URL: 'https://app.teste',
      CARDAPIO_PUBLIC_URL: 'https://app.teste',
      SEGREDOS_CHAVE: randomBytes(32).toString('base64'),
      BOT_RESOLVER_SECRET: SENHA,
      N8N_ROBO_WEBHOOK_URL: `${base}/n8n`,
      ROBO_JUNTAR_MS: '0',
    };
    for (const [k, v] of Object.entries(env)) {
      antes[k] = process.env[k];
      process.env[k] = v;
    }
    for (const k of ['EDGE_MODE', 'FACEBOOK_GRAPH_VERSAO', 'FACEBOOK_LOGIN_CONFIG_ID', 'CLOUD_API', 'SYNC_TOKEN']) {
      antes[k] = process.env[k];
      delete process.env[k];
    }
    const emitir = { emit: (nome: string, dados: any) => (eventos.push({ nome, dados }), true) } as any;
    const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
    svc = new MessengerService(db, emitir, auditoria);
    resposta = new RoboRespostaService(db, {} as any, {} as any, undefined, emitir, svc);
    const u = {} as any;
    cardapio = new CardapioService(db, u, u, u, u, u, emitir, u, auditoria, undefined, undefined, undefined, svc);
    chat = new ChatDoCasoService(db, emitir, {} as any, auditoria, undefined, svc);
    fila = new FilaEAvisosService(db, emitir, auditoria);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste messenger') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa messenger') returning id`);
    const funcao: Record<string, string> = {};
    for (const [t, cat] of [[T, 'gerente'], [T, 'supervisao'], [T, 'execucao'], [T2, 'gerente']] as const)
      [{ id: funcao[`${t}:${cat}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
    for (const [nome, t, cat] of [['ana', T, 'gerente'], ['sara', T, 'supervisao'], ['edu', T, 'execucao'], ['gil', T2, 'gerente']] as const)
      [{ id: pessoa[nome] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [t, nome, funcao[`${t}:${cat}`]]);
    [{ id: CARD }] = await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Burger da Praça') returning id`, [T, `tok-msgr-${T.slice(0, 8)}`]);
    [{ id: CARD2 }] = await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Outra') returning id`, [T2, `tok-msgr-${T2.slice(0, 8)}`]);
    await q(`insert into robo_config (tenant_id, pausa_minutos) values ($1, 60), ($2, 60) on conflict (tenant_id) do update set pausa_minutos = 60`, [T, T2]);
  });
  afterAll(async () => {
    esquecerPendentes();
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const s of soquetes) s.destroy();
    if (servidor) await new Promise<void>((ok) => servidor.close(() => ok()));
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of [
        'messenger_mensagem',
        'messenger_contato',
        'messenger_escolha',
        'messenger_conta',
        'atendimento_chamado',
        'pedido_externo',
        'cliente',
        'robo_config',
        'cardapio_config',
        'colaborador',
        'funcao',
      ])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    process.env.BOT_RESOLVER_SECRET = SENHA;
    process.env.FACEBOOK_VERIFY_TOKEN = 'verifica-fb';
    paginasDaVez = [pagina(PAGINA, 'Burger da Praça', 'tok-pagina-1')];
    permissoesDaVez = PERMISSOES_OK;
    falharEnvio = null;
    nMid = 0;
    aoRobo.length = 0;
    pedidos.length = 0;
    eventos.length = 0;
    auditados.length = 0;
    for (const t of [T, T2])
      for (const tab of ['messenger_mensagem', 'messenger_contato', 'messenger_escolha', 'messenger_conta', 'atendimento_chamado'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]);
    await q(`update cardapio_config set ativo = true where tenant_id in ($1, $2)`, [T, T2]);
    await q(`delete from cardapio_config where tenant_id = $1 and id <> $2`, [T, CARD]);
    await q(`update robo_config set atendente_perfis = '{}'::jsonb, atendente_assuntos = '{}'::jsonb where tenant_id in ($1, $2)`, [T, T2]);
  });

  // ───── conectar ─────

  it('conectar no app do tipo empresa (ERR-415): `FACEBOOK_LOGIN_CONFIG_ID` vai como `config_id`, sem `scope`, e o `code` continua', () => {
    process.env.FACEBOOK_LOGIN_CONFIG_ID = '1234567890123456';
    try {
      const u = new URL((svc.conectar(user('gerente')) as any).url);
      expect(`${u.origin}${u.pathname}`).toBe(`${base}/v27.0/dialog/oauth`);
      expect(u.searchParams.get('config_id')).toBe('1234567890123456');
      expect(u.searchParams.get('override_default_response_type')).toBe('true');
      expect(u.searchParams.get('response_type')).toBe('code');
      expect(u.searchParams.has('scope')).toBe(false);
      expect(u.searchParams.get('redirect_uri')).toBe('https://api.teste/api/v1/publico/messenger/retorno');
    } finally {
      delete process.env.FACEBOOK_LOGIN_CONFIG_ID;
    }
  });

  it('conectar com UMA página: o login da doc, o acesso longo, a página com MESSAGING, os avisos ligados e o acesso da página CIFRADO', async () => {
    const urlLogin = new URL((svc.conectar(user('gerente')) as any).url);
    expect(`${urlLogin.origin}${urlLogin.pathname}`).toBe(`${base}/v27.0/dialog/oauth`);
    expect(urlLogin.searchParams.get('client_id')).toBe(APP_ID);
    expect(urlLogin.searchParams.get('redirect_uri')).toBe('https://api.teste/api/v1/publico/messenger/retorno');
    expect(urlLogin.searchParams.get('scope')).toBe('pages_show_list,pages_messaging,pages_manage_metadata');
    expect(urlLogin.searchParams.get('response_type')).toBe('code');
    expect(await svc.retorno({ code: 'codigo-bom#_=_', state: urlLogin.searchParams.get('state') ?? '' })).toBe(
      'https://app.teste/delivery/configuracoes?aba=atendimento&messenger=conectado',
    );
    const [troca, longo] = pedidos.filter((p) => p.caminho === '/v27.0/oauth/access_token');
    expect(troca.consulta).toEqual({ client_id: APP_ID, redirect_uri: 'https://api.teste/api/v1/publico/messenger/retorno', client_secret: SEGREDO_APP, code: 'codigo-bom' });
    expect(longo.consulta).toEqual({ grant_type: 'fb_exchange_token', client_id: APP_ID, client_secret: SEGREDO_APP, fb_exchange_token: 'curto-1' });
    expect(pedidos.find((p) => p.caminho === '/v27.0/me/accounts')).toMatchObject({ auth: 'Bearer longo-1', consulta: { fields: 'id,name,access_token,tasks' } });
    expect(pedidos.find((p) => p.caminho === '/v27.0/me/permissions')?.auth).toBe('Bearer longo-1');
    // Os avisos da página: POST /{página}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_echoes (o eco da loja pela página — cala o robô) com o acesso da PÁGINA.
    const assinatura = pedidos.find((p) => p.caminho === `/v27.0/${PAGINA}/subscribed_apps`)!;
    expect(assinatura).toMatchObject({ metodo: 'POST', auth: 'Bearer tok-pagina-1', consulta: { subscribed_fields: 'messages,messaging_postbacks,message_echoes' } });
    const [c] = await q(`select * from messenger_conta where tenant_id = $1`, [T]);
    expect(c).toMatchObject({ pagina_id: PAGINA, pagina_nome: 'Burger da Praça', fila_ligada: true, robo_responde: false, conectado_por: pessoa.ana, erro: null });
    expect(c.permissoes).toBe('pages_show_list,pages_messaging,pages_manage_metadata,public_profile');
    expect(c.token_cifrado).not.toContain('tok-pagina-1');
    expect(decifrar(c.token_cifrado)).toBe('tok-pagina-1');
    const a: any = await svc.ajuste(T);
    expect(a).toMatchObject({ disponivel: true, roboDisponivel: true, escolhaPendente: false });
    expect(a.conta).toEqual({
      paginaId: PAGINA,
      paginaNome: 'Burger da Praça',
      filaLigada: true,
      roboResponde: false,
      cardapioId: null,
      conectadoEm: expect.anything(), // o texto da hora do banco, como o `conectadoEm` do Instagram
      conectadoPor: 'ana',
      erro: null,
    });
    expect(JSON.stringify(a)).not.toMatch(/tok-|longo|curto|token/i);
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'messenger_conectado', detalhe: { paginaId: PAGINA, paginaNome: 'Burger da Praça' } }));
  });

  it('conectar: state forjado, cancelado, quem não é gestão, código ruim, nenhuma página e a permissão desmarcada não conectam nada', async () => {
    const situacao = (u: string) => new URL(u).searchParams.get('messenger');
    const forjado = `${Buffer.from(JSON.stringify({ t: T, c: pessoa.ana, e: Date.now() + 60_000, n: 'x' })).toString('base64url')}.assinatura-falsa`;
    expect(situacao(await svc.retorno({ code: 'codigo-bom', state: forjado }))).toBe('expirou');
    const urlLogin = new URL((svc.conectar(user('gerente')) as any).url);
    expect(situacao(await svc.retorno({ error: 'access_denied', state: urlLogin.searchParams.get('state') ?? '' }))).toBe('cancelado');
    expect(situacao(await conectarPeloLogin(T, 'edu'))).toBe('sem-permissao');
    expect(situacao(await conectarPeloLogin(T, 'sara'))).toBe('sem-permissao'); // conectar é de gerente e presidente
    expect(situacao(await conectarPeloLogin(T, 'ana', 'codigo-ruim'))).toBe('erro');
    paginasDaVez = [pagina(PAGINA, 'Só anúncios', 'tok-x', ['ADVERTISE', 'ANALYZE'])];
    expect(situacao(await conectarPeloLogin())).toBe('sem-pagina');
    paginasDaVez = [pagina(PAGINA, 'Burger da Praça', 'tok-pagina-1')];
    permissoesDaVez = PERMISSOES_OK.map((p) => (p.permission === 'pages_messaging' ? { ...p, status: 'declined' } : p));
    expect(situacao(await conectarPeloLogin())).toBe('faltou-permissao');
    expect(await q(`select 1 from messenger_conta where tenant_id = $1`, [T])).toHaveLength(0);
    expect(pedidos.some((p) => p.caminho.endsWith('/subscribed_apps'))).toBe(false);
    // Sem o app da distribuição configurado: o "Conectar" recusa (502 MESSENGER_INDISPONIVEL) — o usuário nunca vê segredo.
    delete process.env.FACEBOOK_VERIFY_TOKEN;
    try {
      svc.conectar(user('gerente'));
      throw new Error('não recusou');
    } catch (e: any) {
      expect(e.getStatus?.()).toBe(502);
      expect(e.getResponse()).toMatchObject({ code: 'MESSENGER_INDISPONIVEL' });
    }
  });

  it('conectar com DUAS páginas: a escolha (cifrada, 15 min), a lista SEM o acesso, escolher e a escolha some', async () => {
    paginasDaVez = [pagina(PAGINA, 'Burger da Praça', 'tok-pagina-1'), pagina(PAGINA2, 'Burger da Praça — Centro', 'tok-pagina-2')];
    expect(await conectarPeloLogin()).toBe('https://app.teste/delivery/configuracoes?aba=atendimento&messenger=escolher');
    expect(await q(`select 1 from messenger_conta where tenant_id = $1`, [T])).toHaveLength(0);
    expect(pedidos.some((p) => p.caminho.endsWith('/subscribed_apps'))).toBe(false);
    const [e] = await q(`select * from messenger_escolha where tenant_id = $1`, [T]);
    expect(e.colaborador_id).toBe(pessoa.ana);
    expect(e.paginas_cifradas).not.toContain('tok-pagina');
    expect(JSON.parse(decifrar(e.paginas_cifradas)).map((p: any) => p.token)).toEqual(['tok-pagina-1', 'tok-pagina-2']);
    expect(new Date(e.vence_em).getTime() - Date.now()).toBeGreaterThan(14 * 60_000);
    expect(((await svc.ajuste(T)) as any).escolhaPendente).toBe(true);
    const lista = await svc.paginasDaEscolha(user('gerente'));
    expect(lista).toEqual({
      paginas: [
        { id: PAGINA, nome: 'Burger da Praça' },
        { id: PAGINA2, nome: 'Burger da Praça — Centro' },
      ],
    });
    expect(JSON.stringify(lista)).not.toMatch(/tok-/);
    // A escolha é da empresa: outra empresa não vê; página fora da lista e quem não é gerência são recusados.
    await expect(svc.paginasDaEscolha(user('gerente', 'gil', T2))).rejects.toThrow(NotFoundException);
    await expect(svc.escolher(user('gerente'), { paginaId: '999999999999999' })).rejects.toMatchObject({ response: { code: 'PAGINA_FORA_DA_ESCOLHA' } });
    await expect(svc.escolher(user('gerente'), { paginaId: 'pagina' })).rejects.toThrow(BadRequestException);
    await expect(svc.escolher(user('supervisao', 'sara'), { paginaId: PAGINA2 })).rejects.toThrow(ForbiddenException);
    expect(await svc.escolher(user('gerente'), { paginaId: PAGINA2 })).toEqual({ ok: true, pagina: { id: PAGINA2, nome: 'Burger da Praça — Centro' } });
    expect(pedidos.find((p) => p.caminho === `/v27.0/${PAGINA2}/subscribed_apps`)).toMatchObject({ metodo: 'POST', auth: 'Bearer tok-pagina-2' });
    const [c] = await q(`select pagina_id, token_cifrado from messenger_conta where tenant_id = $1`, [T]);
    expect(c.pagina_id).toBe(PAGINA2);
    expect(decifrar(c.token_cifrado)).toBe('tok-pagina-2');
    expect(await q(`select 1 from messenger_escolha where tenant_id = $1`, [T])).toHaveLength(0);
    await expect(svc.paginasDaEscolha(user('gerente'))).rejects.toMatchObject({ response: { code: 'SEM_ESCOLHA' } });
    await expect(svc.escolher(user('gerente'), { paginaId: PAGINA })).rejects.toMatchObject({ response: { code: 'SEM_ESCOLHA' } });
    // A escolha vencida (15 min) não vale.
    await conectarPeloLogin();
    await q(`update messenger_escolha set vence_em = now() - interval '1 minute' where tenant_id = $1`, [T]);
    await expect(svc.paginasDaEscolha(user('gerente'))).rejects.toThrow(NotFoundException);
    expect(((await svc.ajuste(T)) as any).escolhaPendente).toBe(false);
  });

  it('a página já ligada a OUTRA empresa: o login volta "em-outra-empresa" e o escolher dá 409 PAGINA_DE_OUTRA_EMPRESA — sem ligar os avisos', async () => {
    expect(await conectarPeloLogin()).toMatch(/messenger=conectado$/);
    pedidos.length = 0;
    expect(await conectarPeloLogin(T2, 'gil')).toMatch(/messenger=em-outra-empresa$/);
    expect(pedidos.some((p) => p.caminho.endsWith('/subscribed_apps'))).toBe(false);
    paginasDaVez = [pagina(PAGINA, 'Burger da Praça', 'tok-pagina-1'), pagina(PAGINA2, 'Outra página', 'tok-pagina-2')];
    expect(await conectarPeloLogin(T2, 'gil')).toMatch(/messenger=escolher$/);
    const err: any = await svc.escolher(user('gerente', 'gil', T2), { paginaId: PAGINA }).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toEqual({ statusCode: 409, code: 'PAGINA_DE_OUTRA_EMPRESA', message: 'Esta página do Facebook já está conectada em outra empresa.' });
    expect(await q(`select 1 from messenger_conta where tenant_id = $1`, [T2])).toHaveLength(0);
    // A escolha continua (dá para escolher a outra página).
    expect(await svc.escolher(user('gerente', 'gil', T2), { paginaId: PAGINA2 })).toMatchObject({ ok: true });
    // Reconectar na MESMA empresa troca o acesso (não abre outra linha) e a página antiga deixa de avisar.
    paginasDaVez = [pagina('104857600999999', 'Nova página', 'tok-pagina-3')];
    expect(await conectarPeloLogin()).toMatch(/conectado$/);
    expect(await q(`select pagina_id from messenger_conta where tenant_id = $1`, [T])).toEqual([{ pagina_id: '104857600999999' }]);
    expect(pedidos.some((p) => p.metodo === 'DELETE' && p.caminho === `/v27.0/${PAGINA}/subscribed_apps` && p.auth === 'Bearer tok-pagina-1')).toBe(true);
  });

  // ───── o aviso ─────

  it('o aviso pela rota pública: assinado com o segredo do app entra; sem assinatura, nada entra', async () => {
    await ligarConta();
    const ctrl = new MessengerPublicoController(svc);
    const corpo = aviso({ mid: 'm_rota_1', texto: 'Oi, tudo bem?' });
    const cru = Buffer.from(JSON.stringify(corpo));
    expect(() => ctrl.evento({ rawBody: cru, body: corpo, headers: {} })).toThrow(UnauthorizedException);
    expect(() => ctrl.evento({ rawBody: cru, body: corpo, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', 'outro').update(cru).digest('hex')}` } })).toThrow(
      UnauthorizedException,
    );
    await quieto();
    expect(await q(`select 1 from messenger_mensagem where tenant_id = $1`, [T])).toHaveLength(0);
    expect(ctrl.evento({ rawBody: cru, body: corpo, headers: { 'x-hub-signature-256': `sha256=${createHmac('sha256', SEGREDO_APP).update(cru).digest('hex')}` } })).toEqual({ ok: true });
    expect(await esperar(async () => (await casos()).length === 1)).toBe(true);
  });

  it('robô desligado: a mensagem do cliente vira CASO do Messenger; o repetido não entra; a segunda soma; o perfil dá o nome; nada vai ao robô', async () => {
    await ligarConta();
    await svc.processar(aviso({ mid: 'm_c1', texto: 'Vocês entregam no Centro?' }));
    await svc.processar(aviso({ mid: 'm_c1', texto: 'Vocês entregam no Centro?' })); // a Meta reentregou
    let lista = await casos();
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ status: 'aberto', tipo: 'messenger', canal: 'messenger', mensagem: 'Vocês entregam no Centro?', telefone: null, unidade_id: null });
    expect(lista[0].detalhe).toMatchObject({ plataforma: 'messenger', messenger: { psid: PSID, ultimaEm: expect.any(String) } });
    expect(eventos.filter((e) => e.nome === 'atendimento.novo')).toHaveLength(1);
    expect(await esperar(async () => (await casos())[0]?.cliente === 'Joana Souza')).toBe(true);
    expect((await casos())[0].detalhe.messenger).toMatchObject({ psid: PSID, nome: 'Joana Souza' });
    expect(pedidos.find((p) => p.caminho === `/v27.0/${PSID}`)).toMatchObject({ auth: 'Bearer tok-pagina-1', consulta: { fields: 'first_name,last_name' } });
    await svc.processar(aviso({ mid: 'm_c2', texto: 'Quero fazer um pedido grande pra sábado' }));
    lista = await casos();
    expect(lista).toHaveLength(1);
    expect(lista[0].mensagem).toBe('Quero fazer um pedido grande pra sábado');
    const msgs = await q(`select mid, autor, direcao, estado, chamado_id from messenger_mensagem where tenant_id = $1 order by criado_em`, [T]);
    expect(msgs.map((m) => [m.mid, m.autor, m.direcao, m.estado, m.chamado_id])).toEqual([
      ['m_c1', 'cliente', 'entrada', 'recebida', lista[0].id],
      ['m_c2', 'cliente', 'entrada', 'recebida', lista[0].id],
    ]);
    await quieto();
    expect(aoRobo).toHaveLength(0);
  });

  it('dois avisos juntos do mesmo cliente novo: um caso só (a trava da página); fila desligada só grava; página que não está conectada: nada', async () => {
    await ligarConta();
    await Promise.all([1, 2, 3].map((n) => svc.processar(aviso({ mid: `m_j${n}`, texto: `oi ${n}`, psid: '7700000000000055' }))));
    const lista = await casos('7700000000000055');
    expect(lista).toHaveLength(1);
    expect(await q(`select count(*)::int as n from messenger_mensagem where tenant_id = $1 and psid = '7700000000000055' and chamado_id = $2`, [T, lista[0].id])).toEqual([{ n: 3 }]);
    await q(`update messenger_conta set fila_ligada = false where tenant_id = $1`, [T]);
    await svc.processar(aviso({ mid: 'm_f1', texto: 'oi' }));
    expect(await casos()).toHaveLength(0);
    expect(await q(`select count(*)::int as n from messenger_mensagem where tenant_id = $1 and psid = $2`, [T, PSID])).toEqual([{ n: 1 }]);
    await svc.processar(aviso({ mid: 'm_f2', texto: 'oi', pagina: '104857600000000' }));
    expect(await q(`select count(*)::int as n from messenger_mensagem where mid = 'm_f2'`)).toEqual([{ n: 0 }]);
  });

  it('robô ligado: a mensagem NOVA vai ao robô uma vez só, sem caso — chave `fb:`, a ficha do Messenger, `provedor` instagram e `canal` messenger', async () => {
    await ligarConta({ robo: true });
    await svc.processar(aviso({ mid: 'm_r1', texto: 'Oi, vcs têm lanche vegano?' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    const m = aoRobo[0].corpo;
    expect(aoRobo[0].segredo).toBe(SENHA);
    expect(m).toMatchObject({
      provedor: 'instagram',
      canal: 'messenger',
      tenantId: T,
      instancia: `fb:${PAGINA}`,
      phoneNumberId: null,
      jid: null,
      de: `fb:${PSID}`,
      tipo: 'text',
      texto: 'Oi, vcs têm lanche vegano?',
      mensagemId: 'm_r1',
      cardapioToken: tok(),
      loja: { nome: 'Burger da Praça' },
      midiaId: null,
    });
    expect(lerConversaDoMessenger(m.conversa)).toEqual({ tenantId: T, psid: PSID });
    expect(lerConversa(m.conversa)).toBeNull(); // a ficha do Messenger não vale como a do telefone…
    expect(lerConversaDoDirect(m.conversa)).toBeNull(); // …nem como a do Direct
    expect(await casos()).toHaveLength(0);
    await svc.processar(aviso({ mid: 'm_r1', texto: 'Oi, vcs têm lanche vegano?' })); // a reentrega não vai de novo (ERR-319)
    await quieto();
    expect(aoRobo).toHaveLength(1);
    // Áudio: vai como TEXTO dizendo o que veio (no Messenger o robô não ouve áudio).
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'm_r2', audio: true }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    expect(aoRobo[0].corpo).toMatchObject({ tipo: 'text', texto: '(o cliente mandou um áudio pelo Messenger; aqui você não ouve áudio)' });
  });

  it('a resposta do robô pela Send API: o corpo da doc, o link com a origem do Messenger, as opções numeradas e a conversa como `robo`', async () => {
    await ligarConta({ robo: true });
    await svc.processar(aviso({ mid: 'm_s1', texto: 'Tem lanche vegano?' }));
    const link = `https://app.teste/c/${tok()}`;
    const r = await responderComoRobo(`Temos o Smash Veggie! Veja: ${link}?produto=p1. E também https://outro-site.com/x`, {
      opcoes: [{ titulo: 'Ver cardápio' }, { titulo: 'Horário' }],
    });
    expect(r).toMatchObject({ ok: true, enviado: true, enviados: ['texto'] });
    const [e] = envios();
    // Send API: POST /{página}/messages { recipient: { id: PSID }, messaging_type: 'RESPONSE', message: { text } }.
    expect(e.caminho).toBe(`/v27.0/${PAGINA}/messages`);
    expect(e.auth).toBe('Bearer tok-pagina-1');
    expect(Object.keys(e.corpo).sort()).toEqual(['message', 'messaging_type', 'recipient']);
    expect(e.corpo.recipient).toEqual({ id: PSID });
    expect(e.corpo.messaging_type).toBe('RESPONSE');
    expect(Object.keys(e.corpo.message)).toEqual(['text']);
    const texto: string = e.corpo.message.text;
    expect(texto).toContain(`${link}?produto=p1&utm_source=facebook&utm_medium=messenger.`);
    expect(texto).not.toContain('outro-site.com');
    expect(texto).toContain('1) Ver cardápio');
    expect(texto).toContain('2) Horário');
    const [m] = await q(`select autor, estado, mid from messenger_mensagem where tenant_id = $1 and direcao = 'saida'`, [T]);
    expect(m).toEqual({ autor: 'robo', estado: 'enviada', mid: expect.stringMatching(/^m_resp_/) });
    // O eco desta resposta (do NOSSO app) é ignorado: não entra de novo e não cala o robô.
    await svc.processar(aviso({ mid: m.mid, texto, eco: true, appId: Number(APP_ID) }));
    expect(await q(`select count(*)::int as n from messenger_mensagem where tenant_id = $1 and direcao = 'saida'`, [T])).toEqual([{ n: 1 }]);
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'm_s2', texto: 'E até que horas?' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    // O robô desligado pela loja: a resposta que o fluxo ainda tentar mandar fica segurada (V87, conferido na hora).
    pedidos.length = 0;
    await ligarRobo(false);
    expect(await responderComoRobo('Oi de novo!')).toMatchObject({ ok: true, enviado: false, motivo: 'robo_desligado' });
    expect(envios()).toHaveLength(0);
  });

  it('a empresa apagada (V75): o aviso da página dela não entra, as consultas do robô não acham a página e a resposta dá 404', async () => {
    await ligarConta({ robo: true });
    await q(`update empresa set deleted_at = now() where id = $1`, [T]);
    try {
      await svc.processar(aviso({ mid: 'm_apagada', texto: 'Oi' }));
      await quieto();
      expect(await q(`select 1 from messenger_mensagem where mid = 'm_apagada'`)).toHaveLength(0);
      expect(aoRobo).toHaveLength(0);
      await expect(cardapio.tokenDaLojaDoRobo(SENHA, `fb:${PAGINA}`, '')).rejects.toThrow(NotFoundException);
      await expect(responderComoRobo('Oi')).rejects.toThrow(NotFoundException);
      // E o login de quem é de uma empresa apagada não conecta nada.
      expect(await conectarPeloLogin()).toMatch(/messenger=sem-permissao$/);
    } finally {
      await q(`update empresa set deleted_at = null where id = $1`, [T]);
    }
  });

  it('texto longo: até 3 mensagens de até 2.000 caracteres; voz não sai no Messenger', async () => {
    await ligarConta({ robo: true });
    await svc.processar(aviso({ mid: 'm_l1', texto: 'Me fala tudo' }));
    const par = 'Á'.repeat(1900);
    expect(await responderComoRobo([par, par, par, par].join('\n\n'))).toMatchObject({ enviado: true, enviados: ['texto', 'texto', 'texto'] });
    expect(envios().map((p) => p.corpo.message.text)).toEqual([par, par, `${par}…`]);
    for (const p of envios()) expect(Array.from(p.corpo.message.text as string).length).toBeLessThanOrEqual(2000);
    // As 3 partes gravadas na mesma resposta: a hora estritamente crescente (clock_timestamp, ERR-379) — a conversa na ordem.
    const horas = await q(`select texto, criado_em from messenger_mensagem where tenant_id = $1 and autor = 'robo' order by criado_em, id`, [T]);
    expect(horas.map((h) => h.texto)).toEqual([par, par, `${par}…`]);
    for (let i = 1; i < horas.length; i++) expect(new Date(horas[i].criado_em).getTime()).toBeGreaterThan(new Date(horas[i - 1].criado_em).getTime());
    pedidos.length = 0;
    expect(await responderComoRobo('', { audio: { base64: 'T2dnUw==' } })).toMatchObject({ enviado: false, motivo: 'sem_voz_no_messenger' });
    expect(envios()).toHaveLength(0);
  });

  it('o ECO da loja (pelo app do Facebook): fica na conversa como `loja` e cala o robô — nem robô, nem caso', async () => {
    await ligarConta({ robo: true });
    await svc.processar(aviso({ mid: 'm_e0', texto: 'Oi' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    aoRobo.length = 0;
    // A Meta Business Suite manda o eco com o app DELA (outro app_id); o app do Facebook às vezes sem app_id.
    await svc.processar(aviso({ mid: 'm_e1', texto: 'Oi! Aqui é o Bruno.', eco: true, appId: 263902037430900 }));
    await svc.processar(aviso({ mid: 'm_e2', texto: 'Já te respondo', eco: true }));
    expect(await q(`select mid, autor, direcao, estado from messenger_mensagem where tenant_id = $1 and direcao = 'saida' order by mid`, [T])).toEqual([
      { mid: 'm_e1', autor: 'loja', direcao: 'saida', estado: 'enviada' },
      { mid: 'm_e2', autor: 'loja', direcao: 'saida', estado: 'enviada' },
    ]);
    await svc.processar(aviso({ mid: 'm_e3', texto: 'Obrigada' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    expect(await casos()).toHaveLength(0);
    expect(await responderComoRobo('Oi!')).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    // O eco do NOSSO app (o mesmo app_id da distribuição) nunca entra.
    await svc.processar(aviso({ mid: 'm_e4', texto: 'x', eco: true, appId: APP_ID }));
    expect(await q(`select 1 from messenger_mensagem where mid = 'm_e4'`)).toHaveLength(0);
  });

  it('robô quieto com o caso aberto com alguém: a mensagem entra no caso; a resposta do robô é segurada; fora das 24 h também', async () => {
    await ligarConta({ robo: true });
    const [c] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, mensagem, responsavel_id, detalhe) values ($1, 'messenger', 'messenger', 'x', $2, $3) returning id`,
      [T, pessoa.ana, JSON.stringify({ messenger: { psid: PSID } })],
    );
    await svc.processar(aviso({ mid: 'm_q1', texto: 'Oi de novo' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    expect((await q(`select chamado_id from messenger_mensagem where mid = 'm_q1'`))[0].chamado_id).toBe(c.id);
    expect(eventos).toContainEqual({ nome: 'atendimento.mudou', dados: { tenantId: T, id: c.id, motivo: 'messenger_mensagem' } });
    expect(await responderComoRobo('Oi!')).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [c.id]);
    await q(`update messenger_mensagem set criado_em = now() - interval '25 hours' where tenant_id = $1`, [T]);
    expect(await responderComoRobo('Oi!')).toMatchObject({ enviado: false, motivo: 'fora_da_janela' });
    expect(envios()).toHaveLength(0);
  });

  it('robô indisponível (sem o fluxo do robô): a conversa vira CASO na hora, mesmo com a fila desligada (V88); a resposta fica segurada', async () => {
    await ligarConta({ robo: true, fila: false });
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    await svc.processar(aviso({ mid: 'm_v1', texto: 'Oi' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    const [c] = await casos();
    expect(c.detalhe.messenger).toMatchObject({ semRobo: 'robo_indisponivel' });
    expect(await responderComoRobo('Oi')).toMatchObject({ enviado: false, motivo: 'robo_desligado' });
    // A resposta para uma página que não está conectada: 404; a chave torta: 400.
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    await expect(resposta.responder(SENHA, { instancia: 'fb:104857600000000', para: `fb:${PSID}`, texto: 'x' } as any)).rejects.toThrow(NotFoundException);
    await expect(resposta.responder(SENHA, { instancia: `fb:${PAGINA}`, para: 'fb:abc', texto: 'x' } as any)).rejects.toThrow(BadRequestException);
  });

  // ───── a equipe ─────

  it('a equipe responde: dentro das 24 h sai pela Send API, pega o caso e fica na auditoria; fora delas, 409 FORA_DA_JANELA', async () => {
    await ligarConta();
    await svc.processar(aviso({ mid: 'm_t1', texto: 'Vocês entregam?' }));
    const [caso] = await casos();
    const conv: any = await svc.conversa(T, caso.id);
    expect(conv).toMatchObject({ pagina: 'Burger da Praça', conectada: true, janela: { aberta: true } });
    expect(conv.mensagens.map((m: any) => [m.autor, m.texto])).toEqual([['cliente', 'Vocês entregam?']]);
    expect(await svc.responder(user('gerente'), caso.id, { texto: '  Entregamos sim!  ' })).toEqual({ ok: true, mid: 'm_resp_1' });
    const [e] = envios();
    expect(e.corpo).toEqual({ recipient: { id: PSID }, messaging_type: 'RESPONSE', message: { text: 'Entregamos sim!' } });
    expect(await q(`select autor, autor_id, estado, mid from messenger_mensagem where tenant_id = $1 and direcao = 'saida'`, [T])).toEqual([
      { autor: 'equipe', autor_id: pessoa.ana, estado: 'enviada', mid: 'm_resp_1' },
    ]);
    expect((await casos())[0]).toMatchObject({ responsavel_id: pessoa.ana });
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'respondeu_messenger', entidadeId: caso.id, detalhe: {} }));
    expect(((await svc.conversa(T, caso.id)) as any).mensagens.find((m: any) => m.autor === 'equipe')).toMatchObject({ autorNome: 'ana' });
    // Quem não é gestão; o texto longo demais; o caso de outra empresa.
    await expect(svc.responder(user('execucao', 'edu'), caso.id, { texto: 'oi' })).rejects.toThrow(ForbiddenException);
    await expect(svc.responder(user('gerente'), caso.id, { texto: 'a'.repeat(2001) })).rejects.toThrow('longa demais');
    await expect(svc.conversa(T2, caso.id)).rejects.toThrow('Caso do Messenger não encontrado.');
    // O acesso da página que a Meta deixou de aceitar (190): a falha fica na conversa e a conta pede "reconecte".
    falharEnvio = { code: 190, message: 'Error validating access token: The session has been invalidated.' };
    await expect(svc.responder(user('gerente'), caso.id, { texto: 'mais uma' })).rejects.toThrow('O Messenger não aceitou a mensagem');
    expect(await q(`select estado, erro from messenger_mensagem where tenant_id = $1 and texto = 'mais uma'`, [T])).toEqual([
      { estado: 'falhou', erro: 'Error validating access token: The session has been invalidated.' },
    ]);
    expect(((await svc.ajuste(T)) as any).conta.erro).toMatch(/reconecte/);
    falharEnvio = null;
    // 25 h depois da última mensagem do cliente: fechado (409 com o código para a tela).
    await q(`update messenger_mensagem set criado_em = now() - interval '25 hours' where tenant_id = $1 and autor = 'cliente'`, [T]);
    const fora: any = await svc.responder(user('gerente'), caso.id, { texto: 'oi?' }).catch((x) => x);
    expect(fora).toBeInstanceOf(ConflictException);
    expect(fora.getResponse()).toMatchObject({ statusCode: 409, code: 'FORA_DA_JANELA' });
    expect(((await svc.conversa(T, caso.id)) as any).janela.aberta).toBe(false);
  });

  it('desconectar: desliga os avisos na Meta e apaga o acesso; os casos ficam; responder dá 409 MESSENGER_NAO_CONECTADO', async () => {
    await ligarConta();
    await svc.processar(aviso({ mid: 'm_d1', texto: 'oi' }));
    expect(await svc.desconectar(user('gerente'))).toEqual({ ok: true });
    expect(await q(`select 1 from messenger_conta where tenant_id = $1`, [T])).toHaveLength(0);
    expect(pedidos.some((p) => p.metodo === 'DELETE' && p.caminho === `/v27.0/${PAGINA}/subscribed_apps` && p.auth === 'Bearer tok-pagina-1')).toBe(true);
    expect(auditados).toContainEqual(expect.objectContaining({ acao: 'messenger_desconectado' }));
    const [caso] = await casos();
    expect(caso).toBeTruthy();
    await expect(svc.responder(user('gerente'), caso.id, { texto: 'oi' })).rejects.toMatchObject({ response: { code: 'MESSENGER_NAO_CONECTADO' } });
    expect(await svc.desconectar(user('gerente'))).toEqual({ ok: true }); // de novo: nada a fazer
  });

  it('no servidor da loja: a conversa e a resposta vão à nuvem; a nuvem confere quem respondeu (a rota da loja também)', async () => {
    await ligarConta();
    await svc.processar(aviso({ mid: 'm_lj1', texto: 'oi' }));
    const [caso] = await casos();
    const nuvem: Server = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', consulta: {}, auth: req.headers['x-sync-token'] as string, corpo: corpo ? JSON.parse(corpo) : null });
        res.setHeader('content-type', 'application/json');
        if (req.method === 'POST') {
          res.statusCode = 409;
          return res.end(JSON.stringify({ statusCode: 409, code: 'FORA_DA_JANELA', message: 'Passaram 24 h' }));
        }
        res.end(JSON.stringify({ daNuvem: true }));
      });
    });
    const sq = new Set<Socket>();
    nuvem.on('connection', (s) => (sq.add(s), s.on('close', () => sq.delete(s))));
    await new Promise<void>((ok) => nuvem.listen(0, '127.0.0.1', () => ok()));
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(nuvem.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-do-servidor';
      pedidos.length = 0;
      expect(await svc.conversa(T, caso.id)).toEqual({ daNuvem: true });
      const err: any = await svc.responder(user('supervisao', 'sara'), caso.id, { texto: 'Oi!' }).catch((x) => x);
      expect(err.getResponse()).toMatchObject({ code: 'FORA_DA_JANELA' }); // o `code` da nuvem segue até a tela da loja
      const aNuvem = pedidos.filter((p) => p.caminho.startsWith('/api/v1/'));
      expect(aNuvem.map((p) => [p.metodo, p.caminho, p.auth])).toEqual([
        ['GET', `/api/v1/atendimento/messenger-da-loja?chamado=${caso.id}`, 'token-do-servidor'],
        ['POST', '/api/v1/atendimento/messenger-da-loja', 'token-do-servidor'],
      ]);
      expect(aNuvem[1].corpo).toEqual({ chamadoId: caso.id, texto: 'Oi!', atorId: pessoa.sara, atorPerfil: 'supervisao' });
      // Os ajustes e o login são só da nuvem: no servidor da loja o Messenger não está disponível.
      expect(svc.disponivel()).toBe(false);
      expect(await svc.semResposta()).toBe(0);
    } finally {
      delete process.env.EDGE_MODE;
      delete process.env.CLOUD_API;
      delete process.env.SYNC_TOKEN;
      for (const s of sq) s.destroy();
      await new Promise<void>((ok) => nuvem.close(() => ok()));
    }
    // A nuvem, recebendo da loja (a rota pelo token do servidor): execução, outra empresa e id torto não respondem.
    const loja = new AtendimentoLojaController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, svc);
    const ctx = { tenantId: T } as any;
    for (const atorId of [pessoa.edu, pessoa.gil, 'nao-e-uuid'])
      await expect(loja.responderMessengerDaLoja(ctx, { chamadoId: caso.id, texto: 'x', atorId })).rejects.toThrow(ForbiddenException);
    expect(await loja.responderMessengerDaLoja(ctx, { chamadoId: caso.id, texto: 'Oi da loja', atorId: pessoa.sara })).toMatchObject({ ok: true });
    expect(((await loja.messengerDaLoja(ctx, caso.id)) as any).mensagens.map((m: any) => m.autor)).toEqual(['cliente', 'equipe']);
    await expect(loja.messengerDaLoja({ tenantId: T2 } as any, caso.id)).rejects.toThrow(NotFoundException);
  });

  // ───── o robô: "chamar atendente", as consultas e as rotas que recusam fb: ─────

  it('"chamar atendente": o caso do Messenger com o resumo e a posição, e UM "já chamei" (V83, pelo serviço de verdade)', async () => {
    await ligarConta({ robo: true });
    await svc.processar(aviso({ mid: 'm_h1', texto: 'Quero fazer uma encomenda para 15 pessoas' }));
    const r: any = await cardapio.abrirAtendimento(
      tok(),
      {
        tipo: 'humano',
        telefone: `fb:${PSID}`,
        conversa: assinarConversaDoMessenger(T, PSID),
        mensagem: 'Motivo: encomenda\nQuer: pedido para 15 pessoas no sábado\nJá fiz: mandei o cardápio',
      },
      SENHA,
    );
    expect(r).toMatchObject({ ok: true, posicao: 1, comAlguem: false });
    const [c] = await casos();
    expect(c).toMatchObject({ status: 'aberto', tipo: 'messenger', canal: 'messenger', telefone: null, prioridade: 'normal' });
    expect(c.detalhe.robo).toMatchObject({ motivo: 'encomenda', quer: 'pedido para 15 pessoas no sábado' });
    expect(c.detalhe.messenger).toMatchObject({ psid: PSID, abertoPeloRobo: true, avisoLiberado: true });
    expect((await q(`select chamado_id from messenger_mensagem where mid = 'm_h1'`))[0].chamado_id).toBe(c.id);
    expect(eventos.some((e) => e.nome === 'atendimento.novo' && e.dados.chamado.id === c.id)).toBe(true);
    expect(await responderComoRobo('Já chamei a equipe: você é a 1ª da fila.')).toMatchObject({ enviado: true });
    expect(await responderComoRobo('Mais alguma coisa?')).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    expect(envios()).toHaveLength(1);
    // Chamar de novo com o cliente irritado: soma ao caso e a prioridade sobe.
    const r2: any = await cardapio.abrirAtendimento(tok(), { tipo: 'erro', telefone: `fb:${PSID}`, conversa: assinarConversaDoMessenger(T, PSID), urgente: true }, SENHA);
    expect(r2.id).toBe(c.id);
    expect((await casos())[0].prioridade).toBe('urgente');
    expect(await casos()).toHaveLength(1);
  });

  it('fornecedor em "recado" (mig 381): o RECADO PARA O RESPONSÁVEL no Messenger — a marca, o resumo, o texto ao cliente — e o robô SEGUE respondendo', async () => {
    await ligarConta({ robo: true });
    await q(`update robo_config set atendente_assuntos = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ fornecedor: { modo: 'recado' } })]);
    await svc.processar(aviso({ mid: 'm_rr1', texto: 'Boa tarde! Sou da Embalagens Rio. Com quem falo sobre compras?' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    const ficha = assinarConversaDoMessenger(T, PSID);
    const msg = 'Assunto: caixas personalizadas\nQuem: Paulo Mendes, Embalagens Rio\nContato: (21) 3333-0000\nJá fiz: agradeci';
    const r: any = await cardapio.abrirAtendimento(tok(), { tipo: 'fornecedor', telefone: `fb:${PSID}`, conversa: ficha, mensagem: msg }, SENHA);
    expect(r).toMatchObject({ ok: true, prioridade: 'normal', paraOResponsavel: true, assunto: 'fornecedor', posicao: null, comAlguem: false });
    expect(r.paraOCliente).toMatch(/responsável/);
    const [c] = await casos();
    expect(c).toMatchObject({ id: r.id, tipo: 'messenger', canal: 'messenger', prioridade: 'normal', status: 'aberto' });
    expect(c.detalhe.responsavel).toEqual({ assunto: 'fornecedor', em: expect.any(String) });
    expect(c.detalhe.robo).toMatchObject({ assunto: 'caixas personalizadas', quem: 'Paulo Mendes, Embalagens Rio', contato: '(21) 3333-0000' });
    expect((await q(`select chamado_id from messenger_mensagem where mid = 'm_rr1'`))[0].chamado_id).toBe(c.id);
    expect(eventos.filter((e) => e.nome === 'atendimento.novo')).toEqual([]); // não toca: a tela só relê a fila
    // O robô manda o texto e continua respondendo; a mensagem nova vai ao robô e entra no recado.
    expect(await responderComoRobo(r.paraOCliente)).toMatchObject({ enviado: true });
    expect(await responderComoRobo('Posso ajudar com mais alguma coisa?')).toMatchObject({ enviado: true });
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'm_rr2', texto: 'Obrigado! Vocês têm o cardápio?' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    expect((await q(`select chamado_id from messenger_mensagem where mid = 'm_rr2'`))[0].chamado_id).toBe(c.id);
    // Chamar de novo pelo mesmo assunto: o mesmo recado.
    const r2: any = await cardapio.abrirAtendimento(tok(), { tipo: 'fornecedor', telefone: `fb:${PSID}`, conversa: ficha, mensagem: 'Já fiz: de novo' }, SENHA);
    expect(r2).toMatchObject({ id: c.id, paraOResponsavel: true });
    expect(await casos()).toHaveLength(1);
  });

  it('fora do horário da equipe (mig 379): o "chamar atendente" deixa RECADO com a frase para o cliente (sem posição); o robô desligado com a fila também vira recado', async () => {
    const FUSO = 'America/Sao_Paulo';
    const daqui3 = new Date(Date.now() + 3 * 86_400_000);
    const semanaSp = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(daqui3));
    const VOLTA = new Date(`${daqui3.toLocaleDateString('en-CA', { timeZone: FUSO })}T09:30:00-03:00`); // 30 min antes das 10:00
    await q(`update robo_config set equipe_atende = 'loja' where tenant_id = $1`, [T]);
    await q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [CARD, JSON.stringify([{ dia: semanaSp, ativo: true, abre: '10:00', fecha: '11:00' }])]);
    try {
      await ligarConta({ robo: true });
      await svc.processar(aviso({ mid: 'm_fh1', texto: 'O lanche de ontem veio sem o molho' }));
      const r: any = await cardapio.abrirAtendimento(tok(), { tipo: 'erro', telefone: `fb:${PSID}`, conversa: assinarConversaDoMessenger(T, PSID), mensagem: 'Motivo: faltou o molho' }, SENHA);
      expect(r).toMatchObject({ ok: true, foraDoHorario: true, posicao: null, comAlguem: false });
      expect(r.paraOCliente).toMatch(/^Nossa equipe volta (na|no) .+ às 09:30\. Já deixei o seu recado aqui/);
      const [c] = await casos();
      expect(c.detalhe.recado.ate).toBe(VOLTA.toISOString());
      // O robô desligado e a fila ligada: a conversa nova de outro cliente vira recado (não toca agora).
      await ligarRobo(false);
      await svc.processar(aviso({ mid: 'm_fh2', texto: 'Oi, boa noite', psid: '7700000000000077' }));
      const [c2] = await casos('7700000000000077');
      expect(c2.detalhe.recado).toMatchObject({ ate: VOLTA.toISOString() });
    } finally {
      await q(`update robo_config set equipe_atende = 'sempre' where tenant_id = $1`, [T]);
      await q(`update cardapio_config set horarios = '[]'::jsonb where id = $1`, [CARD]);
    }
  });

  it('"chamar atendente" sem a ficha do Messenger, com a do telefone, a do Direct ou de outro cliente/empresa: 401 — nunca cai no caminho do telefone', async () => {
    await ligarConta({ robo: true });
    const t = tok();
    for (const conversa of [undefined, assinarConversa(T, '5521999998888'), assinarConversaDoDirect(T, PSID), assinarConversaDoMessenger(T, '7700000000000099'), assinarConversaDoMessenger(T2, PSID)])
      await expect(cardapio.abrirAtendimento(t, { tipo: 'humano', telefone: `fb:${PSID}`, conversa }, SENHA)).rejects.toThrow(UnauthorizedException);
    await expect(cardapio.abrirAtendimento(t, { tipo: 'humano', telefone: 'fb:abc', conversa: assinarConversaDoMessenger(T, PSID) }, SENHA)).rejects.toThrow(UnauthorizedException);
    expect(await q(`select id from atendimento_chamado where tenant_id = $1`, [T])).toHaveLength(0);
  });

  it('as consultas do robô pela chave `fb:`: o cardápio do robô e as instruções do Messenger — só com o robô ligado', async () => {
    await ligarConta({ robo: true });
    expect(await cardapio.tokenDaLojaDoRobo(SENHA, `fb:${PAGINA}`, '')).toBe(tok());
    const consultas = new RoboConsultasController(cardapio);
    await q(`update robo_config set atendente_perfis = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ messenger: { perfil: 'objetivo' }, direct: { perfil: 'gentil' } })]);
    const r: any = await consultas.instrucoes('2', `fb:${PAGINA}`, '', undefined, SENHA);
    expect(r).toMatchObject({ versao: VERSAO_DO_MESSENGER, canal: 'messenger', fluxo: 2 });
    expect(r.texto.startsWith('Você atende os clientes da Burger da Praça no Messenger do Facebook. Converse como uma pessoa da equipe.\n\nPERFIL DE ATENDIMENTO (escolhido pela loja): OBJETIVO.')).toBe(true);
    expect(r.texto).not.toContain('GENTIL');
    await q(`update robo_config set atendente_assuntos = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ fornecedor: { modo: 'recado' } })]);
    const comAssuntos: any = await consultas.instrucoes('1', `fb:${PAGINA}`, '', undefined, SENHA);
    expect(comAssuntos.texto).toContain('se ela preferir, pode ser por aqui no Messenger');
    await ligarRobo(false);
    await expect(cardapio.tokenDaLojaDoRobo(SENHA, `fb:${PAGINA}`, '')).rejects.toThrow('robô ligado');
    await ligarRobo(true);
    const [{ id: outro }] = await q(`insert into cardapio_config (tenant_id, token, ativo, unidade_id) values ($1, $2, true, gen_random_uuid()) returning id`, [T, `tok-msgr-b-${T.slice(0, 8)}`]);
    await expect(cardapio.tokenDaLojaDoRobo(SENHA, `fb:${PAGINA}`, '')).rejects.toThrow('robô ligado'); // dois e nenhum escolhido
    await q(`update messenger_conta set cardapio_id = $2 where tenant_id = $1`, [T, outro]);
    expect(await cardapio.tokenDaLojaDoRobo(SENHA, `fb:${PAGINA}`, '')).toBe(`tok-msgr-b-${T.slice(0, 8)}`);
    await expect(cardapio.tokenDaLojaDoRobo('senha-errada', `fb:${PAGINA}`, '')).rejects.toThrow('autorizado');
  });

  it('as rotas de TELEFONE e de ENVIO recusam `fb:` (V79): pedidos, situação, resolver, link do cliente, pedido na conversa, cloud/enviar e cloud/template', async () => {
    await ligarConta({ robo: true });
    const whats = new WhatsappService(db);
    await q(`update cardapio_config set wa_cloud_phone_id = 'PID-MSGR-1' where id = $1`, [CARD]);
    await q(`insert into pedido_externo (tenant_id, canal, cliente_telefone) values ($1, 'cardapio', $2)`, [T, `219${PSID.slice(-8)}`]);
    try {
      await expect(whats.pedidosPorTelefoneBot(`fb:${PAGINA}`, SENHA, `fb:${PSID}`, '')).rejects.toThrow('não vinculado');
      expect(await whats.pedidosPorTelefoneBot('', SENHA, `fb:${PSID}`, 'PID-MSGR-1')).toEqual([]);
      expect((await whats.pedidosPorTelefoneBot('', SENHA, `219${PSID.slice(-8)}`, 'PID-MSGR-1')).length).toBe(1); // o telefone de verdade acha
      await expect(whats.statusPedidoBot(`fb:${PAGINA}`, SENHA, `fb:${PSID}`, '12', '')).rejects.toThrow('não vinculado');
      await expect(whats.resolver(`fb:${PAGINA}`, SENHA, PSID)).rejects.toThrow('não vinculada');
      const clientes = new ClienteService(db, {} as any, { registrar: async () => {} } as any);
      await expect(clientes.criarLink(tok(), { telefone: `fb:${PSID}` }, SENHA)).rejects.toThrow('No Messenger do Facebook não há link do cliente');
      expect(await q(`select id from cliente where tenant_id = $1`, [T])).toHaveLength(0);
      const cloud = new WhatsappCloudService(db);
      await expect(cloud.enviarPeloBot(SENHA, 'PID-MSGR-1', `fb:${PSID}`, 'oi')).rejects.toThrow(RECUSA_NO_MESSENGER);
      await expect(cloud.enviarTemplatePeloBot(SENHA, 'PID-MSGR-1', `fb:${PSID}`, 'pedido_pronto', 'pt_BR', [])).rejects.toThrow(RECUSA_NO_MESSENGER);
      // As rotas do pedido na conversa: a ficha do Messenger não é a do telefone — 401, nada montado.
      const pedido = new RoboPedidoController(new RoboPedidoService(db, cardapio, {} as any, {} as any));
      await expect(pedido.ver({ instancia: `fb:${PAGINA}` }, SENHA, assinarConversaDoMessenger(T, PSID) as string)).rejects.toThrow(UnauthorizedException);
    } finally {
      await q(`update cardapio_config set wa_cloud_phone_id = null where id = $1`, [CARD]);
      await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    }
  });

  it('a rotina "sem resposta": a conversa em que o cliente espera há mais de 3 min vira caso — 110 que não contam na frente; duas rodadas = um caso (V42/V84)', async () => {
    await ligarConta({ robo: true });
    await q(
      `insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, texto, mid, estado, criado_em)
       select $1, $2, (7600000000000000 + g)::text, d.direcao, d.autor, 'x', 'm_' || g || '_' || d.autor, d.estado, now() - interval '10 minutes' + d.depois
         from generate_series(1, 110) g
         cross join (values ('entrada', 'cliente', 'recebida', interval '0'), ('saida', 'robo', 'enviada', interval '1 minute')) d(direcao, autor, estado, depois)`,
      [T, PAGINA],
    );
    await q(
      `insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, texto, mid, estado, criado_em) values ($1, $2, '7600000000099999', 'entrada', 'cliente', 'recente', 'm_rec', 'recebida', now() - interval '1 minute')`,
      [T, PAGINA],
    );
    const [msg] = await q(
      `insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, texto, mid, estado, criado_em) values
         ($1, $2, $3, 'entrada', 'cliente', 'Alguém aí?', 'm_sr1', 'recebida', now() - interval '5 minutes') returning id`,
      [T, PAGINA, PSID],
    );
    await q(
      `insert into messenger_mensagem (tenant_id, pagina_id, psid, direcao, autor, texto, estado, criado_em) values ($1, $2, $3, 'saida', 'robo', 'Oi', 'falhou', now() - interval '4 minutes')`,
      [T, PAGINA, PSID],
    );
    expect(await svc.semResposta()).toBe(1);
    expect(await svc.semResposta()).toBe(0);
    const [c] = await casos();
    expect(c).toMatchObject({ id: uuidDeChave('messenger-sem-resposta', T, msg.id), mensagem: 'Alguém aí?', tipo: 'messenger' });
    expect(c.detalhe.messenger).toMatchObject({ semResposta: true });
    expect(await q(`select id from atendimento_chamado where tenant_id = $1`, [T])).toHaveLength(1);
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await ligarRobo(false);
    expect(await svc.semResposta()).toBe(0); // robô desligado: a fila já cuidou
  });

  // ───── Conversas agora, Assumir e os ajustes ─────

  it('"Conversas agora": o Messenger com o robô aparece para a gestão e some depois do "Assumir"; a execução não vê nem assume', async () => {
    await ligarConta({ robo: true });
    await q(`insert into messenger_contato (tenant_id, psid, nome) values ($1, $2, 'Lívia Ramos')`, [T, PSID]);
    await svc.processar(aviso({ mid: 'm_ca1', texto: 'Entregam na Penha?' }));
    await responderComoRobo('Entregamos! A taxa é R$ 6,00.');
    const gestao = { ...user('gerente'), permissoes: {} };
    const r: any = await chat.conversasAgora(T, null, gestao);
    expect(r.messenger).toEqual({ ligado: true, lida: true });
    const c = r.conversas.find((x: any) => x.canal === 'messenger');
    expect(c).toMatchObject({ chave: `fb:${PSID}`, cliente: 'Lívia Ramos', comRobo: true, pedidoId: null });
    expect(c.mensagens.map((m: any) => m.autor)).toEqual(['cliente', 'robo']);
    const exec = { ...user('execucao', 'edu'), permissoes: {} };
    const daExecucao: any = await chat.conversasAgora(T, null, exec);
    expect(daExecucao.messenger).toBeNull();
    expect(daExecucao.conversas.some((x: any) => x.canal === 'messenger')).toBe(false);
    await expect(chat.assumir(exec, { canal: 'messenger', chave: `fb:${PSID}` })).rejects.toThrow(ForbiddenException);
    await expect(chat.assumir(gestao, { canal: 'messenger', chave: 'fb:torto' })).rejects.toThrow(BadRequestException);
    const a: any = await chat.assumir(gestao, { canal: 'messenger', chave: `fb:${PSID}` });
    const [caso] = await casos();
    expect(caso).toMatchObject({ id: a.id, responsavel_id: pessoa.ana, cliente: 'Lívia Ramos', mensagem: 'Entregam na Penha?' });
    expect(caso.detalhe).toMatchObject({ assumida: true, messenger: { psid: PSID } });
    expect(((await chat.conversasAgora(T, null, gestao)) as any).conversas.some((x: any) => x.canal === 'messenger')).toBe(false);
    // Assumida: a mensagem seguinte entra no caso e não vai ao robô; outra pessoa que tenta assumir recebe 409.
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'm_ca2', texto: 'E até que horas?' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    await expect(chat.assumir({ ...user('supervisao', 'sara'), permissoes: {} }, { canal: 'messenger', chave: `fb:${PSID}` })).rejects.toThrow(ConflictException);
    // Do servidor da loja, a nuvem confere quem assume (outra empresa = recusa) e "Conversas agora" traz o Messenger.
    await expect(chat.assumirVindoDaLoja(T, { canal: 'messenger', chave: `fb:${PSID}`, atorId: pessoa.gil, atorPerfil: 'gerente' })).rejects.toThrow();
    expect(((await chat.conversasVindoDaLoja(T, { categoria: 'gerente' })) as any).messenger).toEqual({ ligado: true, lida: true });
  });

  it('"Conversas agora" num banco SEM as tabelas do Messenger: o Messenger não está ligado e o resto segue; outra falha vem como "não li" (ERR-393)', async () => {
    const dialeto = new PgDialect();
    const comFalha = (codigo: string) =>
      new Proxy(db, {
        get(alvo: any, nome) {
          if (nome !== 'execute') return alvo[nome];
          return (consulta: any) =>
            /messenger_/.test(dialeto.sqlToQuery(consulta).sql) ? Promise.reject(Object.assign(new Error('falha de teste'), { code: codigo })) : alvo.execute(consulta);
        },
      });
    const gestao = { ...user('gerente'), permissoes: {} };
    for (const [codigo, esperado] of [['42P01', { ligado: false, lida: true }], ['57014', { ligado: true, lida: false }]] as const) {
      const bd = comFalha(codigo);
      const r: any = await new ChatDoCasoService(bd, { emit: () => true } as any, {} as any, undefined, undefined, new MessengerService(bd, { emit: () => true } as any)).conversasAgora(
        T,
        null,
        gestao,
      );
      expect(r.messenger).toEqual(esperado);
      expect(Array.isArray(r.conversas)).toBe(true);
    }
    // Os ajustes num banco sem a 386: o grupo vem com a conta nula (não derruba a tela).
    const semTabela = new Proxy(db, {
      get(alvo: any, nome) {
        if (nome !== 'execute') return alvo[nome];
        return (consulta: any) =>
          /to_regclass/.test(dialeto.sqlToQuery(consulta).sql) ? Promise.resolve({ rows: [{ tem: false }] }) : alvo.execute(consulta);
      },
    });
    const sem = new MessengerService(semTabela, { emit: () => true } as any);
    expect(await sem.ajuste(T)).toMatchObject({ conta: null, escolhaPendente: false, cardapios: [{ id: CARD, nome: 'Burger da Praça', ativo: true }] });
    expect(await sem.cardapioDaConta(`fb:${PAGINA}`)).toBeNull();
    await expect(sem.conferirAjuste(T, { filaLigada: true })).rejects.toThrow('ainda não está liberado');
    // A rotina "sem resposta" num banco sem a 386 (42P01): nada, sem derrubar a rotina.
    expect(await new MessengerService(comFalha('42P01'), { emit: () => true } as any).semResposta()).toBe(0);
  });

  it('os ajustes pela rota: o grupo `messenger`; liga/desliga com booleano (ausente fica); o robô só liga com página, robô liberado e cardápio; a recusa vem antes de gravar qualquer grupo (V86)', async () => {
    const nulo = () => new Proxy({}, { get: () => async () => null });
    const ctl = new AtendimentoController(
      nulo() as any, nulo() as any, nulo() as any, nulo() as any, fila, nulo() as any, nulo() as any, nulo() as any, nulo() as any, nulo() as any,
      undefined, undefined, undefined, undefined, undefined, svc,
    );
    const g = user('gerente');
    // Sem página: o grupo vem com a conta nula e o robô não liga.
    const a0: any = await ctl.ajustes(g, null);
    expect(a0.messenger).toMatchObject({ disponivel: true, roboDisponivel: true, conta: null, escolhaPendente: false });
    expect(a0.perfis.messenger).toEqual({ perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null });
    await expect(ctl.salvarAjustes(g, null, { messenger: { roboResponde: true } })).rejects.toThrow('Conecte a página do Facebook');
    await ligarConta();
    // V86: a recusa do Messenger vem antes de gravar o perfil.
    await expect(ctl.salvarAjustes(g, null, { perfis: { messenger: { perfil: 'gentil' } }, messenger: { roboResponde: 'sim' } })).rejects.toThrow(BadRequestException);
    expect((await q(`select atendente_perfis from robo_config where tenant_id = $1`, [T]))[0].atendente_perfis).toEqual({});
    await expect(ctl.salvarAjustes(g, null, { messenger: { cardapioId: CARD2 } })).rejects.toThrow('não é desta empresa');
    await expect(ctl.salvarAjustes(g, null, { messenger: { cardapioId: 'nao-e-uuid' } })).rejects.toThrow('cardápio');
    await expect(ctl.salvarAjustes(g, null, { messenger: 'ligado' })).rejects.toThrow('ajuste inválido');
    // O robô indisponível na distribuição.
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    await expect(ctl.salvarAjustes(g, null, { messenger: { roboResponde: true } })).rejects.toThrow('ainda não está liberado');
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    // Dois cardápios e nenhum escolhido: o robô não liga; escolhido (e ativo), liga.
    const [{ id: outro }] = await q(`insert into cardapio_config (tenant_id, token, ativo, unidade_id) values ($1, $2, true, gen_random_uuid()) returning id`, [T, `tok-msgr-c-${T.slice(0, 8)}`]);
    await expect(ctl.salvarAjustes(g, null, { messenger: { roboResponde: true } })).rejects.toThrow('Escolha o cardápio');
    const r: any = await ctl.salvarAjustes(g, null, { messenger: { roboResponde: 'true', cardapioId: outro }, perfis: { messenger: { perfil: 'gentil' } } });
    expect(r.messenger.conta).toMatchObject({ roboResponde: true, cardapioId: outro, filaLigada: true }); // a fila não veio: fica (V16)
    expect(r.perfis.messenger).toEqual({ perfil: 'gentil', foraDoHorario: 'mesmo', jeito: null });
    expect(auditados.map((x) => x.acao)).toEqual(expect.arrayContaining(['robo_no_messenger_ligado', 'cardapio_do_robo_no_messenger', 'atendente_perfil_alterado']));
    auditados.length = 0;
    const r2: any = await ctl.salvarAjustes(g, null, { messenger: { filaLigada: false } });
    expect(r2.messenger.conta).toMatchObject({ roboResponde: true, filaLigada: false });
    expect(auditados.map((x) => x.acao)).toEqual(['messenger_na_fila_desligado']);
    auditados.length = 0;
    await ctl.salvarAjustes(g, null, { messenger: { filaLigada: false } }); // nada mudou: nada na auditoria
    expect(auditados).toEqual([]);
    // Desligar sempre pode (mesmo com o robô indisponível).
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    expect(((await ctl.salvarAjustes(g, null, { messenger: { roboResponde: false } })) as any).messenger.conta.roboResponde).toBe(false);
    await q(`delete from cardapio_config where id = $1`, [outro]);
    expect(((await ctl.ajustes(g, null)) as any).messenger.conta.cardapioId).toBeNull(); // apagar o cardápio deixa vazio
  });
});
