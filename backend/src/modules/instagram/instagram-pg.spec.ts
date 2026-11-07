import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { decifrar } from '../../common/cifra-segredo';
import { InstagramService } from './instagram.service';
import { NumerosDoAtendimentoService } from '../atendimento/numeros.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// INSTAGRAM DIRECT (mig 377), contra o Postgres real e uma META DE MENTIRA local (nada sai para fora): conectar (o state,
// o acesso longo CIFRADO, o aviso ligado; quem não é gestão; a conta em outra empresa; o cancelado), o aviso de mensagem
// (o caso aberto, o repetido, o eco, a apagada, dois avisos juntos do mesmo cliente = um caso só, a fila desligada, a
// conta que não está conectada), o perfil do cliente, a conversa, a resposta (dentro da janela, pega o caso; fora dela,
// recusada; quem não é gestão; o erro da Meta fica na conversa), a renovação do acesso, desconectar, o servidor da loja
// pedindo à nuvem (V37) e o placar dos Números.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('instagram-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const CONTA = '17841400000000001';
const CLIENTE = '99887766554433';

descrever('Instagram Direct (Postgres + Meta de mentira)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let svc: InstagramService;
  let meta: Server;
  const soquetes = new Set<Socket>();
  const pedidos: Array<{ metodo: string; caminho: string; consulta: Record<string, string>; auth: string | undefined; corpo: string }> = [];
  const eventos: Array<{ nome: string; dados: any }> = [];
  const auditados: any[] = [];
  const pessoa: Record<string, string> = {};
  let contaDaVez = CONTA;
  let falharEnvio = false;
  let falharRenovar = false;
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
  const aviso = (o: { mid: string; texto?: string; eco?: boolean; apagada?: boolean; cliente?: string; conta?: string; em?: number }) => ({
    object: 'instagram',
    entry: [
      {
        id: o.conta ?? CONTA,
        time: Date.now(),
        messaging: [
          {
            sender: { id: o.eco ? (o.conta ?? CONTA) : (o.cliente ?? CLIENTE) },
            recipient: { id: o.eco ? (o.cliente ?? CLIENTE) : (o.conta ?? CONTA) },
            timestamp: o.em ?? Date.now(),
            message: { mid: o.mid, ...(o.texto ? { text: o.texto } : {}), ...(o.eco ? { is_echo: true } : {}), ...(o.apagada ? { is_deleted: true } : {}) },
          },
        ],
      },
    ],
  });
  const conectar = async (tenant = T, quem = pessoa.ana, codigo = 'codigo-bom') => {
    const urlLogin = new URL((svc.conectar({ tenantId: tenant, colaboradorId: quem, categoria: 'gerente' } as any) as any).url);
    return svc.retorno({ code: `${codigo}#_`, state: urlLogin.searchParams.get('state') ?? '' });
  };
  const casosDoCliente = (cliente = CLIENTE) =>
    q(`select id, status, cliente, mensagem, responsavel_id, pego_em, detalhe from atendimento_chamado where tenant_id = $1 and tipo = 'instagram' and detalhe #>> '{instagram,igsid}' = $2`, [T, cliente]);
  const esperar = async (fn: () => Promise<boolean>) => {
    for (let i = 0; i < 40; i++) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql', '377_instagram_direct.sql', '378_instagram_robo_no_direct.sql']) await aplicar(m);
    meta = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        const u = new URL(req.url ?? '/', 'http://x');
        pedidos.push({ metodo: req.method ?? '', caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), auth: req.headers.authorization, corpo });
        const j = (s: number, b: any) => {
          res.statusCode = s;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(b));
        };
        if (req.method === 'POST' && u.pathname === '/oauth/access_token') {
          const f = new URLSearchParams(corpo);
          if (f.get('code') !== 'codigo-bom') return j(400, { error_type: 'OAuthException', code: 400, error_message: 'Matching code was not found or was already used' });
          return j(200, { data: [{ access_token: 'curto-1', user_id: contaDaVez, permissions: 'instagram_business_basic,instagram_business_manage_messages' }] });
        }
        if (u.pathname === '/access_token') return j(200, { access_token: 'longo-1', token_type: 'bearer', expires_in: 5184000 });
        if (u.pathname === '/refresh_access_token') return falharRenovar ? j(400, { error: { message: 'Invalid OAuth access token', code: 190 } }) : j(200, { access_token: 'longo-2', expires_in: 5184000 });
        if (u.pathname === '/v27.0/me') return j(200, { id: 'id-do-app', user_id: contaDaVez, username: 'burgerdapraca', name: 'Burger da Praça' });
        if (u.pathname.endsWith('/subscribed_apps')) return j(200, { success: true });
        if (req.method === 'POST' && u.pathname.endsWith('/messages')) {
          if (falharEnvio) return j(400, { error: { message: '(#10) This message is sent outside of allowed window.', code: 10 } });
          return j(200, { recipient_id: CLIENTE, message_id: `mid-resp-${++nMid}` });
        }
        if (req.method === 'GET' && u.pathname.startsWith('/v27.0/')) return j(200, { name: 'Joana Souza', username: 'joana.souza', is_user_follow_business: true });
        return j(404, { error: { message: 'rota desconhecida' } });
      });
    });
    meta.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => meta.listen(0, '127.0.0.1', () => ok()));
    const base = `http://127.0.0.1:${(meta.address() as AddressInfo).port}`;
    const env = {
      INSTAGRAM_APP_ID: '990602627938098',
      INSTAGRAM_APP_SECRET: 'segredo-do-app',
      INSTAGRAM_GRAPH_URL: base,
      INSTAGRAM_OAUTH_URL: base,
      INSTAGRAM_REDIRECT_URI: 'https://api.teste/api/v1/publico/instagram/retorno',
      APP_URL: 'https://app.teste',
      SEGREDOS_CHAVE: randomBytes(32).toString('base64'),
    };
    for (const [k, v] of Object.entries(env)) {
      antes[k] = process.env[k];
      process.env[k] = v;
    }
    antes.EDGE_MODE = process.env.EDGE_MODE;
    delete process.env.EDGE_MODE;
    svc = new InstagramService(db, { emit: (nome: string, dados: any) => (eventos.push({ nome, dados }), true) } as any, { registrar: async (e: any) => void auditados.push(e) } as any);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste instagram') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa instagram') returning id`);
    const funcao: Record<string, string> = {};
    for (const [t, cat] of [[T, 'gerente'], [T, 'supervisao'], [T, 'execucao'], [T2, 'gerente']] as const)
      [{ id: funcao[`${t}:${cat}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
    for (const [nome, t, cat] of [['ana', T, 'gerente'], ['sara', T, 'supervisao'], ['edu', T, 'execucao'], ['gil', T2, 'gerente']] as const)
      [{ id: pessoa[nome] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [t, nome, funcao[`${t}:${cat}`]]);
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const s of soquetes) s.destroy();
    if (meta) await new Promise<void>((ok) => meta.close(() => ok()));
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of ['instagram_mensagem', 'instagram_contato', 'instagram_conta', 'atendimento_chamado', 'colaborador', 'funcao'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    contaDaVez = CONTA;
    falharEnvio = false;
    falharRenovar = false;
    pedidos.length = 0;
    eventos.length = 0;
    for (const t of [T, T2]) for (const tab of ['instagram_mensagem', 'instagram_contato', 'instagram_conta', 'atendimento_chamado']) await q(`delete from ${tab} where tenant_id = $1`, [t]);
  });

  it('conectar: o state, o acesso longo CIFRADO, a conta e o aviso ligado; volta "conectado"', async () => {
    expect(await conectar()).toBe('https://app.teste/delivery/configuracoes?aba=atendimento&instagram=conectado');
    const troca = pedidos.find((p) => p.caminho === '/oauth/access_token')!;
    expect(Object.fromEntries(new URLSearchParams(troca.corpo))).toMatchObject({
      client_id: '990602627938098',
      client_secret: 'segredo-do-app',
      grant_type: 'authorization_code',
      redirect_uri: 'https://api.teste/api/v1/publico/instagram/retorno',
      code: 'codigo-bom', // o "#_" do fim sai (a Meta põe no endereço)
    });
    expect(pedidos.find((p) => p.caminho === '/v27.0/me')?.auth).toBe('Bearer longo-1');
    expect(pedidos.find((p) => p.caminho === `/v27.0/${CONTA}/subscribed_apps`)?.consulta).toEqual({ subscribed_fields: 'messages' });
    const [c] = await q(`select * from instagram_conta where tenant_id = $1`, [T]);
    expect(c).toMatchObject({ ig_user_id: CONTA, usuario: 'burgerdapraca', nome: 'Burger da Praça', fila_ligada: true, conectado_por: pessoa.ana });
    expect(c.token_cifrado).not.toContain('longo-1');
    expect(decifrar(c.token_cifrado)).toBe('longo-1');
    const a: any = await svc.ajuste(T);
    expect(a.disponivel).toBe(true);
    expect(a.conta).toMatchObject({ usuario: 'burgerdapraca', conectadoPor: 'ana', filaLigada: true });
    expect(JSON.stringify(a)).not.toMatch(/longo|token/i);
    expect(auditados.some((x) => x.acao === 'conectou_instagram' && x.detalhe?.usuario === 'burgerdapraca')).toBe(true);
  });

  it('conectar: state adulterado, cancelado, quem não é gestão, código ruim e a conta em outra empresa', async () => {
    expect(await svc.retorno({ code: 'codigo-bom', state: 'x.y' })).toMatch(/instagram=expirou$/);
    // O state com a forma certa (empresa e pessoa de verdade) mas sem a assinatura do segredo: não conecta nada.
    const forjado = `${Buffer.from(JSON.stringify({ t: T, c: pessoa.ana, e: Date.now() + 60_000, n: 'x' })).toString('base64url')}.assinatura-falsa`;
    expect(await svc.retorno({ code: 'codigo-bom', state: forjado })).toMatch(/instagram=expirou$/);
    expect(await q(`select 1 from instagram_conta where tenant_id = $1`, [T])).toHaveLength(0);
    const urlLogin = new URL((svc.conectar({ tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' } as any) as any).url);
    expect(await svc.retorno({ error: 'access_denied', state: urlLogin.searchParams.get('state') ?? '' })).toMatch(/instagram=cancelado$/);
    expect(await conectar(T, pessoa.edu)).toMatch(/instagram=sem-permissao$/);
    expect(await conectar(T, pessoa.ana, 'codigo-ruim')).toMatch(/instagram=erro$/);
    expect(await q(`select 1 from instagram_conta where tenant_id = $1`, [T])).toHaveLength(0);
    expect(await conectar(T)).toMatch(/conectado$/);
    expect(await conectar(T2, pessoa.gil)).toMatch(/instagram=em-outra-empresa$/); // a mesma conta do Instagram
    expect(await q(`select 1 from instagram_conta where tenant_id = $1`, [T2])).toHaveLength(0);
    // Reconectar na mesma empresa troca o acesso (não abre outra linha).
    expect(await conectar(T)).toMatch(/conectado$/);
    expect(await q(`select 1 from instagram_conta where tenant_id = $1`, [T])).toHaveLength(1);
  });

  it('o aviso: abre o caso; o repetido não entra; a segunda mensagem soma; o perfil dá o nome; o eco e a apagada', async () => {
    await conectar();
    await svc.processar(aviso({ mid: 'm1', texto: 'Vocês entregam no Centro?' }));
    await svc.processar(aviso({ mid: 'm1', texto: 'Vocês entregam no Centro?' })); // a Meta reentregou
    let casos = await casosDoCliente();
    expect(casos).toHaveLength(1);
    expect(casos[0]).toMatchObject({ status: 'aberto', mensagem: 'Vocês entregam no Centro?' });
    expect(eventos.filter((e) => e.nome === 'atendimento.novo')).toHaveLength(1);
    expect(await esperar(async () => (await casosDoCliente())[0]?.cliente === 'Joana Souza')).toBe(true);
    expect((await casosDoCliente())[0].detalhe.instagram).toMatchObject({ igsid: CLIENTE, usuario: 'joana.souza', nome: 'Joana Souza' });
    await svc.processar(aviso({ mid: 'm2', texto: 'Quero fazer um pedido grande pra sábado' }));
    casos = await casosDoCliente();
    expect(casos).toHaveLength(1);
    expect(casos[0].mensagem).toBe('Quero fazer um pedido grande pra sábado');
    // O eco: a loja respondeu no app do Instagram — entra na conversa como "loja", sem caso novo.
    await svc.processar(aviso({ mid: 'm3', texto: 'Oi! Entregamos sim', eco: true }));
    await svc.processar(aviso({ mid: 'm2', apagada: true }));
    const msgs = await q(`select mid, autor, direcao, estado, chamado_id from instagram_mensagem where tenant_id = $1 order by criado_em`, [T]);
    expect(msgs.map((m) => [m.mid, m.autor, m.direcao, m.estado])).toEqual([
      ['m1', 'cliente', 'entrada', 'recebida'],
      ['m2', 'cliente', 'entrada', 'apagada'],
      ['m3', 'loja', 'saida', 'enviada'],
    ]);
    expect(msgs[0].chamado_id).toBe(casos[0].id);
    const depois = await casosDoCliente();
    expect(depois).toHaveLength(1);
    // O eco não é o cliente: não troca a frase do caso.
    expect(depois[0].mensagem).toBe('Quero fazer um pedido grande pra sábado');
  });

  it('dois avisos juntos do mesmo cliente novo: um caso só (a trava da conta)', async () => {
    await conectar();
    await Promise.all([1, 2, 3].map((n) => svc.processar(aviso({ mid: `j${n}`, texto: `oi ${n}`, cliente: '555' }))));
    const casos = await casosDoCliente('555');
    expect(casos).toHaveLength(1);
    expect(await q(`select count(*)::int as n from instagram_mensagem where tenant_id = $1 and igsid = '555' and chamado_id = $2`, [T, casos[0].id])).toEqual([{ n: 3 }]);
  });

  it('fila desligada guarda a mensagem sem abrir caso; conta que não está conectada: nada', async () => {
    await conectar();
    await q(`update instagram_conta set fila_ligada = false where tenant_id = $1`, [T]);
    await svc.processar(aviso({ mid: 'f1', texto: 'oi' }));
    expect(await casosDoCliente()).toHaveLength(0);
    expect(await q(`select count(*)::int as n from instagram_mensagem where tenant_id = $1`, [T])).toEqual([{ n: 1 }]);
    await svc.processar(aviso({ mid: 'f2', texto: 'oi', conta: 'conta-desconhecida' }));
    expect(await q(`select count(*)::int as n from instagram_mensagem where mid = 'f2'`)).toEqual([{ n: 0 }]);
  });

  it('a conversa e a resposta: dentro da janela sai pela Meta, pega o caso e o eco não repete; fora dela, recusada', async () => {
    await conectar();
    await svc.processar(aviso({ mid: 'r1', texto: 'Vocês entregam?' }));
    const [caso] = await casosDoCliente();
    const ana = { tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' } as any;
    const conv: any = await svc.conversa(T, caso.id);
    expect(conv).toMatchObject({ conta: 'burgerdapraca', conectada: true, janela: { aberta: true } });
    expect(conv.mensagens.map((m: any) => m.texto)).toEqual(['Vocês entregam?']);
    expect(await svc.responder(ana, caso.id, { texto: '  Entregamos sim!  ' })).toMatchObject({ ok: true, mid: 'mid-resp-1' });
    const envio = pedidos.find((p) => p.metodo === 'POST' && p.caminho === `/v27.0/${CONTA}/messages`)!;
    expect(envio.auth).toBe('Bearer longo-1');
    expect(JSON.parse(envio.corpo)).toEqual({ recipient: { id: CLIENTE }, message: { text: 'Entregamos sim!' } });
    await svc.processar(aviso({ mid: 'mid-resp-1', texto: 'Entregamos sim!', eco: true })); // o eco da própria resposta
    const saidas = await q(`select autor, autor_id, estado from instagram_mensagem where tenant_id = $1 and direcao = 'saida'`, [T]);
    expect(saidas).toEqual([{ autor: 'equipe', autor_id: pessoa.ana, estado: 'enviada' }]);
    expect((await casosDoCliente())[0]).toMatchObject({ responsavel_id: pessoa.ana });
    expect(auditados.some((x) => x.acao === 'respondeu_instagram' && x.entidadeId === caso.id && JSON.stringify(x.detalhe) === '{}')).toBe(true);
    // Quem não é gestão; o texto longo demais; o erro da Meta fica na conversa.
    await expect(svc.responder({ ...ana, colaboradorId: pessoa.edu, categoria: 'execucao' }, caso.id, { texto: 'oi' })).rejects.toThrow('gestão');
    await expect(svc.responder(ana, caso.id, { texto: 'ã'.repeat(501) })).rejects.toThrow('longa demais');
    falharEnvio = true;
    await expect(svc.responder(ana, caso.id, { texto: 'mais uma' })).rejects.toThrow('O Instagram não aceitou a mensagem');
    expect(await q(`select estado, erro from instagram_mensagem where tenant_id = $1 and texto = 'mais uma'`, [T])).toEqual([
      { estado: 'falhou', erro: '(#10) This message is sent outside of allowed window.' },
    ]);
    falharEnvio = false;
    // 25 h depois da última mensagem do cliente: fechado.
    await q(`update instagram_mensagem set criado_em = now() - interval '25 hours' where tenant_id = $1 and autor = 'cliente'`, [T]);
    await expect(svc.responder(ana, caso.id, { texto: 'oi?' })).rejects.toThrow('Passaram 24 h');
    expect(((await svc.conversa(T, caso.id)) as any).janela.aberta).toBe(false);
    // Caso de outra empresa não existe.
    await expect(svc.conversa(T2, caso.id)).rejects.toThrow('Caso do Instagram não encontrado.');
  });

  it('a renovação: o acesso com mais de 20 dias é renovado (cifrado); a falha fica na conta', async () => {
    await conectar();
    expect(await svc.renovarAcessos()).toBe(0); // novo: não renova
    await q(`update instagram_conta set token_renovado_em = now() - interval '21 days' where tenant_id = $1`, [T]);
    expect(await svc.renovarAcessos()).toBe(1);
    const [c] = await q(`select token_cifrado, erro from instagram_conta where tenant_id = $1`, [T]);
    expect(decifrar(c.token_cifrado)).toBe('longo-2');
    expect(c.erro).toBeNull();
    await q(`update instagram_conta set token_renovado_em = now() - interval '21 days' where tenant_id = $1`, [T]);
    falharRenovar = true;
    expect(await svc.renovarAcessos()).toBe(0);
    expect((await q(`select erro from instagram_conta where tenant_id = $1`, [T]))[0].erro).toMatch(/reconecte/);
  });

  it('desconectar: apaga o acesso e desliga o aviso na Meta; os casos ficam', async () => {
    await conectar();
    await svc.processar(aviso({ mid: 'd1', texto: 'oi' }));
    await svc.desconectar({ tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' } as any);
    expect(await q(`select 1 from instagram_conta where tenant_id = $1`, [T])).toHaveLength(0);
    expect(pedidos.some((p) => p.metodo === 'DELETE' && p.caminho === `/v27.0/${CONTA}/subscribed_apps`)).toBe(true);
    expect(await casosDoCliente()).toHaveLength(1);
    await expect(svc.responder({ tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' } as any, (await casosDoCliente())[0].id, { texto: 'oi' })).rejects.toThrow(
      'não está conectado',
    );
  });

  it('no servidor da loja: a conversa e a resposta vão à nuvem; a nuvem confere quem respondeu', async () => {
    await conectar();
    await svc.processar(aviso({ mid: 'l1', texto: 'oi' }));
    const [caso] = await casosDoCliente();
    const nuvem: Server = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', consulta: {}, auth: req.headers['x-sync-token'] as string, corpo });
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ daNuvem: true }));
      });
    });
    const sq = new Set<Socket>();
    nuvem.on('connection', (s) => (sq.add(s), s.on('close', () => sq.delete(s))));
    await new Promise<void>((ok) => nuvem.listen(0, '127.0.0.1', () => ok()));
    const guardados = { CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(nuvem.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-do-servidor';
      pedidos.length = 0;
      expect(await svc.conversa(T, caso.id)).toEqual({ daNuvem: true });
      await svc.responder({ tenantId: T, colaboradorId: pessoa.sara, categoria: 'supervisao' } as any, caso.id, { texto: 'Oi!' });
      const aNuvem = pedidos.filter((p) => p.caminho.startsWith('/api/v1/')); // a leitura do perfil (em segundo plano) vai à Meta
      expect(aNuvem.map((p) => [p.metodo, p.caminho, p.auth])).toEqual([
        ['GET', `/api/v1/atendimento/instagram-da-loja?chamado=${caso.id}`, 'token-do-servidor'],
        ['POST', '/api/v1/atendimento/instagram-da-loja', 'token-do-servidor'],
      ]);
      expect(JSON.parse(aNuvem[1].corpo)).toEqual({ chamadoId: caso.id, texto: 'Oi!', atorId: pessoa.sara, atorPerfil: 'supervisao' });
    } finally {
      delete process.env.EDGE_MODE;
      for (const [k, v] of Object.entries(guardados)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      for (const s of sq) s.destroy();
      await new Promise<void>((ok) => nuvem.close(() => ok()));
    }
    // A nuvem, recebendo da loja: execução e gente de outra empresa não respondem; a supervisão responde.
    await expect(svc.responderVindoDaLoja(T, { chamadoId: caso.id, texto: 'x', atorId: pessoa.edu })).rejects.toThrow('gestão');
    await expect(svc.responderVindoDaLoja(T, { chamadoId: caso.id, texto: 'x', atorId: pessoa.gil })).rejects.toThrow('gestão');
    await expect(svc.responderVindoDaLoja(T, { chamadoId: caso.id, texto: 'x', atorId: 'nao-e-uuid' })).rejects.toThrow('gestão');
    expect(await svc.responderVindoDaLoja(T, { chamadoId: caso.id, texto: 'Oi da loja', atorId: pessoa.sara })).toMatchObject({ ok: true });
  });

  it('o placar dos Números: a mensagem que espera, respondida pela equipe ou pelo app do Instagram', async () => {
    await conectar();
    const t0 = Date.now() - 60 * 60_000;
    await svc.processar(aviso({ mid: 'p1', texto: 'oi', cliente: 'c1', em: t0 }));
    await svc.processar(aviso({ mid: 'p2', texto: 'Oi!', cliente: 'c1', eco: true, em: t0 + 120_000 }));
    await svc.processar(aviso({ mid: 'p3', texto: 'alô', cliente: 'c2', em: t0 + 60_000 })); // sem resposta (há 59 min)
    const n: any = await new NumerosDoAtendimentoService(db).numeros(T, null, '7');
    expect(n.canais.find((c: any) => c.k === 'chat-instagram')).toMatchObject({ chegaram: 2, respondidas: 1, semResposta: 1, segMedio: 120 });
  });
});

void randomUUID;
