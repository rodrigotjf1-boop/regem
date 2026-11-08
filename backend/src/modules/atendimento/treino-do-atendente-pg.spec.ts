import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, ConflictException, HttpException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CABECALHO_ASSINATURA_REGEM, CABECALHO_SEGREDO_ROBO } from '../../common/segredo-robo';
import { chaveDoTeste } from '../../common/conversa-do-robo';
import { AtendimentoService } from './atendimento.service';
import { FilaEAvisosService } from './fila-e-avisos.service';
import { TreinoDoAtendenteService, TEXTO_NAO_RECEBEU } from './treino.service';
import { AUDIO_NO_TESTE, LINHA_DO_LINK, LINHA_DO_PEDIDO, RESPOSTA_DO_PEDIDO_NO_TESTE } from './teste-do-atendente';
import { textoDaVolta } from './horario-da-equipe';
import { CardapioService } from '../cardapio/cardapio.service';
import { RoboConsultasController } from '../cardapio/robo-consultas.controller';
import { RoboPedidoService } from '../cardapio/robo-pedido.service';
import { RoboPedidoController } from '../cardapio/robo-pedido.controller';
import { REGRA_DOS_NUMEROS, TITULO_DO_CONHECIMENTO, LIMITE_DO_CONHECIMENTO } from '../cardapio/conhecimento-do-atendente';
import { TEXTO_PADRAO_DO_RECADO } from '../cardapio/assuntos-do-atendente';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { WhatsappCloudService } from '../whatsapp/whatsapp-cloud.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { EvolutionEntradaService } from '../whatsapp/evolution-entrada.service';
import { linkDoCardapioDaLoja } from '../whatsapp/links-do-robo';
import { ClienteService } from '../cliente/cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TREINAR O ATENDENTE (mig 382 — F4 do atendente virtual), contra o Postgres real: a conversa de TESTE (abrir, a retenção
// de 7 dias, o limite por minuto, a entrega ao robô de verdade com o CORPO que sai, a resposta do robô por
// publico/bot/responder gravada sem nada sair), as ferramentas do robô com a chave `teste:` (as consultas leem a loja; as
// instruções do canal do teste; o "chamar atendente" SIMULADO com a mesma resposta do caminho real e nenhum caso; o pedido
// que não é montado; o link, os envios e as rotas de telefone que recusam; a entrada da Evolution que ignora) e o que o
// atendente APRENDEU (criar, editar, apagar, a auditoria, o limite de 100 com a corrida). As rotas HTTP e o RBAC estão em
// `treino-rotas-pg.spec.ts`. Aplica a 342, a 353 e a 379–382 (só da nuvem: o banco do CI é o de uma loja — ERR-329), com
// a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('treino-do-atendente-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SENHA = 'senha-do-robo-do-treino';
const N8N = 'https://n8n.teste.invalid/webhook/robo';
const FUSO = 'America/Sao_Paulo';
const diaSp = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FUSO });
const semanaSp = (d: Date) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(d));
// Uma janela daqui a 3 dias (10:00–11:00): agora está SEMPRE fora dela, e a equipe volta às 09:30 desse dia (30 min antes).
const daqui3 = new Date(Date.now() + 3 * 86_400_000);
const JANELA_LONGE = [{ dia: semanaSp(daqui3), ativo: true, abre: '10:00', fecha: '11:00' }];
const VOLTA = new Date(`${diaSp(daqui3)}T09:30:00-03:00`);
// Todos os dias, 00:00–23:59 (com a folga, sem buraco): agora está SEMPRE dentro.
const SEMPRE_ABERTA = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre: '00:00', fecha: '23:59' }));

