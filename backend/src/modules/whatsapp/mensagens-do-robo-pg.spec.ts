import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, Logger } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { RoboRespostaService } from './robo-resposta.service';
import { WhatsappService } from './whatsapp.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappCaixaController } from './whatsapp-caixa.controller';
import { WhatsappDaLojaController } from './whatsapp-da-loja.controller';
import { linkDoCardapioDaLoja } from './links-do-robo';
import { comMarcaDoRobo, esquecerAvisoDaMarca, limparMarcasDoRobo, marcarDoRobo } from './mensagens-do-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CORRIGIR NO WHATSAPP" (mig 385), contra o Postgres real, uma META e uma EVOLUTION DE MENTIRA locais (nada sai para fora):
// a resposta do robô (`publico/bot/responder`) anota o id de cada mensagem que SAIU — texto, botões, lista, menu numerado,
// botão de link, voz e enquete, nas duas vias —; a equipe (a caixa de conversas) NÃO anota; a caixa (`GET
// /whatsapp/mensagens`, nas duas vias e pelo servidor da loja) devolve `doRobo` só na mensagem que a loja mandou e que está
// anotada NESTA empresa; o que já saiu fica anotado mesmo se o envio seguinte falhar; sem a 385 nada quebra (todas `false`, um
// aviso só); a limpeza dos 30 dias. Aplica as migrations só da nuvem (o banco do CI é o de uma loja — ERR-329) com a trava da
// empresa na frente (ERR-377) e a repetição da corrida (ERR-405).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('mensagens-do-robo-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SENHA = 'senha-do-robo-corrigir-whatsapp';
// O número da API oficial e o cliente, próprios deste spec (o phone id é único entre as lojas).
const PHONE = '109000000000385';
const TEL = '5521988880385';
const JID = `${TEL}@s.whatsapp.net`;

