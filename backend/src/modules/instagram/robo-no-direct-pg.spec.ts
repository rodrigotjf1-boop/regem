import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { cifrar } from '../../common/cifra-segredo';
import { assinarConversa, assinarConversaDoDirect, lerConversa, lerConversaDoDirect } from '../../common/conversa-do-robo';
import { esquecerPendentes } from '../whatsapp/juntar-mensagens';
import { InstagramService } from './instagram.service';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { RoboConsultasController } from '../cardapio/robo-consultas.controller';
import { ClienteService } from '../cliente/cliente.service';
import { ChatDoCasoService } from '../atendimento/chat-do-caso.service';
import { NumerosDoAtendimentoService } from '../atendimento/numeros.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ROBÔ NO DIRECT DO INSTAGRAM (mig 378; protótipo v8), contra o Postgres real, uma META e um n8n DE MENTIRA locais
// (nada sai para fora): quem responde a mensagem nova (o robô, o caso ou ninguém), a resposta do robô (o corpo que sai
// para a Meta, as partes de 1.000 bytes, a janela, o eco que não cala), o "chamar atendente" (a ficha do Direct, o resumo,
// UM "já chamei" — V83), as rotas de telefone que recusam `ig:` (V79), as consultas do robô pela chave `ig:`, o robô
// indisponível (V88), a rotina "sem resposta" (V84/V42), "Conversas agora" e o "Assumir", os ajustes e os Números.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-no-direct-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(90_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const CONTA = '17841400000000077';
const CONTA2 = '17841400000000078';
const CLIENTE = '99887766554401';
const SENHA = 'senha-do-robo-de-teste';