descrever('treinar o atendente (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let atend: AtendimentoService;
  let cardapioSvc: CardapioService;
  let consultas: RoboConsultasController;
  let treino: TreinoDoAtendenteService;
  let resposta: RoboRespostaService;
  let pedidoCtl: RoboPedidoController;
  let clienteSvc: ClienteService;
  const avisos: Array<{ ev: string; p: any }> = [];
  const auditoria: any[] = [];
  const entregas: Array<{ url: string; init: any; corpo: any }> = [];
  let robôRecebe = true;
  const T = randomUUID();
  const T2 = randomUUID();
  let lojaA = '';
  let cardapioA = '';
  const ANA = randomUUID(); // gerente
  const BIA = randomUUID(); // presidente
  const tokA = `tok-treino-${randomUUID()}`;
  const tokB = `tok-treino-${randomUUID()}`;
  const INST = `inst-treino-${T.slice(0, 8)}`;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const user = (colaboradorId: string, categoria = 'gerente', tenantId = T) => ({ tenantId, colaboradorId, categoria, nome: categoria === 'gerente' ? 'Ana' : 'Bia' }) as any;
  const ana = () => user(ANA);
  const emitir = (ev: string, p: any) => avisos.push({ ev, p });
  const naoUsar = () => new Proxy({}, { get: () => () => Promise.reject(new Error('não deveria ser chamado: no teste nada sai')) });
  const roboConfig = (col: string, valor: unknown) =>
    q(`insert into robo_config (tenant_id, ${col}) values ($1, $2) on conflict (tenant_id) do update set ${col} = $2`, [T, valor]);
  const horarios = (h: unknown[]) => q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [cardapioA, JSON.stringify(h)]);
  const casosDe = async (t = T) => Number((await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [t]))[0].n);
  const mensagens = async (id: string) => (await treino.verTeste(ana(), id)).mensagens;
  const novoTeste = async (canal: 'whatsapp' | 'direct' = 'whatsapp', foraDoHorario = false, quem = ana()) =>
    (await treino.criarTeste(quem, { canal, foraDoHorario })).id as string;
  const existe = async (tabela: string) => (await q(`select to_regclass(current_schema() || '.' || $1) is not null as tem`, [tabela]))[0].tem === true;

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

  beforeAll(async () => {
    for (const k of ['EDGE_MODE', 'BOT_RESOLVER_SECRET', 'N8N_ROBO_WEBHOOK_URL']) antes[k] = process.env[k];
    delete process.env.EDGE_MODE; // como NUVEM
    process.env.BOT_RESOLVER_SECRET = SENHA;
    process.env.N8N_ROBO_WEBHOOK_URL = N8N;
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '379_horario_da_equipe.sql',
      '380_perfis_do_atendente.sql',
      '381_assuntos_do_atendente.sql',
      '382_treinar_atendente.sql',
    ])
      await aplicar(m);
    const registrar = { registrar: async (e: any) => void auditoria.push(e) } as any;
    const fila = new FilaEAvisosService(db, { emit: emitir } as any, registrar);
    atend = new AtendimentoService(db, { emit: emitir } as any, {} as any, undefined, fila);
    const u = {} as any;
    cardapioSvc = new CardapioService(db, u, u, atend, u, u, { emit: emitir } as any, u);
    consultas = new RoboConsultasController(cardapioSvc);
    treino = new TreinoDoAtendenteService(db, registrar);
    treino.buscar = (async (url: any, init: any) => {
      entregas.push({ url: String(url), init, corpo: JSON.parse(String(init?.body ?? 'null')) });
      return { ok: robôRecebe, status: robôRecebe ? 200 : 502 } as any;
    }) as any;
    resposta = new RoboRespostaService(db, naoUsar() as any, naoUsar() as any);
    pedidoCtl = new RoboPedidoController(new RoboPedidoService(db, cardapioSvc, naoUsar() as any, naoUsar() as any));
    clienteSvc = new ClienteService(db, atend, registrar);
    await q(`insert into empresa (id, nome) values ($1, 'teste treino do atendente'), ($2, 'outra empresa do treino')`, [T, T2]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    // Dois cardápios na empresa: o do número do WhatsApp é o do teste no WhatsApp.
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, null, $2, true, 'Sem número')`, [T, `tok-sem-${randomUUID()}`]);
    [{ id: cardapioA }] = await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, nome_publico, evolution_instancia, robo_ativo,
                                    robo_saudacao, robo_ausencia, robo_prompt, robo_mensagens)
       values ($1, $2, $3, true, true, 'Burger da Praça', $4, false, 'Oi, tudo bem?', 'Estamos fechados', 'Base: aceitamos VR', $5::jsonb) returning id`,
      [T, lojaA, tokA, INST, JSON.stringify([{ gatilho: 'pix', resposta: 'Aceitamos Pix' }])],
    );
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, null, $2, true, 'Outra')`, [T2, tokB]);
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of ['atendente_teste_msg', 'atendente_teste', 'atendente_conhecimento', 'atendimento_chamado', 'robo_pausa', 'robo_config', 'pedido_externo', 'cliente', 'cardapio_config', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    entregas.length = 0;
    robôRecebe = true;
    process.env.N8N_ROBO_WEBHOOK_URL = N8N;
    process.env.BOT_RESOLVER_SECRET = SENHA;
    delete process.env.EDGE_MODE;
    for (const tab of ['atendente_teste', 'atendente_conhecimento', 'atendimento_chamado', 'robo_pausa', 'robo_config'])
      await q(`delete from ${tab} where tenant_id = any($1::uuid[])`, [[T, T2]]);
    await q(`update cardapio_config set ativo = true, horarios = '[]'::jsonb where tenant_id = $1`, [T]);
  });

  // ───────────────────────── a conversa de teste ─────────────────────────

  it('abrir o teste: a forma combinada, o cardápio do número do WhatsApp, quem abriu; a retenção apaga os da empresa parados há mais de 7 dias', async () => {
    const velhoT = (await q(`insert into atendente_teste (tenant_id, canal, atualizado_em) values ($1, 'whatsapp', now() - interval '8 days') returning id`, [T]))[0].id;
    await q(`insert into atendente_teste_msg (teste_id, tenant_id, autor, texto) values ($1, $2, 'cliente', 'velho')`, [velhoT, T]);
    const recenteT = (await q(`insert into atendente_teste (tenant_id, canal, atualizado_em) values ($1, 'whatsapp', now() - interval '6 days') returning id`, [T]))[0].id;
    const velhoT2 = (await q(`insert into atendente_teste (tenant_id, canal, atualizado_em) values ($1, 'whatsapp', now() - interval '8 days') returning id`, [T2]))[0].id;
    const r = await treino.criarTeste(ana(), { canal: 'whatsapp' });
    expect(r).toEqual({ id: expect.any(String), canal: 'whatsapp', foraDoHorario: false, esperandoResposta: false, mensagens: [] });
    const [linha] = await q(`select * from atendente_teste where id = $1`, [r.id]);
    expect(linha).toMatchObject({ tenant_id: T, usuario_id: ANA, canal: 'whatsapp', fora_do_horario: false, cardapio_id: cardapioA });
    const ids = (await q(`select id from atendente_teste where tenant_id = any($1::uuid[])`, [[T, T2]])).map((l) => l.id).sort();
    expect(ids).toEqual([r.id, recenteT, velhoT2].sort()); // o velho DESTA empresa saiu; o da outra empresa ficou
    expect(await q(`select 1 from atendente_teste_msg where teste_id = $1`, [velhoT])).toEqual([]); // as mensagens, em cascata
    // fora do horário, no Direct
    expect(await treino.criarTeste(ana(), { canal: 'direct', foraDoHorario: true })).toMatchObject({ canal: 'direct', foraDoHorario: true });
    // outra empresa não vê
    await expect(treino.verTeste(user(BIA, 'presidente', T2), r.id)).rejects.toThrow(NotFoundException);
    await expect(treino.verTeste(ana(), randomUUID())).rejects.toThrow(NotFoundException);
  });

  it('recusas ao abrir, antes de gravar: canal (400), o robô indisponível nesta instalação (409) e a empresa sem cardápio ativo (409)', async () => {
    const tentar = async (fazer: () => Promise<unknown>) => {
      try {
        await fazer();
      } catch (e: any) {
        return { tipo: e?.constructor?.name, corpo: e?.getResponse?.() };
      }
      return null;
    };
    expect(await tentar(() => treino.criarTeste(ana(), { canal: 'messenger' }))).toMatchObject({ tipo: 'BadRequestException' });
    for (const [k, v] of [['N8N_ROBO_WEBHOOK_URL', ''], ['BOT_RESOLVER_SECRET', ''], ['EDGE_MODE', 'true']] as const) {
      const guardado = process.env[k];
      process.env[k] = v;
      expect(await tentar(() => treino.criarTeste(ana(), { canal: 'whatsapp' }))).toEqual({
        tipo: 'ConflictException',
        corpo: { statusCode: 409, code: 'ROBO_INDISPONIVEL', message: 'O atendente virtual não está disponível nesta instalação.' },
      });
      if (guardado === undefined) delete process.env[k];
      else process.env[k] = guardado;
    }
    await q(`update cardapio_config set ativo = false where tenant_id = $1`, [T]);
    expect(await tentar(() => treino.criarTeste(ana(), { canal: 'whatsapp' }))).toMatchObject({ tipo: 'ConflictException', corpo: { code: 'SEM_CARDAPIO' } });
    expect(await q(`select 1 from atendente_teste where tenant_id = $1`, [T])).toEqual([]);
    // o robô desligado na loja (robo_ativo = false) não impede: é para testar antes de ligar
    await q(`update cardapio_config set ativo = true where tenant_id = $1`, [T]);
    expect((await q(`select robo_ativo from cardapio_config where id = $1`, [cardapioA]))[0].robo_ativo).toBe(false);
    expect(await treino.criarTeste(ana(), { canal: 'whatsapp' })).toMatchObject({ canal: 'whatsapp' });
  });

  it('a mensagem do "cliente" vai ao robô de verdade: o CORPO que sai (o formato das outras vias), a senha e a assinatura; a tela espera', async () => {
    const id = await novoTeste();
    const r = await treino.mandarMensagem(ana(), id, { texto: '  tem x-bacon?  ' });
    expect(r).toEqual({ mensagem: expect.objectContaining({ autor: 'cliente', texto: 'tem x-bacon?', opcoes: null, simulado: null }), entregue: true });
    expect(entregas).toHaveLength(1);
    const [e] = entregas;
    expect(e.url).toBe(N8N);
    expect(e.init.method).toBe('POST');
    expect(e.init.headers[CABECALHO_SEGREDO_ROBO]).toBe(SENHA);
    expect(e.init.headers[CABECALHO_ASSINATURA_REGEM]).toMatch(/^sha256=/);
    expect(e.corpo).toEqual({
      provedor: 'evolution',
      tenantId: T,
      cardapioToken: tokA,
      phoneNumberId: null,
      instancia: chaveDoTeste(id),
      jid: null,
      loja: { nome: 'Burger da Praça', aberto: true },
      de: chaveDoTeste(id),
      nome: 'Teste da loja',
      tipo: 'text',
      texto: 'tem x-bacon?',
      mensagemId: r.mensagem.id,
      timestamp: expect.any(Number),
      midiaId: null,
      opcaoId: null,
      roboSaudacao: 'Oi, tudo bem?',
      roboAusencia: 'Estamos fechados',
      roboPrompt: 'Base: aceitamos VR',
      roboMensagens: [{ gatilho: 'pix', resposta: 'Aceitamos Pix' }],
      conversa: null,
    });
    expect(Math.abs(e.corpo.timestamp - Date.now() / 1000)).toBeLessThan(60);
    expect(await treino.verTeste(ana(), id)).toMatchObject({ id, canal: 'whatsapp', foraDoHorario: false, esperandoResposta: true, mensagens: [{ autor: 'cliente' }] });
    // no Direct, o provedor do Direct
    const d = await novoTeste('direct');
    await treino.mandarMensagem(ana(), d, { texto: 'oi' });
    expect(entregas[1].corpo).toMatchObject({ provedor: 'instagram', instancia: chaveDoTeste(d), de: chaveDoTeste(d), conversa: null });
  });

  it('o robô que não recebe: entregue false com o motivo, a linha "sistema" — e a tela para de esperar', async () => {
    const id = await novoTeste();
    robôRecebe = false;
    expect(await treino.mandarMensagem(ana(), id, { texto: 'alô?' })).toMatchObject({ entregue: false, motivo: 'robo_nao_recebeu' });
    const v = await treino.verTeste(ana(), id);
    expect(v.esperandoResposta).toBe(false);
    expect(v.mensagens.map((m: any) => [m.autor, m.texto])).toEqual([
      ['cliente', 'alô?'],
      ['sistema', TEXTO_NAO_RECEBEU],
    ]);
  });

  it('recusas ao mandar, ANTES de gravar: texto (400), teste de outra empresa (404), cardápio desativado (409), o limite de 20 por minuto por pessoa (429)', async () => {
    const id = await novoTeste();
    await expect(treino.mandarMensagem(ana(), id, { texto: '   ' })).rejects.toThrow(BadRequestException);
    await expect(treino.mandarMensagem(user(BIA, 'presidente', T2), id, { texto: 'oi' })).rejects.toThrow(NotFoundException);
    await q(`update cardapio_config set ativo = false where id = $1`, [cardapioA]);
    await expect(treino.mandarMensagem(ana(), id, { texto: 'oi' })).rejects.toThrow(ConflictException);
    await q(`update cardapio_config set ativo = true where id = $1`, [cardapioA]);
    expect(await mensagens(id)).toEqual([]);
    expect(entregas).toEqual([]);
    // 20 mensagens da Ana no último minuto (em dois testes dela): a 21ª é recusada; a Bia (presidente) segue
    const outro = await novoTeste();
    await q(
      `insert into atendente_teste_msg (teste_id, tenant_id, autor, texto) select case when g % 2 = 0 then $1 else $2 end::uuid, $3, 'cliente', 'x' from generate_series(1, 20) g`,
      [id, outro, T],
    );
    const erro: any = await treino.mandarMensagem(ana(), id, { texto: 'mais uma' }).catch((e) => e);
    expect(erro).toBeInstanceOf(HttpException);
    expect(erro.getStatus()).toBe(429);
    expect(erro.getResponse()).toMatchObject({ code: 'MUITAS_MENSAGENS', message: expect.stringContaining('Espere um minuto') });
    const daBia = await novoTeste('whatsapp', false, user(BIA, 'presidente'));
    expect((await treino.mandarMensagem(user(BIA, 'presidente'), daBia, { texto: 'oi' })).entregue).toBe(true);
    // mensagens de mais de 1 minuto não contam
    await q(`update atendente_teste_msg set criado_em = now() - interval '2 minutes' where teste_id = any($1::uuid[])`, [[id, outro]]);
    expect((await treino.mandarMensagem(ana(), id, { texto: 'agora vai' })).entregue).toBe(true);
  });

  // ───────────────────────── a resposta do robô ─────────────────────────

  it('a resposta do robô por publico/bot/responder fica na conversa de teste (texto, opções, só o link da loja) — NADA sai', async () => {
    const id = await novoTeste();
    await treino.mandarMensagem(ana(), id, { texto: 'tem cardápio?' });
    const r = await resposta.responder(SENHA, {
      instancia: chaveDoTeste(id),
      para: chaveDoTeste(id),
      texto: 'Temos sim! Veja em https://site-de-fora.example/cardapio',
      opcoes: [
        { id: 'ver', titulo: 'Ver cardápio' },
        { id: 'ajuda', titulo: 'Quero ajuda', descricao: 'alguém da equipe' },
      ],
    });
    expect(r).toEqual({ ok: true, enviado: true });
    const v = await treino.verTeste(ana(), id);
    expect(v.esperandoResposta).toBe(false);
    const robo = v.mensagens[1];
    expect(robo).toMatchObject({ autor: 'robo', opcoes: [{ titulo: 'Ver cardápio' }, { titulo: 'Quero ajuda', descricao: 'alguém da equipe' }], simulado: null });
    expect(robo.texto).toContain(linkDoCardapioDaLoja(tokA)); // o link de fora virou o do cardápio da loja (o mesmo filtro das vias de verdade)
    expect(robo.texto).not.toContain('site-de-fora');
    // áudio: o teste não toca — fica o aviso
    await resposta.responder(SENHA, { instancia: chaveDoTeste(id), para: chaveDoTeste(id), audio: { base64: 'T2dnUw==', mime: 'audio/ogg' } });
    expect((await mensagens(id)).at(-1)).toMatchObject({ autor: 'robo', texto: AUDIO_NO_TESTE });
    // só o `para` com a chave também vale (a instância some num fluxo antigo)
    await resposta.responder(SENHA, { para: chaveDoTeste(id), texto: 'Algo mais?' });
    expect((await mensagens(id)).at(-1)).toMatchObject({ autor: 'robo', texto: 'Algo mais?' });
    // no Direct: o link do cardápio sai com a origem do Direct, como na via de verdade
    const d = await novoTeste('direct');
    await resposta.responder(SENHA, { instancia: chaveDoTeste(d), para: chaveDoTeste(d), texto: `Pede por aqui: ${linkDoCardapioDaLoja(tokA)}` });
    expect((await mensagens(d)).at(-1)?.texto).toContain('utm_source=instagram');
  });

  it('a resposta do robô com a chave de teste: senha (401), chaves de conversas diferentes ou tortas (400), conversa que não existe (404), nada para mandar (400)', async () => {
    const id = await novoTeste();
    const outro = await novoTeste();
    await expect(resposta.responder('senha-errada', { instancia: chaveDoTeste(id), texto: 'x' })).rejects.toThrow(UnauthorizedException);
    await expect(resposta.responder(SENHA, { instancia: chaveDoTeste(id), para: chaveDoTeste(outro), texto: 'x' })).rejects.toThrow(BadRequestException);
    await expect(resposta.responder(SENHA, { instancia: 'teste:abc', texto: 'x' })).rejects.toThrow(BadRequestException);
    await expect(resposta.responder(SENHA, { instancia: chaveDoTeste(randomUUID()), texto: 'x' })).rejects.toThrow(NotFoundException);
    await expect(resposta.responder(SENHA, { instancia: chaveDoTeste(id), texto: '  ' })).rejects.toThrow(BadRequestException);
    // a instância de uma loja de verdade com o `para` de teste: vai para o teste (nunca vira um número de WhatsApp)
    await resposta.responder(SENHA, { instancia: INST, para: chaveDoTeste(id), texto: 'para o teste' });
    expect((await mensagens(id)).at(-1)).toMatchObject({ autor: 'robo', texto: 'para o teste' });
  });

  // ───────────────────────── as consultas e as instruções ─────────────────────────

  it('as consultas do robô com `teste:` leem a loja de verdade (loja, cardápio, taxa) — com o robô desligado; chave torta ou desconhecida = 404', async () => {
    const id = await novoTeste();
    const loja: any = await consultas.loja(chaveDoTeste(id), undefined, undefined, SENHA);
    expect(loja.linkCardapio).toBe(linkDoCardapioDaLoja(tokA));
    await expect(consultas.cardapioBusca('', chaveDoTeste(id), undefined, undefined, SENHA)).resolves.toBeDefined();
    await expect(consultas.taxa('Centro', chaveDoTeste(id), undefined, undefined, SENHA)).resolves.toBeDefined();
    await expect(consultas.loja(chaveDoTeste(randomUUID()), undefined, undefined, SENHA)).rejects.toThrow(NotFoundException);
    await expect(consultas.loja('teste:abc', undefined, undefined, SENHA)).rejects.toThrow(NotFoundException);
    await expect(consultas.loja(chaveDoTeste(id), undefined, undefined, 'senha-errada')).rejects.toThrow(UnauthorizedException);
  });

  it('as instruções com `teste:`: as do CANAL do teste, com o perfil dele — o de fora do horário com "simular fora do horário" (a mesma função)', async () => {
    await roboConfig('atendente_perfis', JSON.stringify({ whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo' }, direct: { perfil: 'gentil' } }));
    const instr = async (instancia: string) => (await consultas.instrucoes('2', instancia, undefined, undefined, SENHA)) as any;
    const doNumero = await instr(INST); // o WhatsApp de verdade (a equipe "Sempre": atendendo)
    const w = await instr(chaveDoTeste(await novoTeste('whatsapp')));
    expect(w).toEqual(doNumero); // idênticas às do canal de verdade
    expect(w.texto).toContain('CORDIAL');
    const fora = await instr(chaveDoTeste(await novoTeste('whatsapp', true)));
    expect(fora.texto).toContain('OBJETIVO');
    expect(fora.texto).not.toContain('CORDIAL');
    // com a equipe fora DE VERDADE, o número dá o mesmo texto do teste com "simular fora do horário"
    await roboConfig('equipe_atende', 'loja');
    await horarios(JANELA_LONGE);
    expect((await instr(INST)).texto).toBe(fora.texto);
    const d = await instr(chaveDoTeste(await novoTeste('direct')));
    expect(d).toMatchObject({ canal: 'instagram' });
    expect(d.texto).toContain('no Direct do Instagram');
    expect(d.texto).toContain('GENTIL');
  });

  it('o que a loja ensinou entra nas instruções de TODOS os canais (com a regra dos números); sem itens, as de hoje', async () => {
    const instr = async (instancia: string) => ((await consultas.instrucoes('1', instancia, undefined, undefined, SENHA)) as any).texto as string;
    const t = await novoTeste('direct');
    const semNada = { w: await instr(INST), d: await instr(chaveDoTeste(t)) };
    expect(semNada.w).not.toContain(TITULO_DO_CONHECIMENTO);
    await treino.criarConhecimento(ana(), { assunto: 'pagamento', pergunta: 'aceita VR?', resposta: 'Aceitamos VR na entrega.', origem: 'teste' });
    for (const texto of [await instr(INST), await instr(chaveDoTeste(t))]) {
      expect(texto).toContain(TITULO_DO_CONHECIMENTO);
      expect(texto).toContain(REGRA_DOS_NUMEROS);
      expect(texto).toContain('- Cliente: aceita VR?');
    }
    // tirando a seção, o texto de antes
    const com = await instr(INST);
    const partes = com.split('\n\n');
    expect(partes.filter((p) => !p.startsWith(TITULO_DO_CONHECIMENTO)).join('\n\n')).toBe(semNada.w);
  });

  // ───────────────────────── o "chamar atendente" simulado ─────────────────────────

  const semAvisos = () => avisos.filter((a) => a.ev.startsWith('atendimento.'));

  it('chamar atendente com `teste:`: a MESMA resposta do caminho real (posição na fila), nenhum caso, nenhuma pausa, nenhum aviso — e a linha "sistema"', async () => {
    // um caso já na fila da loja (o cliente do teste seria o 2º)
    await q(`insert into atendimento_chamado (tenant_id, unidade_id, tipo, prioridade, canal, status, criado_em) values ($1, $2, 'humano', 'normal', 'whatsapp', 'aberto', now() - interval '5 minutes')`, [T, lojaA]);
    // o caminho de verdade, para comparar (depois sai)
    const real: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: '21977770001', mensagem: 'Motivo: x' }, SENHA);
    await q(`delete from atendimento_chamado where id = $1`, [real.id]);
    await q(`delete from robo_pausa where tenant_id = $1`, [T]);
    avisos.length = 0;
    const id = await novoTeste();
    const casos = await casosDe();
    const sim: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(id), mensagem: 'Motivo: x' }, SENHA);
    expect(Object.keys(sim).sort()).toEqual(Object.keys(real).sort());
    expect({ ...sim, id: 'x' }).toEqual({ ...real, id: 'x' });
    expect(sim).toMatchObject({ ok: true, prioridade: 'normal', posicao: 2, comAlguem: false });
    expect(await casosDe()).toBe(casos); // nenhum caso
    expect(await q(`select 1 from robo_pausa where tenant_id = $1`, [T])).toEqual([]); // nenhuma pausa
    expect(semAvisos()).toEqual([]); // ninguém avisado
    expect(await q(`select 1 from atendimento_chamado where id = $1`, [sim.id])).toEqual([]);
    const [linha] = (await mensagens(id)).filter((m: any) => m.autor === 'sistema');
    expect(linha).toMatchObject({ simulado: { tipo: 'equipe', detalhe: 'humano' } });
    expect(linha.texto).toBe('Na conversa de verdade, o atendente chamaria a equipe — o cliente seria o 2º da fila. Ninguém foi avisado: é um teste.');
    // chamou de novo, agora urgente: soma ao MESMO caso simulado (jaAberto, como o caminho real) e sobe a prioridade
    const de_novo: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'erro', telefone: chaveDoTeste(id), urgente: true }, SENHA);
    expect(de_novo).toMatchObject({ ok: true, id: sim.id, jaAberto: true, prioridade: 'urgente', posicao: 1, comAlguem: false });
    expect((await mensagens(id)).at(-1)?.texto).toContain('somaria ao caso que já abriu com urgência');
    expect(await casosDe()).toBe(casos);
    // "dizer a posição" desligado: a posição some, como no caminho real
    await roboConfig('dizer_posicao', false);
    const sem: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(await novoTeste()) }, SENHA);
    expect(sem.posicao).toBeNull();
  });

  it('fora do horário da equipe (F1): o recado da abertura simulado — a mesma resposta do caminho real; e o "simular fora do horário"', async () => {
    await roboConfig('equipe_atende', 'loja');
    await horarios(JANELA_LONGE);
    const real: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: '21977770002' }, SENHA);
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    const id = await novoTeste();
    const sim: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(id) }, SENHA);
    expect({ ...sim, id: 'x' }).toEqual({ ...real, id: 'x' });
    expect(sim).toMatchObject({ foraDoHorario: true, equipeVolta: textoDaVolta(VOLTA), posicao: null, comAlguem: false });
    expect(sim.paraOCliente).toContain(textoDaVolta(VOLTA));
    expect(await casosDe()).toBe(0);
    const linha = (await mensagens(id)).at(-1);
    expect(linha).toMatchObject({ autor: 'sistema', simulado: { tipo: 'recado', detalhe: 'abertura' } });
    expect(linha?.texto).toContain(`(${textoDaVolta(VOLTA)})`);
    // "simular fora do horário" com a equipe DENTRO do horário de verdade: o recado que a loja teria fora
    await horarios(SEMPRE_ABERTA);
    const dentro: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(await novoTeste()) }, SENHA);
    expect(dentro).toMatchObject({ posicao: 1 }); // sem simular: a equipe chamada
    const simulado: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(await novoTeste('whatsapp', true)) }, SENHA);
    expect(simulado).toMatchObject({ foraDoHorario: true, posicao: null, comAlguem: false, paraOCliente: expect.any(String) });
    // com a equipe em "Sempre", a linha avisa que isto só acontece com "No horário da loja"
    await roboConfig('equipe_atende', 'sempre');
    await horarios(JANELA_LONGE);
    const t3 = await novoTeste('whatsapp', true);
    expect(await cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(t3) }, SENHA)).toMatchObject({ equipeVolta: textoDaVolta(VOLTA) });
    expect((await mensagens(t3)).at(-1)?.texto).toContain('Hoje a equipe atende "Sempre"');
    expect(await casosDe()).toBe(0);
  });

  it('assuntos que não são pedido (F3): o recado para o responsável simulado (a resposta do caminho real) e o "não é por aqui"', async () => {
    await roboConfig('atendente_assuntos', JSON.stringify({ vaga: { modo: 'recado' }, fornecedor: { modo: 'nao' } }));
    const real: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'vaga', telefone: '21977770003', mensagem: 'Assunto: vaga' }, SENHA);
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    avisos.length = 0; // o aviso do caminho real (a comparação); daqui para baixo, só o teste
    const id = await novoTeste();
    const sim: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'vaga', telefone: chaveDoTeste(id), mensagem: 'Assunto: vaga' }, SENHA);
    expect({ ...sim, id: 'x' }).toEqual({ ...real, id: 'x' });
    expect(sim).toMatchObject({ paraOResponsavel: true, assunto: 'vaga', paraOCliente: TEXTO_PADRAO_DO_RECADO.vaga, posicao: null, comAlguem: false });
    expect((await mensagens(id)).at(-1)).toMatchObject({ simulado: { tipo: 'responsavel', detalhe: 'vaga' } });
    // de novo, o mesmo assunto: soma ao recado (jaAberto), como o caminho real
    expect(await cardapioSvc.abrirAtendimento(tokA, { tipo: 'vaga', telefone: chaveDoTeste(id) }, SENHA)).toMatchObject({ id: sim.id, jaAberto: true });
    // fornecedor em "não é por aqui": o robô não devia chamar — na conversa de verdade vira o caso comum (a mesma resposta)
    const f: any = await cardapioSvc.abrirAtendimento(tokA, { tipo: 'fornecedor', telefone: chaveDoTeste(id) }, SENHA);
    expect(f).toMatchObject({ ok: true, prioridade: 'normal', posicao: 1, comAlguem: false });
    expect(f.paraOResponsavel).toBeUndefined();
    const linha = (await mensagens(id)).at(-1);
    expect(linha).toMatchObject({ simulado: { tipo: 'nao', detalhe: 'fornecedor' } });
    expect(linha?.texto).toContain('"Responde que não é por aqui" para Fornecedor');
    // no Direct, o mesmo recado
    const d = await novoTeste('direct');
    expect(await cardapioSvc.abrirAtendimento(tokA, { tipo: 'vaga', telefone: chaveDoTeste(d) }, SENHA)).toMatchObject({ paraOResponsavel: true, assunto: 'vaga' });
    expect(await casosDe()).toBe(0);
    expect(semAvisos()).toEqual([]);
  });

  it('o "chamar atendente" com `teste:`: o token do cardápio tem de ser da empresa do teste; chave torta ou desconhecida = 404; nunca cai no telefone', async () => {
    const id = await novoTeste();
    await expect(cardapioSvc.abrirAtendimento(tokB, { tipo: 'humano', telefone: chaveDoTeste(id) }, SENHA)).rejects.toThrow(NotFoundException);
    await expect(cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: 'teste:21977770004' }, SENHA)).rejects.toThrow(NotFoundException);
    await expect(cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(randomUUID()) }, SENHA)).rejects.toThrow(NotFoundException);
    await expect(cardapioSvc.abrirAtendimento(tokA, { tipo: 'humano', telefone: chaveDoTeste(id) }, 'senha-errada')).rejects.toThrow(UnauthorizedException);
    expect(await casosDe()).toBe(0);
    expect(await casosDe(T2)).toBe(0);
  });

  // ───────────────────────── o pedido, o link, os envios e as rotas de telefone ─────────────────────────

  it('o pedido com `teste:` não é montado: a recusa que o robô entende, nenhum carrinho, comanda ou cliente — e UMA linha por fala', async () => {
    const id = await novoTeste();
    const chave = chaveDoTeste(id);
    await treino.mandarMensagem(ana(), id, { texto: 'quero pedir aqui' });
    const respostas = [
      await pedidoCtl.ver({ instancia: chave }, SENHA, undefined),
      await pedidoCtl.itens({ acao: 'adicionar', produto: 'X-Bacon' }, { instancia: chave }, SENHA, undefined),
      await pedidoCtl.entrega({ instancia: chave, retirada: true }, {}, SENHA, undefined),
      await pedidoCtl.pagamento({ forma: 'pix' }, { instancia: chave }, SENHA, undefined),
      await pedidoCtl.nome({ nome: 'Ana' }, { instancia: chave }, SENHA, undefined),
      await pedidoCtl.registrar({}, { instancia: chave }, SENHA, undefined),
      await pedidoCtl.cancelar({}, { instancia: chave }, SENHA, undefined),
    ];
    for (const r of respostas) expect(r).toEqual(RESPOSTA_DO_PEDIDO_NO_TESTE);
    expect((await mensagens(id)).filter((m: any) => m.autor === 'sistema')).toEqual([expect.objectContaining({ texto: LINHA_DO_PEDIDO.texto, simulado: LINHA_DO_PEDIDO.simulado })]);
    // a próxima fala do "cliente" ganha outra linha
    await treino.mandarMensagem(ana(), id, { texto: 'pode registrar' });
    await pedidoCtl.registrar({}, { instancia: chave }, SENHA, undefined);
    expect((await mensagens(id)).filter((m: any) => m.simulado?.tipo === 'pedido')).toHaveLength(2);
    for (const tab of ['robo_carrinho', 'pedido_externo', 'comanda', 'cliente'])
      if (await existe(tab)) expect([tab, (await q(`select count(*)::int as n from ${tab} where tenant_id = $1`, [T]))[0].n]).toEqual([tab, 0]);
    await expect(pedidoCtl.ver({ instancia: chave }, 'senha-errada', undefined)).rejects.toThrow(UnauthorizedException);
    await expect(pedidoCtl.ver({ instancia: chaveDoTeste(randomUUID()) }, SENHA, undefined)).rejects.toThrow(NotFoundException);
  });

  it('o link do cliente com `teste:`: 400 (como no Direct), nenhum cliente criado e a linha "link"; o token de outra empresa não grava a linha', async () => {
    const id = await novoTeste();
    await treino.mandarMensagem(ana(), id, { texto: 'me manda o link' });
    await expect(clienteSvc.criarLink(tokA, { telefone: chaveDoTeste(id), nome: 'Teste' }, SENHA)).rejects.toThrow(BadRequestException);
    await expect(clienteSvc.criarLink(tokA, { telefone: chaveDoTeste(id) }, SENHA)).rejects.toThrow(BadRequestException);
    expect((await mensagens(id)).filter((m: any) => m.autor === 'sistema')).toEqual([expect.objectContaining({ texto: LINHA_DO_LINK.texto, simulado: LINHA_DO_LINK.simulado })]);
    await expect(clienteSvc.criarLink(tokB, { telefone: chaveDoTeste(id) }, SENHA)).rejects.toThrow(BadRequestException);
    expect((await mensagens(id)).filter((m: any) => m.autor === 'sistema')).toHaveLength(1);
    expect((await q(`select count(*)::int as n from cliente where tenant_id = any($1::uuid[])`, [[T, T2]]))[0].n).toBe(0);
  });

  it('os envios e as rotas de telefone com `teste:` recusam: cloud/enviar e template (400), os pedidos do cliente (nenhum, mesmo com dígitos que casariam), a situação, o resolver e a mídia (404)', async () => {
    const id = await novoTeste();
    const chave = chaveDoTeste(id);
    const cloud = new WhatsappCloudService(db);
    await expect(cloud.enviarPeloBot(SENHA, '123456789', chave, 'oi')).rejects.toThrow(BadRequestException);
    await expect(cloud.enviarTemplatePeloBot(SENHA, '123456789', chave, 'pedido_confirmado', 'pt_BR', [])).rejects.toThrow(BadRequestException);
    // um pedido de verdade cujo telefone termina com os últimos 8 dígitos do id: a busca pelos dígitos o acharia
    const digitos = id.replace(/\D/g, '');
    await q(`insert into pedido_externo (tenant_id, status, cliente_telefone, total) values ($1, 'novo', $2, 10)`, [T, `5521${digitos.slice(-8)}`]);
    const wa = new WhatsappService(db);
    expect(await wa.pedidosPorTelefoneBot(chave, SENHA, chave, '')).toEqual([]);
    expect(await wa.pedidosPorTelefoneBot(INST, SENHA, chave, '')).toEqual([]);
    await expect(wa.statusPedidoBot(chave, SENHA, chave, '1', '')).rejects.toThrow(NotFoundException);
    await expect(wa.resolver(chave, SENHA, chave)).rejects.toThrow(NotFoundException);
    const comEvolution = new RoboRespostaService(db, wa, naoUsar() as any);
    await expect(comEvolution.midia(SENHA, { instancia: chave, mensagemId: 'abcdef123' })).rejects.toThrow(NotFoundException);
    expect(await wa.lojaDoRobo(chave)).toBeNull();
  });

  it('a entrada da Evolution nunca aceita uma instância `teste:` vinda de fora (nada chega ao robô)', async () => {
    const espiao = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('não deveria sair'));
    try {
      const entrada = new EvolutionEntradaService(db, new WhatsappService(db));
      const id = await novoTeste();
      await entrada.processar(
        { event: 'messages.upsert', data: { key: { id: 'MSG1', remoteJid: '5521977770009@s.whatsapp.net', fromMe: false }, message: { conversation: 'oi' } } },
        chaveDoTeste(id),
      );
      expect(espiao).not.toHaveBeenCalled();
      expect(await mensagens(id)).toEqual([]);
    } finally {
      espiao.mockRestore();
    }
  });

  // ───────────────────────── o que ele aprendeu ─────────────────────────

  it('criar, listar, editar e apagar o que o atendente aprendeu — a empresa da sessão, a auditoria e o 404 de outra empresa', async () => {
    const a = await treino.criarConhecimento(ana(), { assunto: 'entrega', pergunta: 'entrega no centro?', resposta: 'Entregamos!', origem: 'teste' });
    expect(a).toEqual({
      id: expect.any(String),
      assunto: 'entrega',
      pergunta: 'entrega no centro?',
      resposta: 'Entregamos!',
      origem: 'teste',
      criadoPorNome: 'Ana',
      criadoEm: expect.any(String),
      atualizadoEm: expect.any(String),
    });
    const b = await treino.criarConhecimento(ana(), { assunto: 'pagamento', pergunta: 'aceita VR?', resposta: 'Sim.', origem: 'caso' });
    const c = await treino.criarConhecimento(ana(), { assunto: 'entrega', pergunta: 'demora?', resposta: 'Uns 40 min.', origem: 'manual' });
    await treino.criarConhecimento(user(BIA, 'presidente', T2), { assunto: 'outro', pergunta: 'da outra empresa', resposta: 'x', origem: 'manual' });
    const lista = await treino.listarConhecimento(ana());
    expect(lista.limite).toBe(LIMITE_DO_CONHECIMENTO);
    expect(lista.itens.map((i: any) => i.id)).toEqual([a.id, c.id, b.id]); // por assunto (a ordem da tela), depois a ordem em que ensinou
    expect(auditoria.filter((e) => e.acao === 'atendente_conhecimento_criado')).toHaveLength(4);
    expect(auditoria[0]).toMatchObject({ tenantId: T, atorId: ANA, atorPerfil: 'gerente', tipo: 'config', entidadeTipo: 'atendente_conhecimento', entidadeId: a.id });
    expect(auditoria[0].detalhe).toEqual({ assunto: 'entrega', pergunta: 'entrega no centro?', resposta: 'Entregamos!', origem: 'teste' });
    auditoria.length = 0;
    // editar: só o que mudou
    const editado = await treino.editarConhecimento(ana(), a.id, { resposta: 'Entregamos, sim!', assunto: 'entrega' });
    expect(editado).toMatchObject({ id: a.id, resposta: 'Entregamos, sim!', assunto: 'entrega', origem: 'teste' });
    expect(new Date(editado.atualizadoEm).getTime()).toBeGreaterThan(new Date(a.atualizadoEm).getTime());
    expect(auditoria).toEqual([
      expect.objectContaining({ acao: 'atendente_conhecimento_alterado', entidadeId: a.id, detalhe: { mudancas: [{ campo: 'resposta', de: 'Entregamos!', para: 'Entregamos, sim!' }] } }),
    ]);
    await expect(treino.editarConhecimento(user(BIA, 'presidente', T2), a.id, { resposta: 'invasão' })).rejects.toThrow(NotFoundException);
    await expect(treino.editarConhecimento(ana(), a.id, {})).rejects.toThrow(BadRequestException);
    // apagar
    auditoria.length = 0;
    await expect(treino.apagarConhecimento(user(BIA, 'presidente', T2), b.id)).rejects.toThrow(NotFoundException);
    expect(await treino.apagarConhecimento(ana(), b.id)).toEqual({ ok: true });
    await expect(treino.apagarConhecimento(ana(), b.id)).rejects.toThrow(NotFoundException);
    expect(auditoria).toEqual([expect.objectContaining({ acao: 'atendente_conhecimento_apagado', entidadeId: b.id, detalhe: expect.objectContaining({ pergunta: 'aceita VR?' }) })]);
    expect((await treino.listarConhecimento(ana())).itens.map((i: any) => i.id)).toEqual([a.id, c.id]);
    // a conferência vem antes de gravar
    await expect(treino.criarConhecimento(ana(), { assunto: 'troca', pergunta: 'x', resposta: 'y', origem: 'teste' })).rejects.toThrow(BadRequestException);
    expect((await treino.listarConhecimento(ana())).itens).toHaveLength(2);
  });

  it('o limite de 100 por empresa (409 LIMITE_CONHECIMENTO) — e dois "Salvar" ao mesmo tempo não passam dele (a corrida com transação aberta)', async () => {
    await q(
      `insert into atendente_conhecimento (tenant_id, assunto, pergunta, resposta, origem) select $1, 'outro', 'p' || g, 'r', 'manual' from generate_series(1, 98) g`,
      [T],
    );
    // o 99º, gravado por uma transação AINDA ABERTA, que segura a trava da empresa
    const outra = await pool.connect();
    try {
      await outra.query('begin');
      await outra.query(`select pg_advisory_xact_lock(hashtext($1::text), 382)`, [T]);
      await outra.query(`insert into atendente_conhecimento (tenant_id, assunto, pergunta, resposta, origem) values ($1, 'outro', 'p99', 'r', 'manual')`, [T]);
      // enquanto isso, o 100º chega pelo serviço: espera a trava
      const cem = treino.criarConhecimento(ana(), { assunto: 'outro', pergunta: 'p100', resposta: 'r', origem: 'manual' }).catch((e) => e);
      await new Promise((r) => setTimeout(r, 300));
      // o 101º também
      const centoEUm = treino.criarConhecimento(ana(), { assunto: 'outro', pergunta: 'p101', resposta: 'r', origem: 'manual' }).catch((e) => e);
      await new Promise((r) => setTimeout(r, 300));
      await outra.query('commit');
      const resultados = await Promise.all([cem, centoEUm]);
      const recusas = resultados.filter((x: any) => x instanceof ConflictException);
      expect(recusas).toHaveLength(1);
      expect(resultados.filter((x: any) => x?.pergunta)).toHaveLength(1); // o outro gravou
      expect((recusas[0] as any).getResponse()).toMatchObject({ code: 'LIMITE_CONHECIMENTO' });
    } finally {
      outra.release();
    }
    expect((await q(`select count(*)::int as n from atendente_conhecimento where tenant_id = $1`, [T]))[0].n).toBe(LIMITE_DO_CONHECIMENTO);
  });
});
