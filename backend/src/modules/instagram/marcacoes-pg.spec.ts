import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadGatewayException, BadRequestException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { cifrar } from '../../common/cifra-segredo';
import * as ssrf from '../../common/ssrf-guard';
import { InstagramService } from './instagram.service';
import { InstagramController } from './instagram.controller';
import { AGRADECIMENTO_PADRAO } from './marcacoes';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS MARCAÇÕES DO INSTAGRAM (mig 387), contra o Postgres real, uma META, um CDN, uma IA e um n8n DE MENTIRA locais (nada
// sai para fora): a menção no story (desligada = o Direct de sempre; ligada: a foto à IA e o agradecimento — o CORPO que sai
// para a Meta, V20 —, o vídeo e a IA ausente com o texto padrão, a reclamação vira caso com o que a IA viu, a conversa com
// alguém e a loja respondendo pelo app = nada, o aviso repetido uma vez só, a Meta recusando = "falhou"; o robô do n8n NUNCA
// recebe a menção), o @ da loja no comentário de outra pessoa (vira marcação e não comentário; no post da loja continua
// comentário; a sugestão da IA com a imagem e a legenda), publicar (o corpo do `/mentions`, uma vez só, a trava do texto, a
// Meta recusando volta a "a decidir"), ignorar, a lista (contagem, cursor, 30 dias), o servidor da loja pela nuvem, os
// ajustes, o RBAC e o diagnóstico do aviso. Aplica as migrations só da nuvem com a trava da empresa (ERR-377) e a repetição
// da corrida (ERR-405).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('marcacoes-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
// Contas próprias deste spec (o ig_user_id é único entre as empresas — as outras specs usam outras).
const CONTA = '17841400000000387';
const CONTA2 = '17841400000000388';
const IGSID = '99887766554387';
const MIDIA_DA_LOJA = '18000000000000387';
const MIDIA_OUTRA = '18000000000000388';
const MIDIA_FECHADA = '18000000000000389';
const SENHA = 'senha-do-robo-das-marcacoes';
const TOKEN_IG = 'tok-ig-marcacoes-1';
const PERMISSOES = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments';
const FOTO = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]); // os primeiros bytes de um JPEG