descrever('Robô no Direct do Instagram (Postgres + Meta e n8n de mentira)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let CARD: string;
  let CARD2: string;
  let svc: InstagramService;
  let resposta: RoboRespostaService;
  let cardapio: CardapioService;
  let chat: ChatDoCasoService;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aoRobo: any[] = [];
  const aMeta: Array<{ caminho: string; auth: string | undefined; corpo: any }> = [];
  const eventos: Array<{ nome: string; dados: any }> = [];
  const auditados: any[] = [];
  const pessoa: Record<string, string> = {};
  let nMid = 0;
  // A corrida do eco: a Meta avisa o eco da resposta ANTES de devolver o id ao Regem (ele entra como `loja`).
  let ecoNoMeioDoEnvio = false;
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
  const aviso = (o: { mid: string; texto?: string; eco?: boolean; cliente?: string; conta?: string; em?: number; audio?: boolean }) => ({
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
            message: {
              mid: o.mid,
              ...(o.texto ? { text: o.texto } : {}),
              ...(o.audio ? { attachments: [{ type: 'audio', payload: { url: 'https://lookaside.fbsbx.com/x.mp4' } }] } : {}),
              ...(o.eco ? { is_echo: true } : {}),
            },
          },
        ],
      },
    ],
  });
  const esperar = async (fn: () => Promise<boolean> | boolean, vezes = 60) => {
    for (let i = 0; i < vezes; i++) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  const quieto = () => new Promise((r) => setTimeout(r, 400));
  const casos = (cliente = CLIENTE, tenant = T) =>
    q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'instagram' and detalhe #>> '{instagram,igsid}' = $2 order by criado_em`, [tenant, cliente]);
  const ligarRobo = (ligado = true, tenant = T) => q(`update instagram_conta set robo_responde = $2 where tenant_id = $1`, [tenant, ligado]);
  const responder = (texto: string, extra: any = {}) =>
    resposta.responder(SENHA, { instancia: `ig:${CONTA}`, para: `ig:${CLIENTE}`, texto, ...extra } as any);
  const fichaDoDirect = (tenant = T, cliente = CLIENTE) => assinarConversaDoDirect(tenant, cliente) as string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '366_ponte_do_chat.sql',
      '367_chat_ordem_e_indices.sql',
      '377_instagram_direct.sql',
      '378_instagram_robo_no_direct.sql',
      '379_horario_da_equipe.sql',
    ])
      await aplicar(m);
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', async () => {
        const u = new URL(req.url ?? '/', 'http://x');
        const j = (s: number, b: any) => {
          res.statusCode = s;
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify(b));
        };
        if (u.pathname === '/n8n') {
          aoRobo.push({ corpo: JSON.parse(corpo || '{}'), segredo: req.headers['x-regem-robo-segredo'] });
          return j(200, { ok: true });
        }
        if (req.method === 'POST' && u.pathname.endsWith('/messages')) {
          aMeta.push({ caminho: u.pathname, auth: req.headers.authorization, corpo: JSON.parse(corpo || '{}') });
          const mid = `mid-robo-${++nMid}`;
          if (ecoNoMeioDoEnvio) await svc.processar(aviso({ mid, texto: JSON.parse(corpo || '{}')?.message?.text, eco: true }));
          return j(200, { recipient_id: CLIENTE, message_id: mid });
        }
        if (req.method === 'GET' && u.pathname.startsWith('/v27.0/')) return j(200, { name: 'Lívia Ramos', username: 'livia.ramos', is_user_follow_business: false });
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
      ROBO_JUNTAR_MS: '0',
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
    chat = new ChatDoCasoService(db, emitir, {} as any, auditoria);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste robô no direct') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa robô no direct') returning id`);
    const funcao: Record<string, string> = {};
    for (const [t, cat] of [[T, 'gerente'], [T, 'execucao'], [T2, 'gerente']] as const)
      [{ id: funcao[`${t}:${cat}`] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [t, `F ${cat}`, cat]);
    for (const [nome, t, cat] of [['ana', T, 'gerente'], ['edu', T, 'execucao'], ['gil', T2, 'gerente']] as const)
      [{ id: pessoa[nome] }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [t, nome, funcao[`${t}:${cat}`]]);
    [{ id: CARD }] = await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Burger da Praça') returning id`, [T, `tok-direct-${T.slice(0, 8)}`]);
    [{ id: CARD2 }] = await q(`insert into cardapio_config (tenant_id, token, ativo, nome_publico) values ($1, $2, true, 'Outra') returning id`, [T2, `tok-direct-${T2.slice(0, 8)}`]);
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
      for (const tab of ['instagram_mensagem', 'instagram_contato', 'instagram_conta', 'atendimento_chamado', 'pedido_externo', 'cliente', 'robo_config', 'cardapio_config', 'colaborador', 'funcao'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    process.env.BOT_RESOLVER_SECRET = SENHA;
    aoRobo.length = 0;
    ecoNoMeioDoEnvio = false;
    aMeta.length = 0;
    eventos.length = 0;
    auditados.length = 0;
    for (const t of [T, T2]) for (const tab of ['instagram_mensagem', 'instagram_contato', 'instagram_conta', 'atendimento_chamado']) await q(`delete from ${tab} where tenant_id = $1`, [t]);
    await q(`update cardapio_config set ativo = true where tenant_id in ($1, $2)`, [T, T2]);
    await q(`delete from cardapio_config where tenant_id = $1 and id <> $2`, [T, CARD]);
    // A conta conectada (o caminho de conectar já tem a sua spec): o acesso cifrado, a fila ligada e o robô ligado.
    await q(
      `insert into instagram_conta (tenant_id, ig_user_id, usuario, token_cifrado, fila_ligada, robo_responde) values ($1, $2, 'burgerdapraca', $3, true, true)`,
      [T, CONTA, cifrar('longo-1')],
    );
  });

  it('robô ligado: a mensagem NOVA vai ao robô uma vez só, sem caso — com a chave `ig:`, a ficha do Direct e o tipo texto', async () => {
    await svc.processar(aviso({ mid: 'm1', texto: 'Oi, vcs têm lanche vegano?' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    const m = aoRobo[0].corpo;
    expect(aoRobo[0].segredo).toBe(SENHA);
    expect(m).toMatchObject({
      provedor: 'instagram',
      tenantId: T,
      instancia: `ig:${CONTA}`,
      phoneNumberId: null,
      de: `ig:${CLIENTE}`,
      tipo: 'text',
      texto: 'Oi, vcs têm lanche vegano?',
      mensagemId: 'm1',
      cardapioToken: `tok-direct-${T.slice(0, 8)}`,
      loja: { nome: 'Burger da Praça' },
    });
    expect(lerConversaDoDirect(m.conversa)).toEqual({ tenantId: T, igsid: CLIENTE });
    expect(lerConversa(m.conversa)).toBeNull(); // a ficha do Direct não vale como a do telefone
    expect(await casos()).toHaveLength(0);
    // A Meta reentrega: a mesma mensagem não vai de novo ao robô (ERR-319).
    await svc.processar(aviso({ mid: 'm1', texto: 'Oi, vcs têm lanche vegano?' }));
    await quieto();
    expect(aoRobo).toHaveLength(1);
  });

  it('áudio no Direct: vai ao robô como TEXTO dizendo o que veio (ele não ouve áudio nem fala)', async () => {
    await svc.processar(aviso({ mid: 'a1', audio: true }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
    expect(aoRobo[0].corpo).toMatchObject({ tipo: 'text', midiaId: null });
    expect(aoRobo[0].corpo.texto).toContain('mandou um áudio');
  });

  it('robô desligado: como antes — o caso abre na fila e nada vai ao robô', async () => {
    await ligarRobo(false);
    await svc.processar(aviso({ mid: 'd1', texto: 'Oi' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    expect(await casos()).toHaveLength(1);
  });

  it('robô quieto: caso aberto com alguém, ou a loja respondeu pelo app do Instagram — a mensagem não vai ao robô', async () => {
    const [c] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, mensagem, responsavel_id, detalhe) values ($1, 'instagram', 'instagram', 'x', $2, $3) returning id`,
      [T, pessoa.ana, JSON.stringify({ instagram: { igsid: CLIENTE } })],
    );
    await svc.processar(aviso({ mid: 'q1', texto: 'Oi de novo' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    expect((await q(`select chamado_id from instagram_mensagem where mid = 'q1'`))[0].chamado_id).toBe(c.id); // entrou no caso
    await q(`update atendimento_chamado set status = 'resolvido' where id = $1`, [c.id]);
    // A loja respondeu pelo app do Instagram (o eco): o robô fica quieto, e não nasce caso.
    await svc.processar(aviso({ mid: 'e1', texto: 'Oi! Aqui é o Bruno.', eco: true }));
    await svc.processar(aviso({ mid: 'q2', texto: 'Obrigada' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    expect((await casos()).filter((x: any) => x.status === 'aberto')).toHaveLength(0);
  });

  it('a resposta do robô: o corpo que sai para a Meta (doc), o link com a origem do Direct, as opções numeradas e a conversa como `robo`', async () => {
    await svc.processar(aviso({ mid: 'r1', texto: 'Tem lanche vegano?' }));
    const link = `https://app.teste/c/tok-direct-${T.slice(0, 8)}`;
    const r = await responder(`Temos o Smash Veggie! Veja: ${link}?produto=p1. E também https://outro-site.com/x`, { opcoes: [{ titulo: 'Ver cardápio' }, { titulo: 'Horário' }] });
    expect(r).toMatchObject({ ok: true, enviado: true });
    expect(aMeta).toHaveLength(1);
    // Instagram API com o login do Instagram (Messaging API): POST /<conta>/messages { recipient: { id }, message: { text } }.
    expect(aMeta[0].caminho).toBe(`/v27.0/${CONTA}/messages`);
    expect(aMeta[0].auth).toBe('Bearer longo-1');
    expect(Object.keys(aMeta[0].corpo).sort()).toEqual(['message', 'recipient']);
    expect(aMeta[0].corpo.recipient).toEqual({ id: CLIENTE });
    const texto: string = aMeta[0].corpo.message.text;
    expect(texto).toContain(`${link}?produto=p1&utm_source=instagram&utm_medium=direct.`);
    expect(texto).not.toContain('outro-site.com'); // só o link da loja sai
    expect(texto).toContain('1) Ver cardápio');
    expect(texto).toContain('2) Horário');
    const [m] = await q(`select autor, estado, mid from instagram_mensagem where tenant_id = $1 and direcao = 'saida'`, [T]);
    expect(m).toMatchObject({ autor: 'robo', estado: 'enviada' });
  });

  it('texto longo: até 3 mensagens de até 1.000 bytes; voz não sai no Direct', async () => {
    await svc.processar(aviso({ mid: 'l1', texto: 'Me fala tudo' }));
    const par = 'Á'.repeat(450); // 900 bytes
    const r = await responder([par, par, par, par].join('\n\n'));
    expect(r).toMatchObject({ enviado: true, enviados: ['texto', 'texto', 'texto'] }); // 4 parágrafos: 3 mensagens, a última com "…"
    expect(aMeta.map((p) => p.corpo.message.text)).toEqual([par, par, `${par}…`]);
    for (const p of aMeta) expect(Buffer.byteLength(p.corpo.message.text, 'utf8')).toBeLessThanOrEqual(1000);
    aMeta.length = 0;
    expect(await responder('', { audio: { base64: 'T2dnUw==' } })).toMatchObject({ enviado: false, motivo: 'sem_voz_no_direct' });
    expect(aMeta).toHaveLength(0);
  });

  it('o eco da resposta do próprio robô (chegando ANTES da gravação) não cala o robô', async () => {
    await svc.processar(aviso({ mid: 'z1', texto: 'Oi' }));
    nMid = 100; // a próxima resposta da Meta de mentira é mid-robo-101
    ecoNoMeioDoEnvio = true; // a Meta avisa o eco antes de devolver o id: ele entra como `loja`…
    expect(await responder('Oi! Tudo bem?')).toMatchObject({ enviado: true });
    ecoNoMeioDoEnvio = false;
    // …e a gravação da resposta, pelo mesmo id, devolve a mensagem ao robô.
    expect(await q(`select autor from instagram_mensagem where mid = 'mid-robo-101'`)).toEqual([{ autor: 'robo' }]);
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'z2', texto: 'Quero ver o cardápio' }));
    expect(await esperar(() => aoRobo.length === 1)).toBe(true);
  });

  it('fora da janela de 24 h, ou com a conversa com alguém: a resposta do robô é segurada', async () => {
    await q(
      `insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, texto, mid, estado, criado_em) values ($1, $2, $3, 'entrada', 'cliente', 'oi', 'velha', 'recebida', now() - interval '25 hours')`,
      [T, CONTA, CLIENTE],
    );
    expect(await responder('Oi!')).toMatchObject({ enviado: false, motivo: 'fora_da_janela' });
    await svc.processar(aviso({ mid: 'j1', texto: 'Oi de novo' }));
    await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, mensagem, responsavel_id, detalhe) values ($1, 'instagram', 'instagram', 'x', $2, $3)`,
      [T, pessoa.ana, JSON.stringify({ instagram: { igsid: CLIENTE } })],
    );
    expect(await responder('Oi!')).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    expect(aMeta).toHaveLength(0);
  });

  it('"chamar atendente": o caso do Direct com o resumo e a posição, e UM "já chamei" (V83, pelo serviço de verdade)', async () => {
    await svc.processar(aviso({ mid: 'h1', texto: 'Quero fazer uma encomenda para 15 pessoas' }));
    const r: any = await cardapio.abrirAtendimento(
      `tok-direct-${T.slice(0, 8)}`,
      { tipo: 'humano', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(), mensagem: 'Motivo: encomenda\nQuer: pedido para 15 pessoas no sábado\nJá fiz: mandei o cardápio' },
      SENHA,
    );
    expect(r).toMatchObject({ ok: true, posicao: 1, comAlguem: false });
    const [c] = await casos();
    expect(c).toMatchObject({ status: 'aberto', tipo: 'instagram', canal: 'instagram', telefone: null });
    expect(c.detalhe.robo).toMatchObject({ motivo: 'encomenda', quer: 'pedido para 15 pessoas no sábado' });
    expect(c.detalhe.instagram).toMatchObject({ igsid: CLIENTE, abertoPeloRobo: true, avisoLiberado: true });
    expect((await q(`select chamado_id from instagram_mensagem where mid = 'h1'`))[0].chamado_id).toBe(c.id);
    expect(await responder('Já chamei a equipe: você é a 1ª da fila.')).toMatchObject({ enviado: true });
    expect(await responder('Mais alguma coisa?')).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    expect(aMeta).toHaveLength(1);
  });

  it('"chamar atendente" com a conversa JÁ com a equipe: soma o resumo e não libera o "já chamei"', async () => {
    await svc.processar(aviso({ mid: 'h2', texto: 'Oi' }));
    const [c0] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, canal, mensagem, responsavel_id, detalhe) values ($1, 'instagram', 'instagram', 'x', $2, $3) returning id`,
      [T, pessoa.ana, JSON.stringify({ instagram: { igsid: CLIENTE } })],
    );
    const r: any = await cardapio.abrirAtendimento(`tok-direct-${T.slice(0, 8)}`, { tipo: 'humano', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(), mensagem: 'Motivo: x' }, SENHA);
    expect(r).toMatchObject({ id: c0.id, comAlguem: true });
    expect(await responder('Já chamei a equipe.')).toMatchObject({ enviado: false });
    expect(aMeta).toHaveLength(0);
  });

  it('"chamar atendente" sem a ficha do Direct, com a do telefone ou de outro cliente: 401 — nunca cai no caminho do telefone', async () => {
    const tok = `tok-direct-${T.slice(0, 8)}`;
    await expect(cardapio.abrirAtendimento(tok, { tipo: 'humano', telefone: `ig:${CLIENTE}` }, SENHA)).rejects.toThrow('Direct');
    await expect(cardapio.abrirAtendimento(tok, { tipo: 'humano', telefone: `ig:${CLIENTE}`, conversa: assinarConversa(T, '5521999998888') }, SENHA)).rejects.toThrow('Direct');
    await expect(cardapio.abrirAtendimento(tok, { tipo: 'humano', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(T, '11112222333344') }, SENHA)).rejects.toThrow('Direct');
    await expect(cardapio.abrirAtendimento(tok, { tipo: 'humano', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(T2) }, SENHA)).rejects.toThrow('Direct');
    expect(await q(`select id from atendimento_chamado where tenant_id = $1`, [T])).toHaveLength(0);
  });

  it('as rotas de TELEFONE do robô recusam `ig:` (V79): pedidos, situação do pedido e o link do cliente', async () => {
    const whats = new WhatsappService(db);
    // A loja do WhatsApp com um pedido cujo telefone termina nos mesmos 8 dígitos do cliente do Instagram.
    await q(`update cardapio_config set wa_cloud_phone_id = 'PID-DIRECT-1' where id = $1`, [CARD]);
    await q(`insert into pedido_externo (tenant_id, canal, cliente_telefone) values ($1, 'cardapio', $2)`, [T, `219${CLIENTE.slice(-8)}`]);
    try {
      await expect(whats.pedidosPorTelefoneBot(`ig:${CONTA}`, SENHA, `ig:${CLIENTE}`, '')).rejects.toThrow('não vinculado');
      expect(await whats.pedidosPorTelefoneBot('', SENHA, `ig:${CLIENTE}`, 'PID-DIRECT-1')).toEqual([]);
      expect((await whats.pedidosPorTelefoneBot('', SENHA, `219${CLIENTE.slice(-8)}`, 'PID-DIRECT-1')).length).toBe(1); // o telefone de verdade acha
      await expect(whats.statusPedidoBot(`ig:${CONTA}`, SENHA, `ig:${CLIENTE}`, '12', '')).rejects.toThrow('não vinculado');
      const clientes = new ClienteService(db, {} as any, { registrar: async () => {} } as any);
      await expect(clientes.criarLink(`tok-direct-${T.slice(0, 8)}`, { telefone: `ig:${CLIENTE}` }, SENHA)).rejects.toThrow('Direct');
      expect(await q(`select id from cliente where tenant_id = $1`, [T])).toHaveLength(0);
    } finally {
      await q(`update cardapio_config set wa_cloud_phone_id = null where id = $1`, [CARD]);
      await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    }
  });

  it('as instruções pela chave `ig:` são as do Direct (as do WhatsApp continuam pela chave do número)', async () => {
    const consultas = new RoboConsultasController(cardapio);
    const r: any = await consultas.instrucoes('2', `ig:${CONTA}`, '', undefined, SENHA);
    expect(r).toMatchObject({ canal: 'instagram', fluxo: 2 });
    expect(r.texto).toContain('no Direct do Instagram');
    await q(`update cardapio_config set wa_cloud_phone_id = 'PID-DIRECT-2' where id = $1`, [CARD]);
    try {
      const w: any = await consultas.instrucoes('2', '', 'PID-DIRECT-2', undefined, SENHA);
      expect(w.canal).toBeUndefined();
      expect(w.texto).toContain('no WhatsApp');
    } finally {
      await q(`update cardapio_config set wa_cloud_phone_id = null where id = $1`, [CARD]);
    }
  });

  it('as consultas do robô pela chave `ig:`: o cardápio do robô — só com o robô ligado; com dois cardápios, o escolhido', async () => {
    expect(await cardapio.tokenDaLojaDoRobo(SENHA, `ig:${CONTA}`, '')).toBe(`tok-direct-${T.slice(0, 8)}`);
    await ligarRobo(false);
    await expect(cardapio.tokenDaLojaDoRobo(SENHA, `ig:${CONTA}`, '')).rejects.toThrow('robô ligado');
    await ligarRobo(true);
    const [{ id: outro }] = await q(`insert into cardapio_config (tenant_id, token, ativo, unidade_id) values ($1, $2, true, gen_random_uuid()) returning id`, [T, `tok-direct-b-${T.slice(0, 8)}`]);
    await expect(cardapio.tokenDaLojaDoRobo(SENHA, `ig:${CONTA}`, '')).rejects.toThrow('robô ligado'); // dois e nenhum escolhido
    await q(`update instagram_conta set cardapio_id = $2 where tenant_id = $1`, [T, outro]);
    expect(await cardapio.tokenDaLojaDoRobo(SENHA, `ig:${CONTA}`, '')).toBe(`tok-direct-b-${T.slice(0, 8)}`);
    await expect(cardapio.tokenDaLojaDoRobo('senha-errada', `ig:${CONTA}`, '')).rejects.toThrow('autorizado');
  });

  it('robô indisponível (sem o endereço do fluxo do robô): a conversa vira CASO na hora, mesmo com a fila desligada (V88)', async () => {
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    await q(`update instagram_conta set fila_ligada = false where tenant_id = $1`, [T]);
    await svc.processar(aviso({ mid: 'v1', texto: 'Oi' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    const [c] = await casos();
    expect(c.detalhe.instagram).toMatchObject({ semRobo: 'robo_indisponivel' });
    // E a resposta que o fluxo tentasse mandar fica segurada.
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    await ligarRobo(false);
    expect(await responder('Oi')).toMatchObject({ enviado: false, motivo: 'robo_desligado' });
  });

  it('a rotina "sem resposta": a conversa em que o cliente espera há mais de 3 min vira caso — 110 que não contam na frente; duas rodadas = um caso', async () => {
    // 110 conversas respondidas pelo robô (a última é dele) e uma recente demais: nenhuma conta.
    await q(
      `insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, texto, mid, estado, criado_em)
       select $1, $2, (5000000000 + g)::text, d.direcao, d.autor, 'x', 'mid-' || g || '-' || d.autor, d.estado, now() - interval '10 minutes' + d.depois
         from generate_series(1, 110) g
         cross join (values ('entrada', 'cliente', 'recebida', interval '0'), ('saida', 'robo', 'enviada', interval '1 minute')) d(direcao, autor, estado, depois)`,
      [T, CONTA],
    );
    await q(`insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, texto, mid, estado, criado_em) values ($1, $2, '6000000001', 'entrada', 'cliente', 'recente', 'rec-1', 'recebida', now() - interval '1 minute')`, [T, CONTA]);
    // A que conta: o cliente escreveu há 5 min e a resposta do robô falhou (falhou não é resposta).
    await q(
      `insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, texto, mid, estado, criado_em) values
         ($1, $2, $3, 'entrada', 'cliente', 'Alguém aí?', 'sr-1', 'recebida', now() - interval '5 minutes'),
         ($1, $2, $3, 'saida', 'robo', 'Oi', null, 'falhou', now() - interval '4 minutes')`,
      [T, CONTA, CLIENTE],
    );
    expect(await svc.semResposta()).toBe(1);
    expect(await svc.semResposta()).toBe(0);
    const [c] = await casos();
    expect(c).toMatchObject({ mensagem: 'Alguém aí?' });
    expect(c.detalhe.instagram).toMatchObject({ semResposta: true });
    expect(await q(`select id from atendimento_chamado where tenant_id = $1`, [T])).toHaveLength(1);
    // Com o robô desligado, a rotina não abre nada (a fila já cuidou).
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await ligarRobo(false);
    expect(await svc.semResposta()).toBe(0);
  });

  // ───── HORÁRIO DA EQUIPE (mig 379): fora do horário (o do cardápio do robô), o caso do Direct nasce como RECADO ─────
  const FUSO = 'America/Sao_Paulo';
  const daqui3 = new Date(Date.now() + 3 * 86_400_000);
  const semanaSp = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(daqui3));
  const VOLTA = new Date(`${daqui3.toLocaleDateString('en-CA', { timeZone: FUSO })}T09:30:00-03:00`); // 30 min antes das 10:00
  const foraDoHorario = async (fn: () => Promise<void>) => {
    await q(`update robo_config set equipe_atende = 'loja' where tenant_id = $1`, [T]);
    await q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [CARD, JSON.stringify([{ dia: semanaSp, ativo: true, abre: '10:00', fecha: '11:00' }])]);
    try {
      await fn();
    } finally {
      await q(`update robo_config set equipe_atende = 'sempre' where tenant_id = $1`, [T]);
      await q(`update cardapio_config set horarios = '[]'::jsonb where id = $1`, [CARD]);
    }
  };

  it('fora do horário: o "chamar atendente" deixa RECADO — a frase para o cliente, sem posição — e o robô SEGUE respondendo; somar mantém', () =>
    foraDoHorario(async () => {
      await svc.processar(aviso({ mid: 'f1', texto: 'O lanche de ontem veio sem o molho' }));
      expect(await esperar(() => aoRobo.length === 1)).toBe(true);
      const tok = `tok-direct-${T.slice(0, 8)}`;
      const r: any = await cardapio.abrirAtendimento(tok, { tipo: 'erro', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(), mensagem: 'Motivo: faltou o molho' }, SENHA);
      expect(r).toMatchObject({ ok: true, foraDoHorario: true, posicao: null, comAlguem: false });
      expect(r.paraOCliente).toMatch(/^Nossa equipe volta (na|no) .+ às 09:30\. Já deixei o seu recado aqui/);
      const [c] = await casos();
      expect(c.detalhe.recado.ate).toBe(VOLTA.toISOString());
      expect(eventos.some((e) => e.nome === 'atendimento.novo' && e.dados.chamado.id === c.id)).toBe(true);
      // o robô manda a frase E continua respondendo (o recado não cala a conversa)
      expect(await responder(r.paraOCliente)).toMatchObject({ enviado: true });
      expect(await responder('Posso ajudar com mais alguma coisa?')).toMatchObject({ enviado: true });
      aoRobo.length = 0;
      await svc.processar(aviso({ mid: 'f2', texto: 'Vocês abrem amanhã?' }));
      expect(await esperar(() => aoRobo.length === 1)).toBe(true); // a mensagem nova vai ao robô…
      expect((await q(`select chamado_id from instagram_mensagem where mid = 'f2'`))[0].chamado_id).toBe(c.id); // …e entra no recado
      // chamar de novo: o mesmo recado, a mesma frase
      const r2: any = await cardapio.abrirAtendimento(tok, { tipo: 'erro', telefone: `ig:${CLIENTE}`, conversa: fichaDoDirect(), mensagem: 'Motivo: de novo' }, SENHA);
      expect(r2).toMatchObject({ id: c.id, foraDoHorario: true, paraOCliente: r.paraOCliente });
      expect(await casos()).toHaveLength(1);
      expect((await casos())[0].detalhe.recado.ate).toBe(VOLTA.toISOString());
    }));

  it('fora do horário: com o robô desligado e a fila ligada, a conversa nova vira RECADO (não toca)', () =>
    foraDoHorario(async () => {
      await ligarRobo(false);
      await svc.processar(aviso({ mid: 'f3', texto: 'Oi, boa noite' }));
      await quieto();
      const [c] = await casos();
      expect(c.detalhe.recado).toMatchObject({ ate: VOLTA.toISOString() });
    }));

  it('fora do horário: o "sem resposta" (3 min) vira RECADO para a abertura', () =>
    foraDoHorario(async () => {
      await q(
        `insert into instagram_mensagem (tenant_id, ig_user_id, igsid, direcao, autor, texto, mid, estado, criado_em)
         values ($1, $2, $3, 'entrada', 'cliente', 'Alguém aí?', 'sr-f', 'recebida', now() - interval '5 minutes')`,
        [T, CONTA, CLIENTE],
      );
      expect(await svc.semResposta()).toBe(1);
      const [c] = await casos();
      expect(c.detalhe).toMatchObject({ instagram: { semResposta: true }, recado: { ate: VOLTA.toISOString() } });
    }));

  it('"Conversas agora": o Direct com o robô aparece para a gestão (com o perfil e as mensagens) e some depois do "Assumir"; a execução não vê nem assume', async () => {
    await q(`insert into instagram_contato (tenant_id, igsid, usuario, nome, segue_a_loja) values ($1, $2, 'livia.ramos', 'Lívia Ramos', false)`, [T, CLIENTE]);
    await svc.processar(aviso({ mid: 'c1', texto: 'Entregam na Penha?' }));
    await responder('Entregamos! A taxa é R$ 6,00.');
    const gestao = { tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente', permissoes: {} } as any;
    const r: any = await chat.conversasAgora(T, null, gestao);
    const c = r.conversas.find((x: any) => x.canal === 'instagram');
    expect(r.instagram).toEqual({ ligado: true, lida: true });
    expect(c).toMatchObject({ chave: `ig:${CLIENTE}`, cliente: 'Lívia Ramos', usuario: '@livia.ramos', segue: false, comRobo: true });
    expect(c.mensagens.map((m: any) => m.autor)).toEqual(['cliente', 'robo']);
    const exec = { tenantId: T, colaboradorId: pessoa.edu, categoria: 'execucao', permissoes: {} } as any;
    expect(((await chat.conversasAgora(T, null, exec)) as any).conversas.some((x: any) => x.canal === 'instagram')).toBe(false);
    await expect(chat.assumir(exec, { canal: 'instagram', chave: `ig:${CLIENTE}` })).rejects.toThrow('gerência');
    const a: any = await chat.assumir(gestao, { canal: 'instagram', chave: `ig:${CLIENTE}` });
    const [caso] = await casos();
    expect(caso).toMatchObject({ id: a.id, responsavel_id: pessoa.ana, cliente: 'Lívia Ramos', mensagem: 'Entregam na Penha?' });
    expect(((await chat.conversasAgora(T, null, gestao)) as any).conversas.some((x: any) => x.canal === 'instagram')).toBe(false);
    // Assumida: a mensagem seguinte entra no caso e não vai ao robô.
    aoRobo.length = 0;
    await svc.processar(aviso({ mid: 'c2', texto: 'E até que horas?' }));
    await quieto();
    expect(aoRobo).toHaveLength(0);
    // Do servidor da loja, a nuvem confere quem assume (outra empresa = recusa).
    await expect(chat.assumirVindoDaLoja(T, { canal: 'instagram', chave: `ig:${CLIENTE}`, atorId: pessoa.gil, atorPerfil: 'gerente' })).rejects.toThrow();
    const daLoja: any = await chat.conversasVindoDaLoja(T, { categoria: 'gerente' });
    expect(daLoja.instagram).toEqual({ ligado: true, lida: true });
  });

  it('"Conversas agora" num banco SEM as tabelas do Instagram (ou sem a 378): o Direct não está ligado e os outros canais seguem; outra falha vem como "não li" (ERR-393)', async () => {
    const dialeto = new PgDialect();
    const comFalha = (codigo: string) =>
      new Proxy(db, {
        get(alvo: any, nome) {
          if (nome !== 'execute') return alvo[nome];
          return (consulta: any) =>
            /instagram_/.test(dialeto.sqlToQuery(consulta).sql) ? Promise.reject(Object.assign(new Error('falha de teste'), { code: codigo })) : alvo.execute(consulta);
        },
      });
    const gestao = { tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente', permissoes: {} } as any;
    for (const [codigo, esperado] of [['42P01', { ligado: false, lida: true }], ['42703', { ligado: false, lida: true }], ['57014', { ligado: true, lida: false }]] as const) {
      const r: any = await new ChatDoCasoService(comFalha(codigo), { emit: () => true } as any, {} as any).conversasAgora(T, null, gestao);
      expect(r.instagram).toEqual(esperado);
      expect(Array.isArray(r.conversas)).toBe(true);
    }
  });

  it('os ajustes: liga/desliga só com booleano, o cardápio de outra empresa e o robô sem conta recusados ANTES de gravar; o que vale fica na auditoria', async () => {
    const user = { tenantId: T, colaboradorId: pessoa.ana, categoria: 'gerente' } as any;
    await expect(svc.conferirAjuste(T, { roboResponde: 'sim' })).rejects.toThrow('ligado ou desligado');
    await expect(svc.conferirAjuste(T, { cardapioId: CARD2 })).rejects.toThrow('não é desta empresa');
    await expect(svc.conferirAjuste(T, { cardapioId: 'nao-e-uuid' })).rejects.toThrow('cardápio');
    await expect(svc.conferirAjuste(T2, { roboResponde: true })).rejects.toThrow('Conecte o Instagram');
    const a = await svc.conferirAjuste(T, { roboResponde: false, cardapioId: CARD });
    expect(a).toEqual({ roboResponde: false, cardapioId: CARD }); // a fila não veio: fica (V16)
    await svc.salvarAjuste(user, a);
    expect((await q(`select robo_responde, cardapio_id, fila_ligada from instagram_conta where tenant_id = $1`, [T]))[0]).toEqual({ robo_responde: false, cardapio_id: CARD, fila_ligada: true });
    expect(auditados.map((x) => x.acao).sort()).toEqual(['cardapio_do_robo_no_direct', 'robo_no_direct_desligado']);
    const aj: any = await svc.ajuste(T);
    expect(aj).toMatchObject({ roboDisponivel: true, conta: { roboResponde: false, cardapioId: CARD } });
    expect(aj.cardapios).toEqual([{ id: CARD, nome: 'Burger da Praça', ativo: true }]);
  });

  it('os Números: a resposta do robô conta como respondida na linha do Instagram', async () => {
    await svc.processar(aviso({ mid: 'n1', texto: 'Oi', em: Date.now() - 60_000 }));
    await responder('Oi! Tudo bem?');
    const n: any = await new NumerosDoAtendimentoService(db).numeros(T, null, '7');
    expect(n.canais.find((c: any) => c.k === 'chat-instagram')).toMatchObject({ chegaram: 1, respondidas: 1, semResposta: 0 });
  });
});