descrever('"Corrigir no WhatsApp": a marca da fala do robô (Postgres + Meta e Evolution de mentira)', () => {
  let pool: Pool;
  let db: any;
  let TC: string; // a loja na API oficial
  let TE: string; // a loja na Evolution
  let T2: string; // outra empresa
  let TOKC = '';
  let INST = '';
  let evolution: WhatsappService;
  let cloud: WhatsappCloudService;
  let provedores: WhatsappProvedorService;
  let robo: RoboRespostaService;
  let caixa: WhatsappCaixaController;
  let daLoja: WhatsappDaLojaController;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aMeta: Array<{ caminho: string; corpo: any; wamid: string | null }> = [];
  const aEvolution: Array<{ caminho: string; corpo: any; id: string | null }> = [];
  const aNuvem: Array<{ caminho: string; token: string | undefined; empresa: string | undefined }> = [];
  // Os registros que o `findMessages` da Evolution devolve (cada teste monta os seus).
  let registrosDaEvolution: any[] = [];
  // A Meta recusa as mensagens depois de N aceitas (nulo = aceita todas).
  let metaAceitaAte: number | null = null;
  let n = 0;
  const fetchOriginal = global.fetch;
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
      } finally {
        c.release();
      }
    });
  const marcas = async (tenant: string) =>
    (await q(`select mensagem_id, telefone from whatsapp_do_robo where tenant_id = $1 order by criado_em, mensagem_id`, [tenant])).map(
      (l) => l.mensagem_id as string,
    );
  const linhasDasMarcas = (tenant: string) => q(`select * from whatsapp_do_robo where tenant_id = $1 order by criado_em`, [tenant]);
  const responderCloud = (extra: any) => robo.responder(SENHA, { phoneNumberId: PHONE, para: '+55 (21) 98888-0385', ...extra });
  const responderEvo = (extra: any) => robo.responder(SENHA, { instancia: INST, para: JID, ...extra });
  const usuario = (tenantId: string) => ({ tenantId, colaboradorId: null }) as any;
  const wamidsDaMeta = () => aMeta.filter((m) => m.caminho.endsWith('/messages') && m.wamid).map((m) => m.wamid as string);
  const porTexto = (lista: any[], trecho: string) => lista.find((m) => String(m.texto ?? '').includes(trecho));

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['215_whatsapp_mensagem.sql', '342_robo_pausa_e_config.sql', '385_mensagem_do_robo_no_whatsapp.sql']) await aplicar(m);
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
        const json = /json/i.test(String(req.headers['content-type'] ?? '')) && corpo ? JSON.parse(corpo) : null;
        // A META (Graph): o upload da voz e as mensagens (o wamid volta em `messages[0].id`, como na doc da Meta).
        if (u.pathname.startsWith('/graph/')) {
          if (u.pathname.endsWith('/media')) return j(200, { id: `midia-${++n}` });
          if (u.pathname.endsWith('/messages')) {
            const aceitas = aMeta.filter((m) => m.caminho.endsWith('/messages') && m.wamid).length;
            if (metaAceitaAte !== null && aceitas >= metaAceitaAte) {
              aMeta.push({ caminho: u.pathname, corpo: json, wamid: null });
              return j(400, { error: { message: '(#131047) Re-engagement message', code: 131047 } });
            }
            const wamid = `wamid.HBgN385${++n}${randomBytes(4).toString('hex').toUpperCase()}`;
            aMeta.push({ caminho: u.pathname, corpo: json, wamid });
            return j(200, { messaging_product: 'whatsapp', contacts: [{ input: json?.to, wa_id: json?.to }], messages: [{ id: wamid, message_status: 'accepted' }] });
          }
          return j(404, { error: { message: 'rota desconhecida' } });
        }
        // A EVOLUTION: os envios devolvem a mensagem com `key.id` (a v2); o findMessages devolve os registros do teste.
        if (u.pathname.startsWith('/evo/')) {
          if (req.headers.apikey !== 'chave-da-evolution') return j(401, { message: 'Unauthorized' });
          if (u.pathname.startsWith('/evo/message/send')) {
            const id = `3EB0${randomBytes(8).toString('hex').toUpperCase()}`;
            aEvolution.push({ caminho: u.pathname, corpo: json, id });
            return j(201, { key: { remoteJid: `${json?.number}@s.whatsapp.net`, fromMe: true, id }, status: 'PENDING', messageTimestamp: Math.floor(Date.now() / 1000) });
          }
          if (u.pathname.startsWith('/evo/chat/findMessages/')) {
            aEvolution.push({ caminho: u.pathname, corpo: json, id: null });
            return j(200, { messages: { total: registrosDaEvolution.length, records: registrosDaEvolution } });
          }
          return j(404, { message: 'rota desconhecida' });
        }
        // A NUVEM, para o servidor da loja: o `whatsapp/da-loja/mensagens` de verdade (o controlador da nuvem).
        if (u.pathname === '/nuvem/whatsapp/da-loja/mensagens') {
          aNuvem.push({ caminho: `${u.pathname}${u.search}`, token: req.headers['x-sync-token'] as string, empresa: req.headers['x-regem-empresa'] as string });
          const edge = process.env.EDGE_MODE;
          delete process.env.EDGE_MODE; // este pedaço é a NUVEM respondendo
          try {
            return j(200, await daLoja.mensagens({ tenantId: req.headers['x-regem-empresa'] } as any, u.searchParams.get('jids') ?? '', ''));
          } catch (e: any) {
            return j(500, { message: String(e?.message ?? e) });
          } finally {
            if (edge === undefined) delete process.env.EDGE_MODE;
            else process.env.EDGE_MODE = edge;
          }
        }
        return j(404, { message: 'rota desconhecida' });
      });
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    // A Graph tem endereço fixo no serviço: só ela é desviada para a Meta de mentira; o resto passa.
    global.fetch = ((url: any, init: any) => {
      const s = String(url);
      return fetchOriginal(s.startsWith('https://graph.facebook.com/') ? s.replace('https://graph.facebook.com', `${base}/graph`) : url, init);
    }) as any;
    const env: Record<string, string> = {
      BOT_RESOLVER_SECRET: SENHA,
      WA_CLOUD_TOKEN: 'token-da-meta-de-mentira',
      EVOLUTION_API_URL: `${base}/evo`,
      EVOLUTION_API_KEY: 'chave-da-evolution',
      CARDAPIO_PUBLIC_URL: 'https://app.teste',
      APP_URL: 'https://app.teste',
      CLOUD_API: `${base}/nuvem`,
      SYNC_TOKEN: 'tok-do-servidor-da-loja-385',
    };
    for (const [k, v] of Object.entries(env)) {
      antes[k] = process.env[k];
      process.env[k] = v;
    }
    antes.EDGE_MODE = process.env.EDGE_MODE;
    delete process.env.EDGE_MODE;
    const auditoria = { registrar: async () => undefined } as any;
    evolution = new WhatsappService(db);
    cloud = new WhatsappCloudService(db);
    provedores = new WhatsappProvedorService(db, auditoria, evolution, cloud);
    robo = new RoboRespostaService(db, evolution, cloud);
    caixa = new WhatsappCaixaController(evolution, provedores, cloud);
    daLoja = new WhatsappDaLojaController(evolution, provedores, cloud);
    [{ id: TC }] = await q(`insert into empresa (nome) values ('teste corrigir no whatsapp — oficial') returning id`);
    [{ id: TE }] = await q(`insert into empresa (nome) values ('teste corrigir no whatsapp — evolution') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa do corrigir no whatsapp') returning id`);
    TOKC = `tok-wa385-${TC.slice(0, 8)}`;
    INST = `inst-wa385-${TE.slice(0, 8)}`;
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, nome_publico, robo_ativo, provedor, wa_cloud_phone_id)
       values ($1, $2, true, 'Burger da Praça', true, 'cloud', $3)`,
      [TC, TOKC, PHONE],
    );
    await q(
      `insert into cardapio_config (tenant_id, token, ativo, nome_publico, robo_ativo, provedor, evolution_instancia)
       values ($1, $2, true, 'Pizza do Largo', true, 'evolution', $3)`,
      [TE, `tok-wa385-${TE.slice(0, 8)}`, INST],
    );
  });
  afterAll(async () => {
    global.fetch = fetchOriginal;
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const s of soquetes) s.destroy();
    if (servidor) await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const t of [TC, TE, T2].filter(Boolean)) await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    aMeta.length = 0;
    aEvolution.length = 0;
    aNuvem.length = 0;
    registrosDaEvolution = [];
    metaAceitaAte = null;
    esquecerAvisoDaMarca();
    await q(`delete from whatsapp_do_robo where tenant_id in ($1, $2, $3)`, [TC, TE, T2]);
    await q(`delete from whatsapp_mensagem where tenant_id in ($1, $2, $3)`, [TC, TE, T2]);
    await q(`delete from robo_pausa where tenant_id in ($1, $2, $3)`, [TC, TE, T2]);
  });

  it('a 385 de novo: idempotente, e a conferência no mesmo Run vem toda ok', async () => {
    const r: any = await aplicar('385_mensagem_do_robo_no_whatsapp.sql');
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    expect(conferencia.length).toBe(5);
    expect(conferencia.filter((l: any) => l.ok !== true)).toEqual([]);
  });

  it('API oficial: o texto do robô sai e fica marcado (wamid, empresa, telefone); a equipe manda pela caixa e NÃO marca; a lista diz quem é quem', async () => {
    expect(await responderCloud({ texto: 'Olá! Sou o atendente virtual. Posso ajudar?' })).toEqual({ ok: true, enviado: true, enviados: ['texto'] });
    const [wamidRobo] = wamidsDaMeta();
    expect(aMeta[0]).toMatchObject({ caminho: `/graph/v25.0/${PHONE}/messages`, corpo: { to: TEL, type: 'text', text: { body: 'Olá! Sou o atendente virtual. Posso ajudar?' } } });
    const [l] = await linhasDasMarcas(TC);
    expect(l).toMatchObject({ tenant_id: TC, mensagem_id: wamidRobo, telefone: TEL });
    expect((await q(`select clock_timestamp() - criado_em < interval '1 minute' as recente from whatsapp_do_robo where tenant_id = $1`, [TC]))[0].recente).toBe(true);
    // A EQUIPE pela caixa de conversas: sai pela mesma Cloud, devolve o id, mas não é fala do robô.
    const daEquipe: any = await caixa.enviar(usuario(TC), { numero: TEL, texto: 'Aqui é a Ana, já vejo o seu pedido.' });
    expect(daEquipe).toMatchObject({ ok: true, id: expect.stringMatching(/^wamid\./) });
    expect(await marcas(TC)).toEqual([wamidRobo]);
    // O cliente escreveu (entrada) — e, de propósito, o id dele marcado nesta empresa: não é a loja que mandou.
    await q(`insert into whatsapp_mensagem (tenant_id, telefone, direcao, tipo, texto, wamid) values ($1, $2, 'entrada', 'text', 'Oi, quero um combo', 'wamid.CLIENTE385')`, [TC, TEL]);
    await q(`insert into whatsapp_do_robo (tenant_id, mensagem_id, telefone) values ($1, 'wamid.CLIENTE385', $2)`, [TC, TEL]);
    // A mensagem da equipe marcada em OUTRA empresa: não vale aqui.
    await q(`insert into whatsapp_do_robo (tenant_id, mensagem_id, telefone) values ($1, $2, $3)`, [T2, daEquipe.id, TEL]);
    const lista: any[] = (await caixa.mensagens(usuario(TC), TEL)) as any;
    expect(lista).toHaveLength(3);
    expect(porTexto(lista, 'Sou o atendente virtual')).toMatchObject({ id: wamidRobo, fromMe: true, doRobo: true });
    expect(porTexto(lista, 'Aqui é a Ana')).toMatchObject({ id: daEquipe.id, fromMe: true, doRobo: false });
    expect(porTexto(lista, 'quero um combo')).toMatchObject({ id: 'wamid.CLIENTE385', fromMe: false, doRobo: false });
    // Nada mais muda na mensagem: os mesmos campos de antes + `doRobo`.
    for (const m of lista) expect(Object.keys(m).sort()).toEqual(['doRobo', 'fromMe', 'id', 'midia', 'midiaKey', 'status', 'texto', 'timestamp']);
  });

  it('API oficial: botões, lista, menu numerado, botão de link e voz — cada mensagem que saiu fica marcada', async () => {
    const ops = (k: number) => Array.from({ length: k }, (_, i) => ({ titulo: `Opção ${i + 1}` }));
    expect(await responderCloud({ texto: 'Como prefere?', opcoes: ops(3) })).toMatchObject({ enviados: ['botoes'] });
    expect(await responderCloud({ texto: 'Escolha o lanche:', opcoes: ops(5) })).toMatchObject({ enviados: ['lista'] });
    expect(await responderCloud({ texto: 'Escolha o sabor:', opcoes: ops(11) })).toMatchObject({ enviados: ['menu_numerado'] });
    expect(await responderCloud({ texto: `Veja o cardápio: ${linkDoCardapioDaLoja(TOKC)}` })).toMatchObject({ enviados: ['botao_link'] });
    expect(await responderCloud({ texto: 'E também por escrito.', audio: { base64: Buffer.from('OggS-voz').toString('base64'), mime: 'audio/ogg' } })).toMatchObject({
      enviados: ['voz', 'texto'],
    });
    const enviadas = wamidsDaMeta();
    expect(enviadas).toHaveLength(6);
    expect(aMeta.filter((m) => m.caminho.endsWith('/messages')).map((m) => m.corpo?.type)).toEqual(['interactive', 'interactive', 'text', 'interactive', 'audio', 'text']);
    expect([...(await marcas(TC))].sort()).toEqual([...enviadas].sort());
    // E a caixa marca todas como do robô.
    const lista: any[] = (await provedores.mensagens(TC, TEL)) as any;
    expect(lista).toHaveLength(6);
    expect(lista.every((m) => m.fromMe === true && m.doRobo === true)).toBe(true);
  });

  it('Evolution: o envio devolve o key.id; texto, menu numerado, enquete e voz do robô ficam marcados; a equipe não; a lista (findMessages) diz quem é quem', async () => {
    expect(await responderEvo({ texto: 'Olá! Sou o atendente virtual.' })).toEqual({ ok: true, enviado: true, enviados: ['texto'] });
    expect(await responderEvo({ texto: 'Como prefere?', opcoes: [{ titulo: 'Entrega' }, { titulo: 'Retirada' }] })).toMatchObject({ enviados: ['menu_numerado'] });
    expect(await responderEvo({ texto: 'Qual tamanho?', opcoes: [{ titulo: 'Média' }, { titulo: 'Grande' }], opcoesComo: 'enquete' })).toMatchObject({ enviados: ['enquete'] });
    expect(await responderEvo({ audio: { base64: Buffer.from('mp3-voz').toString('base64') } })).toMatchObject({ enviados: ['voz'] });
    const doRobo = aEvolution.map((e) => e.id as string);
    expect(aEvolution.map((e) => e.caminho)).toEqual([
      `/evo/message/sendText/${INST}`,
      `/evo/message/sendText/${INST}`,
      `/evo/message/sendPoll/${INST}`,
      `/evo/message/sendWhatsAppAudio/${INST}`,
    ]);
    expect([...(await marcas(TE))].sort()).toEqual([...doRobo].sort());
    expect((await linhasDasMarcas(TE)).every((l) => l.telefone === TEL)).toBe(true);
    // O contrato novo do envio da Evolution: `{ ok, id }` com o key.id (e o envio direto não marca nada).
    const direto = await evolution.enviar(TE, TEL, 'teste do contrato');
    expect(direto).toEqual({ ok: true, id: aEvolution[aEvolution.length - 1].id });
    // A EQUIPE pela caixa: devolve o id, não marca.
    const daEquipe: any = await caixa.enviar(usuario(TE), { jid: JID, texto: 'Aqui é a Ana.' });
    expect(daEquipe).toEqual({ ok: true, id: aEvolution[aEvolution.length - 1].id });
    expect([...(await marcas(TE))].sort()).toEqual([...doRobo].sort());
    // A lista da Evolution: as do robô, a da equipe (marcada em OUTRA empresa) e a do cliente (marcada aqui, de propósito).
    await q(`insert into whatsapp_do_robo (tenant_id, mensagem_id) values ($1, $2), ($3, 'CLIENTE385EVO')`, [T2, daEquipe.id, TE]);
    const reg = (id: string, fromMe: boolean, texto: string, ts: number) => ({ key: { id, fromMe, remoteJid: JID }, message: { conversation: texto }, messageTimestamp: ts });
    registrosDaEvolution = [
      reg('CLIENTE385EVO', false, 'Oi, tem pizza de calabresa?', 100),
      reg(doRobo[0], true, 'Olá! Sou o atendente virtual.', 101),
      reg(doRobo[1], true, 'Como prefere? 1) Entrega 2) Retirada', 102),
      reg(daEquipe.id, true, 'Aqui é a Ana.', 103),
    ];
    const lista: any[] = (await caixa.mensagens(usuario(TE), JID)) as any;
    expect(aEvolution[aEvolution.length - 1]).toMatchObject({ caminho: `/evo/chat/findMessages/${INST}`, corpo: { where: { key: { remoteJid: JID } } } });
    expect(lista.map((m) => [m.texto, m.fromMe, m.doRobo])).toEqual([
      ['Oi, tem pizza de calabresa?', false, false],
      ['Olá! Sou o atendente virtual.', true, true],
      ['Como prefere? 1) Entrega 2) Retirada', true, true],
      ['Aqui é a Ana.', true, false],
    ]);
  });

  it('servidor da loja: a caixa repassa à nuvem (whatsapp/da-loja) e a marca chega igual; no servidor da loja a leitura nem vai ao banco', async () => {
    await responderCloud({ texto: 'Olá! Sou o atendente virtual (pela loja).' });
    await caixa.enviar(usuario(TC), { numero: TEL, texto: 'Aqui é o Edu, da loja.' });
    process.env.EDGE_MODE = 'true';
    const lista: any[] = (await caixa.mensagens(usuario(TC), TEL)) as any;
    expect(aNuvem).toEqual([{ caminho: `/nuvem/whatsapp/da-loja/mensagens?jids=${TEL}`, token: 'tok-do-servidor-da-loja-385', empresa: TC }]);
    expect(porTexto(lista, 'pela loja')).toMatchObject({ fromMe: true, doRobo: true });
    expect(porTexto(lista, 'Aqui é o Edu')).toMatchObject({ fromMe: true, doRobo: false });
    // V1: rodando como servidor da loja, a marca não é lida (a tabela é só da nuvem) — todas `false`, sem consulta.
    const semBanco: any = { execute: async () => Promise.reject(new Error('não devia consultar')) };
    const avisos: string[] = [];
    expect(await comMarcaDoRobo(semBanco, TC, [{ id: 'x', fromMe: true }], { warn: (m) => avisos.push(m) })).toEqual([{ id: 'x', fromMe: true, doRobo: false }]);
    expect(await marcarDoRobo(semBanco, TC, TEL, ['wamid.X385'], { warn: (m) => avisos.push(m) })).toBe(0);
    expect(avisos).toEqual([]);
  });

  it('o que já saiu fica marcado mesmo se o envio seguinte falhar (a voz saiu, a Meta recusou o texto); a resposta falha como antes', async () => {
    metaAceitaAte = 1;
    await expect(responderCloud({ texto: 'Segue por escrito.', audio: { base64: Buffer.from('OggS-voz').toString('base64') } })).rejects.toThrow(BadRequestException);
    const [voz] = wamidsDaMeta();
    expect(aMeta.filter((m) => m.caminho.endsWith('/messages')).map((m) => [m.corpo?.type, !!m.wamid])).toEqual([
      ['audio', true],
      ['text', false],
    ]);
    expect(await marcas(TC)).toEqual([voz]);
  });

  it('a gravação repetida não duplica (on conflict) e id vazio, nulo ou de outro tipo não grava', async () => {
    const avisos: string[] = [];
    const log = { warn: (m: string) => avisos.push(m) };
    expect(await marcarDoRobo(db, TC, '+55 21 98888-0385', ['wamid.A385', 'wamid.A385', null, '', '   ', 42 as any, 'wamid.B385'], log)).toBe(2);
    expect(await marcarDoRobo(db, TC, TEL, ['wamid.A385', 'wamid.B385'], log)).toBe(0);
    expect((await linhasDasMarcas(TC)).map((l) => [l.mensagem_id, l.telefone]).sort()).toEqual([
      ['wamid.A385', TEL],
      ['wamid.B385', TEL],
    ]);
    expect(await marcarDoRobo(db, TC, TEL, [null, ''], log)).toBe(0);
    expect(avisos).toEqual([]);
  });

  it('sem a 385 (banco que ainda não tem a tabela): o robô responde igual, a caixa abre com doRobo false em todas e o aviso sai UMA vez', async () => {
    // Um esquema só com o que o caminho lê (visões das tabelas de verdade), SEM a whatsapp_do_robo: o Postgres responde
    // 42P01 de verdade quando o código a procura.
    const [{ s: principal }] = await q(`select current_schema() as s`);
    const vazio = `sem385_${randomBytes(4).toString('hex')}`;
    await q(`create schema ${vazio}`);
    for (const t of ['cardapio_config', 'robo_pausa', 'robo_config', 'atendimento_chamado'])
      await q(`create view ${vazio}.${t} as select * from "${principal}".${t}`);
    const poolSem385 = new Pool({ connectionString: URL_PG, options: `-c search_path=${vazio}` });
    const avisos = jest.spyOn(Logger.prototype, 'warn');
    const erros = jest.spyOn(Logger.prototype, 'error');
    try {
      const dbSem385: any = drizzle(poolSem385, { schema });
      const roboSem385 = new RoboRespostaService(dbSem385, evolution, cloud);
      const caixaSem385 = new WhatsappProvedorService(dbSem385, { registrar: async () => undefined } as any, evolution, cloud);
      expect(await roboSem385.responder(SENHA, { phoneNumberId: PHONE, para: TEL, texto: 'Olá! (banco sem a 385)' })).toEqual({ ok: true, enviado: true, enviados: ['texto'] });
      expect(await roboSem385.responder(SENHA, { phoneNumberId: PHONE, para: TEL, texto: 'De novo (banco sem a 385)' })).toMatchObject({ enviado: true });
      const lista: any[] = (await caixaSem385.mensagens(TC, TEL)) as any;
      expect(lista).toHaveLength(2);
      expect(lista.every((m) => m.fromMe === true && m.doRobo === false)).toBe(true);
      const daLimpeza: string[] = [];
      expect(await limparMarcasDoRobo(dbSem385, { warn: (m) => daLimpeza.push(m) })).toBe(0);
      expect(daLimpeza).toEqual([]); // a limpeza sem a tabela fica quieta
      const daMarca = avisos.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('mig 385'));
      expect(daMarca).toHaveLength(1);
      expect(erros).not.toHaveBeenCalled();
      // Nada foi marcado no banco de verdade.
      expect(await marcas(TC)).toEqual([]);
    } finally {
      avisos.mockRestore();
      erros.mockRestore();
      await poolSem385.end();
      await q(`drop schema ${vazio} cascade`);
    }
  });

  it('a limpeza (rotina de 6 h da nuvem): as marcas com mais de 30 dias saem; as de 29 dias e as de agora ficam; no servidor da loja não roda', async () => {
    await q(
      `insert into whatsapp_do_robo (tenant_id, mensagem_id, telefone, criado_em) values
         ($1, 'wamid.VELHA385', $2, now() - interval '31 days'),
         ($1, 'wamid.QUASE385', $2, now() - interval '29 days'),
         ($1, 'wamid.AGORA385', $2, now()),
         ($3, 'VELHA385EVO', $2, now() - interval '45 days')`,
      [TC, TEL, TE],
    );
    process.env.EDGE_MODE = 'true';
    await cloud.expurgarHistorico();
    expect(await limparMarcasDoRobo(db, { warn: () => undefined })).toBe(0);
    expect((await marcas(TC)).sort()).toEqual(['wamid.AGORA385', 'wamid.QUASE385', 'wamid.VELHA385']);
    delete process.env.EDGE_MODE;
    await cloud.expurgarHistorico();
    expect((await marcas(TC)).sort()).toEqual(['wamid.AGORA385', 'wamid.QUASE385']);
    expect(await marcas(TE)).toEqual([]);
  });
});