descrever('Marcações do Instagram (Postgres + Meta, CDN, IA e n8n de mentira)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let CARD: string;
  let svc: InstagramService;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aoRobo: any[] = [];
  const aMeta: Array<{ metodo: string; caminho: string; consulta: Record<string, string>; auth: string | undefined; corpo: any }> = [];
  const aoCdn: string[] = [];
  const aNuvem: Array<{ metodo: string; caminho: string; token: string | undefined; corpo: any }> = [];
  const aIA: Array<{ system: string; conteudo: any[] }> = [];
  let respostaDaIA = '';
  const falhar = { messages: false, mentions: false };
  const eventos: Array<{ nome: string; dados: any }> = [];
  const auditados: any[] = [];
  const pessoa: Record<string, string> = {};
  let n = 0;
  let nMeta = 0;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
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
      }
      finally {
        c.release();
      }
    });
  const https = (caminho: string) => `https://127.0.0.1:${new URL(base).port}${caminho}`;
  const ia = (o: { viu?: string; clima?: string; resposta?: string }) => JSON.stringify({ viu: o.viu ?? 'Um smash com cheddar.', clima: o.clima ?? 'positivo', resposta: o.resposta ?? '' });
  /** A menção no story pelo caminho de verdade (o aviso da Meta), esperando a análise e o agradecimento. */
  const story = async (o: { mid?: string; url?: string | null; igsid?: string } = {}) => {
    const mid = o.mid ?? `mid-story-${++n}`;
    await svc.processar({
      object: 'instagram',
      entry: [
        {
          id: CONTA,
          time: Date.now(),
          messaging: [
            {
              sender: { id: o.igsid ?? IGSID },
              recipient: { id: CONTA },
              timestamp: Date.now(),
              message: { mid, attachments: [{ type: 'story_mention', payload: o.url === null ? {} : { url: o.url ?? https('/cdn/foto.jpg') } }] },
            },
          ],
        },
      ],
    });
    await svc.marcacoes.esperar();
    return mid;
  };
  /** Um comentário pelo caminho de verdade (o aviso `comments`). */
  const comentar = async (o: { id?: string; texto: string; midia?: string; usuario?: string; autorId?: string }) => {
    const id = o.id ?? `1787${String(++n).padStart(12, '0')}`;
    await svc.processar({
      object: 'instagram',
      entry: [
        {
          id: CONTA,
          time: Math.floor(Date.now() / 1000),
          changes: [
            {
              field: 'comments',
              value: { id, from: { id: o.autorId ?? '555000387', username: o.usuario ?? 'ana.lopes' }, text: o.texto, media: { id: o.midia ?? MIDIA_OUTRA, media_product_type: 'FEED' } },
            },
          ],
        },
      ],
    });
    await svc.comentarios.esperarEntregas();
    await svc.marcacoes.esperar();
    return id;
  };
  const marcacao = async (origem: string) => (await q(`select * from instagram_marcacao where tenant_id = $1 and origem_id = $2`, [T, origem]))[0];
  const mensagens = () => q(`select * from instagram_mensagem where tenant_id = $1 order by criado_em, id`, [T]);
  /** A entrega ao robô do n8n sai em segundo plano: espera até ela chegar (ou até 1 s, para afirmar que NÃO chegou). */
  const esperarRobo = async (quantas: number) => {
    for (let i = 0; i < 20 && aoRobo.length < quantas; i++) await new Promise((r) => setTimeout(r, 50));
  };
  const doMeta = (tipo: 'messages' | 'mentions' | 'midia') =>
    aMeta.filter((m) => (tipo === 'midia' ? m.metodo === 'GET' && String(m.consulta.fields ?? '').includes('username') : m.metodo === 'POST' && m.caminho.endsWith(`/${tipo}`)));
  const ligar = (o: { story?: boolean; post?: boolean; robo?: boolean; permissoes?: string } = {}) =>
    q(`update instagram_conta set marcacao_story = $2, marcacao_post = $3, robo_responde = $4, comentarios_robo = $4, permissoes = $5 where tenant_id = $1`, [
      T,
      o.story ?? true,
      o.post ?? true,
      o.robo ?? true,
      o.permissoes ?? PERMISSOES,
    ]);
  const user = (cat: string, quem = 'ana') => ({ tenantId: T, colaboradorId: pessoa[quem], categoria: cat }) as any;

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
      '387_marcacoes_do_instagram.sql',
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
          aoRobo.push(lido);
          return j(200, {});
        }
        if (u.pathname.startsWith('/cdn/')) {
          aoCdn.push(u.pathname);
          res.statusCode = 200;
          res.setHeader('content-type', u.pathname.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg');
          return res.end(FOTO);
        }
        if (u.pathname.startsWith('/nuvem/')) {
          aNuvem.push({ metodo: String(req.method), caminho: `${u.pathname}${u.search}`, token: req.headers['x-sync-token'] as string, corpo: lido });
          return j(200, { via: 'nuvem' });
        }
        aMeta.push({ metodo: String(req.method), caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), auth: req.headers.authorization, corpo: lido });
        const erro = () => j(400, { error: { message: 'Invalid parameter', code: 100 } });
        if (req.method === 'POST' && u.pathname.endsWith('/messages')) return falhar.messages ? erro() : j(200, { recipient_id: IGSID, message_id: `mid-agr-${++nMeta}` });
        if (req.method === 'POST' && u.pathname.endsWith('/mentions')) return falhar.mentions ? erro() : j(200, { id: String(17950000000000000 + ++nMeta) });
        if (req.method === 'GET' && u.pathname === `/v27.0/${MIDIA_DA_LOJA}`) return j(200, { username: 'burgerdapraca', permalink: 'https://www.instagram.com/p/LOJA/', caption: 'Post da loja', media_type: 'IMAGE' });
        if (req.method === 'GET' && u.pathname === `/v27.0/${MIDIA_OUTRA}`)
          return j(200, {
            username: 'carol.s',
            permalink: 'https://www.instagram.com/p/CAROL/',
            caption: 'Sexta é dia de smash 🍔',
            media_type: 'IMAGE',
            media_product_type: 'FEED',
            media_url: https('/cdn/post.jpg'),
          });
        if (req.method === 'GET' && u.pathname === `/v27.0/${MIDIA_FECHADA}`) return j(400, { error: { message: 'Unsupported get request', code: 100 } });
        if (req.method === 'GET' && u.pathname.startsWith('/v27.0/')) return j(200, { name: 'Ana', username: 'ana.lopes', is_user_follow_business: true });
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
      INSTAGRAM_MIDIA_TESTE: base,
      ANTHROPIC_API_KEY: 'chave-de-mentira',
      APP_URL: 'https://app.teste',
      CARDAPIO_PUBLIC_URL: 'https://app.teste',
      SEGREDOS_CHAVE: randomBytes(32).toString('base64'),
      BOT_RESOLVER_SECRET: SENHA,
      N8N_ROBO_WEBHOOK_URL: `${base}/n8n`,
      ROBO_JUNTAR_MS: '0',
      CLOUD_API: `${base}/nuvem`,
      SYNC_TOKEN: 'tok-do-servidor-da-loja',
    };
    for (const [k, v] of Object.entries(env)) {
      antes[k] = process.env[k];
      process.env[k] = v;
    }
    for (const k of ['EDGE_MODE', 'MARCACOES_IA_DESLIGADA', 'MARCACOES_MODELO', 'INSTAGRAM_GRAPH_VERSAO']) {
      antes[k] = process.env[k];
      delete process.env[k];
    }
    const emitir = { emit: (nome: string, dados: any) => (eventos.push({ nome, dados }), true) } as any;
    const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
    svc = new InstagramService(db, emitir, auditoria);
    // A IA de mentira: guarda o pedido (as instruções e o conteúdo) e devolve o que o teste mandar.
    (svc.marcacoes.ia as any).chamarModelo = async (system: string, conteudo: any[]) => {
      aIA.push({ system, conteudo });
      return respostaDaIA;
    };
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste marcações do instagram') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa das marcações') returning id`);
    const funcao: Record<string, string> = {};
    for (const [t, cat] of [[T, 'gerente'], [T, 'execucao'], [T2, 'gerente']] as const)
      [{ id: funcao[`${t}:${cat}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
    for (const [nome, t, cat] of [['ana', T, 'gerente'], ['edu', T, 'execucao'], ['gil', T2, 'gerente']] as const)
      [{ id: pessoa[nome] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [t, nome, funcao[`${t}:${cat}`]]);
    [{ id: CARD }] = await q(
      `insert into cardapio_config (tenant_id, token, ativo, aberto, nome_publico, evolution_instancia) values ($1, $2, true, true, 'Burger da Praça', $3) returning id`,
      [T, `tok-marc-${T.slice(0, 8)}`, `inst-marc-${T.slice(0, 8)}`],
    );
    await q(`insert into robo_config (tenant_id, pausa_minutos) values ($1, 60) on conflict (tenant_id) do update set pausa_minutos = 60`, [T]);
    await q(
      `insert into instagram_conta (tenant_id, ig_user_id, usuario, nome, token_cifrado, permissoes, cardapio_id, fila_ligada)
       values ($1, $2, 'burgerdapraca', 'Burger da Praça', $3, $4, $5, true), ($6, $7, 'outraloja', 'Outra', $3, $4, null, true)`,
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
    process.env.ANTHROPIC_API_KEY = 'chave-de-mentira';
    Object.assign(falhar, { messages: false, mentions: false });
    respostaDaIA = ia({ resposta: 'Que smash, hein! Obrigado por marcar a gente 🧡' });
    for (const a of [aoRobo, aMeta, aoCdn, aNuvem, aIA, eventos, auditados]) a.length = 0;
    for (const t of ['instagram_marcacao', 'instagram_comentario', 'instagram_mensagem', 'instagram_contato', 'atendimento_chamado'])
      await q(`delete from ${t} where tenant_id in ($1, $2)`, [T, T2]);
    await q(`update robo_config set equipe_atende = 'sempre', atendente_perfis = '{}'::jsonb where tenant_id = $1`, [T]);
    await ligar();
  });

  it('a 387 de novo: idempotente, a conferência no mesmo Run toda ok, e os dois ajustes nascem desligados', async () => {
    const r: any = await aplicar('387_marcacoes_do_instagram.sql');
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    expect(conferencia.length).toBe(6);
    expect(conferencia.filter((l: any) => l.ok !== true)).toEqual([]);
    const [c] = await q(`select marcacao_story, marcacao_post from instagram_conta where tenant_id = $1`, [T2]);
    expect(c).toEqual({ marcacao_story: false, marcacao_post: false });
  });

  // ───── a menção no story ─────

  it('desligado: a menção no story segue o Direct de sempre (vai ao robô) e não vira marcação', async () => {
    await ligar({ story: false });
    await story();
    expect(await q(`select * from instagram_marcacao where tenant_id = $1`, [T])).toEqual([]);
    await esperarRobo(1);
    expect(aoRobo).toHaveLength(1);
    expect(aoRobo[0].texto).toBe('(o cliente mandou [menção no story])');
    expect(aIA).toHaveLength(0);
  });

  it('ligado, a foto: a IA olha a imagem e o atendente agradece no Direct — o corpo que sai à Meta, a fala do robô e NADA ao n8n', async () => {
    const mid = await story();
    await esperarRobo(1);
    expect(aoRobo).toHaveLength(0);
    expect(aoCdn).toEqual(['/cdn/foto.jpg']);
    expect(aIA).toHaveLength(1);
    expect(aIA[0].system).toContain('NUNCA descreva nem identifique pessoas');
    expect(aIA[0].system).toContain('Burger da Praça');
    expect(aIA[0].conteudo[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: FOTO.toString('base64') } });
    expect(aIA[0].conteudo[1].type).toBe('text');
    const envio = doMeta('messages');
    expect(envio).toHaveLength(1);
    expect(envio[0]).toMatchObject({ caminho: `/v27.0/${CONTA}/messages`, auth: `Bearer ${TOKEN_IG}` });
    expect(envio[0].corpo).toEqual({ recipient: { id: IGSID }, message: { text: 'Que smash, hein! Obrigado por marcar a gente 🧡' } });
    const m = await marcacao(mid);
    expect(m).toMatchObject({
      tipo: 'story',
      estado: 'agradecida',
      autor_id: IGSID,
      ia_viu: 'Um smash com cheddar.',
      ia_clima: 'positivo',
      ia_modelo: 'claude-haiku-5-5',
      resposta_texto: 'Que smash, hein! Obrigado por marcar a gente 🧡',
      resposta_por: 'robo',
      resposta_id: 'mid-agr-1',
      chamado_id: null,
      midia_link: null,
    });
    const ms = await mensagens();
    expect(ms.map((x: any) => [x.direcao, x.autor, x.tipo, x.estado])).toEqual([
      ['entrada', 'cliente', 'story', 'recebida'],
      ['saida', 'robo', 'texto', 'enviada'],
    ]);
    expect(await q(`select * from atendimento_chamado where tenant_id = $1`, [T])).toEqual([]);
    expect(eventos.some((e) => e.nome === 'instagram.marcacao' && e.dados.motivo === 'agradecida')).toBe(true);
  });

  it('o vídeo (a IA não lê vídeo), sem a IA da distribuição ou sem o endereço: o agradecimento padrão, sem chamar a IA', async () => {
    const m1 = await story({ url: https('/cdn/story.mp4') });
    expect((await marcacao(m1)).resposta_por).toBe('padrao');
    delete process.env.ANTHROPIC_API_KEY;
    const m2 = await story({ igsid: '99887766554388' });
    const m3 = await story({ igsid: '99887766554389', url: null });
    expect(aIA).toHaveLength(0);
    expect(aoCdn).toEqual(['/cdn/story.mp4']); // sem a IA, nem baixa
    for (const mid of [m1, m2, m3]) expect(await marcacao(mid)).toMatchObject({ estado: 'agradecida', resposta_por: 'padrao', resposta_texto: AGRADECIMENTO_PADRAO, ia_viu: null });
    expect(doMeta('messages').map((x) => x.corpo.message.text)).toEqual([AGRADECIMENTO_PADRAO, AGRADECIMENTO_PADRAO, AGRADECIMENTO_PADRAO]);
  });

  it('parece reclamação: nada no Direct; vira caso com o que a IA viu (o resumo), a mensagem do story no caso', async () => {
    respostaDaIA = ia({ viu: 'Hambúrguer amassado dentro da embalagem.', clima: 'negativo', resposta: 'Sentimos muito!' });
    const mid = await story();
    expect(doMeta('messages')).toHaveLength(0);
    const [caso] = await q(`select * from atendimento_chamado where tenant_id = $1`, [T]);
    expect(caso).toMatchObject({ tipo: 'instagram', canal: 'instagram', status: 'aberto', mensagem: '📸 Marcou a loja no story' });
    expect(caso.detalhe.instagram.igsid).toBe(IGSID);
    expect(caso.detalhe.robo).toMatchObject({
      motivo: 'Menção no story · parece reclamação',
      viu: 'Hambúrguer amassado dentro da embalagem.',
      jaFez: 'Nada: não agradeci, porque parece reclamação',
      humor: 'chateado',
    });
    const m = await marcacao(mid);
    expect(m).toMatchObject({ estado: 'caso', chamado_id: caso.id, ia_clima: 'negativo', resposta_texto: null });
    expect((await mensagens())[0].chamado_id).toBe(caso.id);
    expect(eventos.some((e) => e.nome === 'atendimento.novo' && e.dados.chamado.id === caso.id)).toBe(true);
  });

  it('a conversa com alguém (o caso aberto do cliente): a menção soma ao caso e ninguém agradece; nem a IA roda', async () => {
    const [aberto] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, cliente, mensagem, prioridade, detalhe) values ($1, 'instagram', 'instagram', 'Ana', 'oi', 'normal', $2::jsonb) returning id`,
      [T, JSON.stringify({ instagram: { igsid: IGSID } })],
    );
    const mid = await story();
    expect(await marcacao(mid)).toMatchObject({ estado: 'sem_acao', chamado_id: aberto.id });
    expect(aIA).toHaveLength(0);
    expect(doMeta('messages')).toHaveLength(0);
    const [c] = await q(`select mensagem from atendimento_chamado where id = $1`, [aberto.id]);
    expect(c.mensagem).toBe('📸 Marcou a loja no story');
    expect((await mensagens())[0].chamado_id).toBe(aberto.id);
  });

  it('a loja respondeu pelo app há pouco: ninguém agradece (o robô fica quieto como no Direct)', async () => {
    await q(
      `insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, tipo, texto, estado) values ($1, $2, $3, 'saida', 'loja', 'texto', 'Oi! Tudo bem?', 'enviada')`,
      [T, CONTA, IGSID],
    );
    const mid = await story();
    expect(await marcacao(mid)).toMatchObject({ estado: 'sem_acao', chamado_id: null });
    expect(doMeta('messages')).toHaveLength(0);
  });

  it('o aviso repetido: uma marcação e um agradecimento só', async () => {
    await story({ mid: 'mid-story-repetido' });
    await story({ mid: 'mid-story-repetido' });
    expect(await q(`select id from instagram_marcacao where tenant_id = $1`, [T])).toHaveLength(1);
    expect(doMeta('messages')).toHaveLength(1);
  });

  it('o endereço fora do CDN da Meta não se baixa (nem passa pela busca de rede): o agradecimento padrão, sem a IA', async () => {
    const busca = jest.spyOn(ssrf, 'buscarUrlPublica');
    try {
      const mid = await story({ url: 'https://exemplo.com.br/foto.jpg' });
      expect(busca).not.toHaveBeenCalled();
      expect(aoCdn).toEqual([]);
      expect(aIA).toHaveLength(0);
      expect(await marcacao(mid)).toMatchObject({ estado: 'agradecida', resposta_por: 'padrao' });
    } finally {
      busca.mockRestore();
    }
  });

  it('segunda camada: a mensagem saiu do histórico mas a marcação existe — o aviso de novo não vai ao robô nem agradece outra vez', async () => {
    const mid = await story();
    await q(`delete from instagram_mensagem where tenant_id = $1 and mid = $2`, [T, mid]);
    await story({ mid });
    await esperarRobo(1);
    expect(aoRobo).toHaveLength(0);
    expect(doMeta('messages')).toHaveLength(1);
    expect(await q(`select id from instagram_marcacao where tenant_id = $1`, [T])).toHaveLength(1);
  });

  it('a Meta recusou o agradecimento: "falhou", com o motivo, e nenhuma fala do robô gravada', async () => {
    falhar.messages = true;
    const mid = await story();
    expect(await marcacao(mid)).toMatchObject({ estado: 'falhou', erro: 'O Instagram não aceitou o agradecimento no Direct.', ia_clima: 'positivo' });
    expect((await mensagens()).filter((x: any) => x.direcao === 'saida')).toEqual([]);
  });

  // ───── o @ da loja em comentário ─────

  it('o @ da loja no post de OUTRA pessoa: vira marcação (não comentário) e o robô dos comentários não recebe; a IA sugere com a imagem e a legenda', async () => {
    const id = await comentar({ texto: '@burgerdapraca vocês precisam provar esse!', usuario: 'carol.s' });
    expect(await q(`select id from instagram_comentario where tenant_id = $1`, [T])).toEqual([]);
    expect(aoRobo).toHaveLength(0);
    expect(doMeta('midia')).toHaveLength(1);
    expect(doMeta('midia')[0].consulta.fields).toBe('username,permalink,caption,media_type,media_product_type,media_url,thumbnail_url');
    expect(aoCdn).toEqual(['/cdn/post.jpg']);
    expect(aIA).toHaveLength(1);
    expect(aIA[0].system).toContain('resposta pública ao comentário');
    expect(aIA[0].conteudo[1].text).toContain('@burgerdapraca vocês precisam provar esse!');
    expect(aIA[0].conteudo[1].text).toContain('Legenda do post: Sexta é dia de smash');
    const m = await marcacao(id);
    expect(m).toMatchObject({
      tipo: 'comentario',
      estado: 'sugerida',
      midia_id: MIDIA_OUTRA,
      midia_link: 'https://www.instagram.com/p/CAROL/',
      legenda: 'Sexta é dia de smash 🍔',
      autor_usuario: 'carol.s',
      texto: '@burgerdapraca vocês precisam provar esse!',
      sugestao: 'Que smash, hein! Obrigado por marcar a gente 🧡',
      ia_clima: 'positivo',
    });
  });

  it('sem a sugestão ligada: a marcação entra "a decidir", sem chamar a IA', async () => {
    await ligar({ post: false });
    const id = await comentar({ texto: 'Olha o @burgerdapraca aqui' });
    expect(await marcacao(id)).toMatchObject({ estado: 'sugerida', sugestao: null, ia_clima: null });
    expect(aIA).toHaveLength(0);
  });

  it('a mídia que não abre com o acesso da loja conta como marcação (sem link); o @ no post DA LOJA e o texto sem @ continuam comentário', async () => {
    const fechada = await comentar({ texto: '@burgerdapraca top', midia: MIDIA_FECHADA });
    expect(await marcacao(fechada)).toMatchObject({ tipo: 'comentario', midia_link: null });
    const daLoja = await comentar({ texto: 'Amo o @burgerdapraca!', midia: MIDIA_DA_LOJA });
    expect(await marcacao(daLoja)).toBeUndefined();
    expect((await q(`select comentario_id from instagram_comentario where tenant_id = $1`, [T])).map((x: any) => x.comentario_id)).toEqual([daLoja]);
    aMeta.length = 0;
    const semArroba = await comentar({ texto: 'Que delícia!' });
    expect(doMeta('midia')).toHaveLength(0); // sem o @, nem lê a mídia
    expect(await marcacao(semArroba)).toBeUndefined();
    // A própria loja citando o @ dela: nem marcação, nem comentário.
    await comentar({ texto: 'Sigam o @burgerdapraca', usuario: 'burgerdapraca' });
    expect(await q(`select id from instagram_marcacao where tenant_id = $1 and autor_usuario = 'burgerdapraca'`, [T])).toEqual([]);
  });

  // ───── publicar e ignorar ─────

  it('publicar: o corpo do `/mentions` (comentário: media_id, comment_id e message), uma vez só, a auditoria', async () => {
    const id = await comentar({ texto: '@burgerdapraca vocês precisam provar esse!' });
    const m = await marcacao(id);
    const r: any = await svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: '  Obrigado pela lembrança, Carol! 🧡 ' });
    const envio = doMeta('mentions');
    expect(envio).toHaveLength(1);
    expect(envio[0]).toMatchObject({ caminho: `/v27.0/${CONTA}/mentions`, auth: `Bearer ${TOKEN_IG}` });
    expect(envio[0].corpo).toEqual({ media_id: MIDIA_OUTRA, message: 'Obrigado pela lembrança, Carol! 🧡', comment_id: id });
    expect(r).toMatchObject({ estado: 'publicada', sugestao: null, resposta: { texto: 'Obrigado pela lembrança, Carol! 🧡', por: 'equipe', quem: 'ana' } });
    expect(await marcacao(id)).toMatchObject({ estado: 'publicada', resposta_por: 'equipe', respondido_por: pessoa.ana });
    expect((await marcacao(id)).resposta_id).toMatch(/^1795/);
    expect(auditados.some((a) => a.acao === 'instagram_marcacao_publicada' && a.entidadeId === m.id)).toBe(true);
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'De novo' })).rejects.toMatchObject({ response: { code: 'JA_DECIDIDA' } });
    await expect(svc.marcacoes.agirPara(user('gerente'), 'ignorar', m.id, {})).rejects.toBeInstanceOf(ConflictException);
    expect(doMeta('mentions')).toHaveLength(1);
  });

  it('o texto da equipe é conferido ANTES da Meta (link, contato, vazio, longo); a Meta recusou → volta a "a decidir" com o motivo (502)', async () => {
    const id = await comentar({ texto: '@burgerdapraca top' });
    const m = await marcacao(id);
    for (const texto of ['', 'Peça em bit.ly/x', 'Chama no 21 99999-8888', 'a'.repeat(301)])
      await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto })).rejects.toBeInstanceOf(BadRequestException);
    expect(doMeta('mentions')).toHaveLength(0);
    falhar.mentions = true;
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'Valeu!' })).rejects.toBeInstanceOf(BadGatewayException);
    expect(await marcacao(id)).toMatchObject({ estado: 'sugerida', resposta_texto: null, respondido_por: null, erro: 'O Instagram recusou: o comentário pode ter sido apagado ou escondido.' });
    falhar.mentions = false;
    await svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'Valeu!' });
    expect(await marcacao(id)).toMatchObject({ estado: 'publicada', erro: null });
  });

  it('ignorar: "ignorada", nada sai; depois não publica; o story não se publica (é no Direct)', async () => {
    const id = await comentar({ texto: '@burgerdapraca hm' });
    const m = await marcacao(id);
    const r: any = await svc.marcacoes.agirPara(user('presidente'), 'ignorar', m.id, {});
    expect(r.estado).toBe('ignorada');
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'Valeu!' })).rejects.toMatchObject({ response: { code: 'JA_DECIDIDA' } });
    expect(doMeta('mentions')).toHaveLength(0);
    const mid = await story();
    const s = await marcacao(mid);
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', s.id, { texto: 'Valeu!' })).rejects.toMatchObject({ response: { code: 'STORY_NO_DIRECT' } });
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', '00000000-0000-0000-0000-000000000000', { texto: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('a conta trocada (outra conta conectada) e sem a permissão dos comentários: 409', async () => {
    const id = await comentar({ texto: '@burgerdapraca top' });
    const m = await marcacao(id);
    await q(`update instagram_marcacao set ig_user_id = '17841400000000999' where id = $1`, [m.id]);
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'Valeu!' })).rejects.toMatchObject({ response: { code: 'CONTA_TROCADA' } });
    await ligar({ permissoes: 'instagram_business_basic,instagram_business_manage_messages' });
    await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', m.id, { texto: 'Valeu!' })).rejects.toMatchObject({ response: { code: 'SEM_PERMISSAO' } });
    expect(doMeta('mentions')).toHaveLength(0);
  });

  // ───── a lista ─────

  it('a lista: da mais nova à mais velha, a contagem, os ajustes, 50 por página com o cursor, os 30 dias e só da empresa', async () => {
    const ins = (i: number, estado: string, dias = 0) =>
      q(
        `insert into instagram_marcacao (tenant_id, ig_user_id, tipo, origem_id, estado, marcado_em) values ($1, $2, 'comentario', $3, $4, now() - make_interval(days => $5::int, mins => $6::int))`,
        [T, CONTA, `orig-${i}`, estado, dias, i],
      );
    for (let i = 1; i <= 52; i++) await ins(i, i <= 5 ? 'sugerida' : 'ignorada');
    await ins(99, 'sugerida', 31); // fora dos 30 dias
    await q(`insert into instagram_marcacao (tenant_id, ig_user_id, tipo, origem_id, estado, marcado_em) values ($1, $2, 'story', 'outra', 'agradecida', now())`, [T2, CONTA2]);
    const p1: any = await svc.marcacoes.listarPara(user('gerente'), {});
    expect(p1.itens).toHaveLength(50);
    expect(p1.itens[0].id).toBe((await marcacao('orig-1')).id);
    expect(p1.contagem).toEqual({ aDecidir: 5, todas: 52 });
    expect(p1.ajustes).toEqual({ story: true, post: true, ia: true, permitido: true });
    expect(p1.proximo).toBeTruthy();
    const p2: any = await svc.marcacoes.listarPara(user('gerente'), { antes: p1.proximo });
    expect(p2.itens.map((x: any) => x.id)).toEqual([(await marcacao('orig-51')).id, (await marcacao('orig-52')).id]);
    expect(p2.proximo).toBeNull();
    const todos = [...p1.itens, ...p2.itens].map((x: any) => x.id);
    expect(new Set(todos).size).toBe(52);
  });

  // ───── quem pode, e o servidor da loja ─────

  it('RBAC: só a gestão (presidente e gerente) — nas rotas e no serviço', async () => {
    for (const metodo of ['marcacoes', 'publicarMarcacao', 'ignorarMarcacao'])
      expect(Reflect.getMetadata(ROLES_KEY, (InstagramController.prototype as any)[metodo])).toEqual(['presidente', 'gerente']);
    await expect(svc.marcacoes.listarPara(user('supervisao'), {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.marcacoes.agirPara(user('execucao', 'edu'), 'ignorar', '00000000-0000-0000-0000-000000000000', {})).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no servidor da loja: a lista e a ação pela nuvem (quem agiu vai junto); a nuvem confere quem agiu', async () => {
    process.env.EDGE_MODE = 'true';
    try {
      await svc.marcacoes.listarPara(user('gerente'), { antes: 'abc' });
      await svc.marcacoes.agirPara(user('gerente'), 'publicar', '11111111-2222-3333-4444-555555555555', { texto: 'Valeu!' });
      expect(aNuvem.map((x) => [x.metodo, x.caminho])).toEqual([
        ['GET', '/nuvem/atendimento/instagram-marcacoes-da-loja?antes=abc'],
        ['POST', '/nuvem/atendimento/instagram-marcacoes-da-loja'],
      ]);
      expect(aNuvem[1].corpo).toEqual({ acao: 'publicar', id: '11111111-2222-3333-4444-555555555555', texto: 'Valeu!', atorId: pessoa.ana });
      // O texto ruim nem sai da loja.
      await expect(svc.marcacoes.agirPara(user('gerente'), 'publicar', '11111111-2222-3333-4444-555555555555', { texto: 'bit.ly/x' })).rejects.toBeInstanceOf(BadRequestException);
      expect(aNuvem).toHaveLength(2);
    } finally {
      delete process.env.EDGE_MODE;
    }
    const id = await comentar({ texto: '@burgerdapraca top' });
    const m = await marcacao(id);
    await expect(svc.marcacoes.agirVindoDaLoja(T, { acao: 'ignorar', id: m.id, atorId: pessoa.edu })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.marcacoes.agirVindoDaLoja(T, { acao: 'ignorar', id: m.id, atorId: pessoa.gil })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.marcacoes.agirVindoDaLoja(T, { acao: 'apagar', id: m.id, atorId: pessoa.ana })).rejects.toBeInstanceOf(BadRequestException);
    const r: any = await svc.marcacoes.agirVindoDaLoja(T, { acao: 'ignorar', id: m.id, atorId: pessoa.ana });
    expect(r.estado).toBe('ignorada');
  });

  // ───── os ajustes ─────

  it('os ajustes: lidos com o Instagram; só booleano; o de post pede a permissão dos comentários; gravados com a auditoria', async () => {
    await ligar({ story: false, post: false });
    expect((await svc.ajuste(T)).marcacoes).toEqual({ story: false, post: false, ia: true, postPermitido: true });
    await expect(svc.conferirAjuste(T, { marcacoes: { story: 'sim' } })).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.conferirAjuste(T, { marcacoes: [] })).rejects.toBeInstanceOf(BadRequestException);
    const a = await svc.conferirAjuste(T, { marcacoes: { story: true, post: true } });
    expect(a.marcacoes).toEqual({ story: true, post: true });
    await svc.salvarAjuste(user('gerente'), a);
    expect((await svc.ajuste(T)).marcacoes).toMatchObject({ story: true, post: true });
    expect(auditados.map((x) => x.acao).filter((x) => x.startsWith('marcacao_'))).toEqual(['marcacao_story_ligado', 'marcacao_post_ligado']);
    await svc.salvarAjuste(user('gerente'), a); // o mesmo de novo: nada muda, nada audita
    expect(auditados.filter((x) => x.acao.startsWith('marcacao_'))).toHaveLength(2);
    await ligar({ story: false, post: false, permissoes: 'instagram_business_basic,instagram_business_manage_messages' });
    expect((await svc.ajuste(T)).marcacoes?.postPermitido).toBe(false);
    await expect(svc.conferirAjuste(T, { marcacoes: { post: true } })).rejects.toThrow(/reconecte o Instagram/);
    expect((await svc.conferirAjuste(T, { marcacoes: { story: true } })).marcacoes).toEqual({ story: true }); // o story chega no Direct
  });

  it('o diagnóstico: o aviso `comments` que a leitura descarta vai ao registro só com os NOMES dos campos', async () => {
    const log = jest.spyOn(Logger.prototype, 'log');
    try {
      await svc.processar({ object: 'instagram', entry: [{ id: CONTA, changes: [{ field: 'comments', value: { media_id: MIDIA_OUTRA, from: { username: 'nome.secreto' } } }] }] });
      const linhas = log.mock.calls.map((c) => String(c[0])).filter((t) => t.includes('não leu'));
      expect(linhas).toEqual(['aviso de comentário que o Regem não leu (talvez @ na legenda): value={from,media_id} media={undefined}']);
      expect(linhas.join(' ')).not.toContain('nome.secreto');
    } finally {
      log.mockRestore();
    }
  });
});
