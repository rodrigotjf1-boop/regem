import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ROLES_KEY } from '../../auth/roles.decorator';
import * as schema from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { chaveDoChat, chaveDoTeste } from '../../common/conversa-do-robo';
import { PonteChatGuard, type PonteCtx } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';
import { AjustesDaPonteService } from './ajustes-da-ponte.service';
import { CHAMEI_A_EQUIPE, FALAS_DO_ATENDENTE_POR_HORA } from './robo-do-chat';
import { TEXTO_MAX, temContatoProibido } from './texto-do-chat';
import { RoboRespostaService } from '../whatsapp/robo-resposta.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { WhatsappCloudService, RECUSA_NO_CHAT } from '../whatsapp/whatsapp-cloud.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { RoboConsultasController } from '../cardapio/robo-consultas.controller';
import { RoboPedidoController } from '../cardapio/robo-pedido.controller';
import { RESPOSTA_DO_PEDIDO_NO_CHAT, RoboPedidoService } from '../cardapio/robo-pedido.service';
import { VERSAO_DO_CHAT } from '../cardapio/robo-instrucoes';
import { ClienteService } from '../cliente/cliente.service';
import { AtendimentoService } from '../atendimento/atendimento.service';
import { FilaEAvisosService } from '../atendimento/fila-e-avisos.service';
import { ChatDoCasoService } from '../atendimento/chat-do-caso.service';
import { TreinoDoAtendenteService } from '../atendimento/treino.service';
import { AtendimentoController } from '../atendimento/atendimento.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ATENDENTE VIRTUAL NO CHAT DO iFOOD E DA 99 (F5, mig 383), contra o Postgres real e um n8n DE MENTIRA local (nada sai
// para fora), pelo caminho de verdade: a ponte entrega a fala (`receber`), o atendente recebe o CORPO certo (a chave `chat:`,
// o pedido, as falas juntas, nenhum telefone), responde por `publico/bot/responder` (a fila com `robo_ia`, a trava da
// plataforma, o "quieto", o limite por hora), o "chamar atendente" com `chat:`, as ferramentas que recusam, a entrega que
// falha (o robô por regras), ninguém envia pelo canal (caso — V88), a rotina dos 2 minutos (V84/V42), o teste do atendente
// com o canal `chat`, os ajustes (`roboModo`) e o `roboIa` da conversa do caso. Aplica a 342, a 353, a 366–368 e a 379–383
// (só da nuvem: o banco do CI é o de uma loja — ERR-329), com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('atendente-no-chat-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SENHA = 'senha-do-robo-do-chat-ia';

descrever('o atendente virtual no chat do iFood e da 99 (Postgres + n8n de mentira)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const eventos: Array<{ nome: string; dados: any }> = [];
  const emitir = { emit: (nome: string, dados: any) => (eventos.push({ nome, dados }), true) } as any;
  const auditados: any[] = [];
  const registrar = { registrar: async (e: any) => void auditados.push(e) } as any;
  const equipamentos = new EquipamentoService(db, { registrar: async () => {} } as any);
  const ponte = new PonteChatService(db, emitir, { horaPrevistaDoPedido: async () => '20h32' } as any);
  const guarda = new PonteChatGuard(equipamentos);
  const resposta = new RoboRespostaService(db, {} as any, {} as any, undefined, emitir);
  const ajustes = new AjustesDaPonteService(db, registrar);
  const T = randomUUID();
  const T2 = randomUUID();
  const ANA = randomUUID();
  const TOK = `tok-chat-ia-${T.slice(0, 8)}`;
  const TOK2 = `tok-chat-ia-${T2.slice(0, 8)}`;
  let loja: string;
  let delivery: { id: string; segredo: string };
  let cardapio: CardapioService;
  let consultas: RoboConsultasController;
  let pedidoCtl: RoboPedidoController;
  let clienteSvc: ClienteService;
  let chatCaso: ChatDoCasoService;
  let treino: TreinoDoAtendenteService;
  let servidor: Server;
  let base = '';
  const soquetes = new Set<Socket>();
  const aoRobo: Array<{ corpo: any; segredo: string | undefined; assinatura: string | undefined }> = [];
  let n8nStatus = 200;
  const antes: Record<string, string | undefined> = {};

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
  const entrar = async (p: { id: string; segredo: string }): Promise<PonteCtx> => {
    const req: any = { headers: { 'x-terminal-id': p.id, 'x-terminal-secret': p.segredo } };
    await guarda.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.ponteChat;
  };
  // Os avisos automáticos DESLIGADOS nesta empresa (ERR-383): a rotina dos avisos de outro spec varre todas as empresas.
  const ajustar = (o: { ligada?: boolean; robo?: boolean; modo?: 'regras' | 'atendente' } = {}) =>
    q(
      `insert into robo_config (tenant_id, chat_ponte_ligada, chat_robo_responde, chat_robo_modo, chat_aviso_saiu, chat_aviso_chegando, chat_aviso_obrigado)
       values ($1, $2, $3, $4, false, false, false)
       on conflict (tenant_id) do update set chat_ponte_ligada = $2, chat_robo_responde = $3, chat_robo_modo = $4,
         chat_aviso_saiu = false, chat_aviso_chegando = false, chat_aviso_obrigado = false`,
      [T, o.ligada ?? true, o.robo ?? true, o.modo ?? 'atendente'],
    );
  const sinal = async (plataformas: any = { ifood: { logado: true } }) =>
    ponte.estado(await entrar(delivery), { plataformas, versao: '0.7.3', maquina: 'CX-DELIVERY' });
  async function pedido(ext: string, o: { status?: string; tipo?: string; raw?: any; minAtras?: number } = {}) {
    return (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total, raw, despachado_em)
         values ($1, $2, 'ifood', $3, '4821', (floor(random()*90000)+10000)::int, $4, $5, 'MARIA SILVA', 50, $6::jsonb,
                 case when $5 = 'despachado' then now() - make_interval(mins => $7::int) end) returning id`,
        [T, loja, ext, o.tipo ?? 'entrega', o.status ?? 'despachado', JSON.stringify(o.raw ?? {}), o.minAtras ?? 5],
      )
    )[0].id as string;
  }
  let n = 0;
  /** Falas do cliente num lote só (a ponte manda várias de uma vez); espera a entrega ao atendente terminar. */
  const falas = async (ext: string, textos: string[]) => {
    const r = await ponte.receber(await entrar(delivery), {
      mensagens: textos.map((texto) => ({ canal: 'ifood', id: `ia-${++n}-${randomUUID().slice(0, 6)}`, pedido: { externo: ext }, cliente: 'Maria S.', autor: 'cliente', texto })),
    });
    await ponte.esperarEntregas();
    return r;
  };
  const fala = (ext: string, texto: string) => falas(ext, [texto]);
  /** A PRIMEIRA fala do cliente da conversa (a chave `chat:` que o atendente recebe — a mesma em toda a conversa). */
  const chaveDe = async (ext: string) =>
    chaveDoChat(
      (await q(`select id from chat_plataforma_msg where tenant_id = $1 and pedido_externo = $2 and autor = 'cliente' order by criado_em, id limit 1`, [T, ext]))[0].id,
    );
  /** A ÚLTIMA fala do cliente da conversa (a que o atendente responde — `mensagemId`). */
  const ultimaDe = async (ext: string) =>
    (await q(`select id from chat_plataforma_msg where tenant_id = $1 and pedido_externo = $2 and autor = 'cliente' order by criado_em desc, id desc limit 1`, [T, ext]))[0].id as string;
  const responder = (chave: string, texto: string, extra: any = {}) => resposta.responder(SENHA, { instancia: chave, para: chave, texto, ...extra } as any);
  const doRobo = (ext: string) =>
    q(
      `select texto, estado, robo_ia as "roboIa" from chat_plataforma_msg where tenant_id = $1 and pedido_externo = $2 and autor = 'robo' order by criado_em, id`,
      [T, ext],
    );
  const casosDo = (ext: string) => q(`select * from atendimento_chamado where tenant_id = $1 and tipo = 'chat' and detalhe #>> '{chat,chave}' = $2 order by criado_em`, [T, `ext:${ext}`]);
  const marcas = (ext: string) =>
    q(`select id from chat_plataforma_msg where tenant_id = $1 and pedido_externo = $2 and robo_entregue_em is not null`, [T, ext]);

  beforeAll(async () => {
    for (const k of ['EDGE_MODE', 'BOT_RESOLVER_SECRET', 'N8N_ROBO_WEBHOOK_URL', 'ROBO_JUNTAR_MS']) antes[k] = process.env[k];
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '366_ponte_do_chat.sql',
      '367_chat_ordem_e_indices.sql',
      '368_ponte_pausada.sql',
      '379_horario_da_equipe.sql',
      '380_perfis_do_atendente.sql',
      '381_assuntos_do_atendente.sql',
      '382_treinar_atendente.sql',
      '383_atendente_no_chat.sql',
    ])
      await aplicar(m);
    // a 383 de novo: idempotente, e a conferência dela linha a linha
    await aplicar('383_atendente_no_chat.sql');
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (c) => (corpo += c));
      req.on('end', () => {
        if (req.url === '/n8n') {
          aoRobo.push({ corpo: JSON.parse(corpo || '{}'), segredo: req.headers['x-regem-robo-segredo'] as string, assinatura: req.headers['x-regem-assinatura'] as string });
          res.statusCode = n8nStatus;
          return res.end('{}');
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    servidor.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
    process.env.BOT_RESOLVER_SECRET = SENHA;
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    await q(`insert into empresa (id, nome) values ($1, 'teste atendente no chat'), ($2, 'outra empresa do chat')`, [T, T2]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    await q(`insert into colaborador (id, tenant_id, nome, unidade_id, status) values ($1, $2, 'Ana', $3, 'ativo')`, [ANA, T, loja]);
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, nome_publico, robo_saudacao) values ($1, $2, $3, true, true, 'Burger da Praça', 'Olá!')`,
      [T, loja, TOK],
    );
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, null, $2, true, 'Outra')`, [T2, TOK2]);
    const criado = await equipamentos.criar(T, ANA, 'gerente', { tipo: 'ponte_chat', nome: 'Ponte do delivery', unidadeId: loja } as any);
    const { codigo } = await equipamentos.gerarCodigo(T, criado.id, ANA, 'gerente');
    const p = await equipamentos.parearPorCodigo(codigo, 'PC delivery', 'ponte_chat');
    delivery = { id: p.terminalId as string, segredo: p.segredo as string };
    const fila = new FilaEAvisosService(db, emitir, registrar);
    const atend = new AtendimentoService(db, emitir, {} as any, undefined, fila);
    const u = {} as any;
    cardapio = new CardapioService(db, u, u, atend, u, u, emitir, u);
    consultas = new RoboConsultasController(cardapio);
    pedidoCtl = new RoboPedidoController(new RoboPedidoService(db, cardapio, {} as any, {} as any));
    clienteSvc = new ClienteService(db, atend, registrar);
    chatCaso = new ChatDoCasoService(db, emitir, ponte, registrar);
    treino = new TreinoDoAtendenteService(db, registrar);
    treino.buscar = (url: any, init: any) => fetch(url, init);
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    for (const s of soquetes) s.destroy();
    if (servidor) await new Promise<void>((ok) => servidor.close(() => ok()));
    for (const t of [T, T2]) {
      for (const tab of ['atendente_teste_msg', 'atendente_teste', 'atendimento_chamado', 'chat_plataforma_msg', 'chat_ponte', 'robo_config', 'pedido_externo', 'cardapio_config', 'equipamento', 'colaborador', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    process.env.BOT_RESOLVER_SECRET = SENHA;
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    n8nStatus = 200;
    aoRobo.length = 0;
    eventos.length = 0;
    auditados.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    // As marcas dos testes de antes não ficam: a rotina dos 2 min contaria as que envelheceram no caminho.
    await q(`update chat_plataforma_msg set robo_entregue_em = null where tenant_id = $1 and robo_entregue_em is not null`, [T]);
    await q(`update robo_config set equipe_atende = 'sempre', equipe_fora_texto = null where tenant_id = $1`, [T]).catch(() => {});
    await ajustar();
    await sinal();
  });

  // ───────────────────────── a migration ─────────────────────────

  it('a 383: a conferência no mesmo Run vem com todas as linhas ok (e aplicada duas vezes)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const r: any = await c.query(comTravaDaEmpresa(readFileSync(MIG('383_atendente_no_chat.sql'), 'utf8')));
      await c.query('rollback');
      const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
      expect(conferencia.length).toBe(7);
      for (const l of conferencia) expect({ objeto: l.objeto, ok: l.ok }).toEqual({ objeto: l.objeto, ok: true });
    } finally {
      c.release();
    }
    await expect(q(`update robo_config set chat_robo_modo = 'ia' where tenant_id = $1`, [T])).rejects.toThrow(/ck_robo_config_chat_robo_modo/);
  });

  // ───────────────────────── modo 'regras': nada muda ─────────────────────────

  it("modo 'regras' (o padrão): o robô por regras de hoje — nada vai ao n8n, nada leva a marca do atendente", async () => {
    await ajustar({ modo: 'regras' });
    await pedido('re-a');
    expect(await fala('re-a', 'Cadê meu pedido?')).toEqual({ recebidas: 1, repetidas: 0, recusadas: 0, casosNovos: 0, casosSomados: 0, roboRespondeu: 1 });
    expect(await fala('re-a', 'Veio errado, um absurdo')).toMatchObject({ casosNovos: 1, roboRespondeu: 0 });
    const ditos = await doRobo('re-a');
    expect(ditos.map((d) => d.texto)).toEqual([expect.stringMatching(/^Oi, Maria! Seu pedido saiu às \d{2}h\d{2} e chega por volta das 20h32\.$/), CHAMEI_A_EQUIPE]);
    expect(ditos.every((d) => d.roboIa === false)).toBe(true);
    expect(aoRobo).toHaveLength(0);
    expect(await marcas('re-a')).toHaveLength(0);
    // sem a linha na robo_config o modo também é 'regras' (nasce assim)
    expect((await ajustes.ajustes(T2, null)).roboModo).toBe('regras');
  });

  // ───────────────────────── modo 'atendente': a ida ao n8n ─────────────────────────

  it("modo 'atendente': as falas do lote vão JUNTAS ao n8n, com a chave da última, o pedido e nenhum telefone; sem caso", async () => {
    await pedido('at-1', { status: 'despachado', minAtras: 5 });
    const r = await falas('at-1', ['Oi', 'Cadê meu pedido?']);
    expect(r).toMatchObject({ recebidas: 2, casosNovos: 0, roboRespondeu: 0, paraOAtendente: 1 });
    expect(aoRobo).toHaveLength(1);
    const chave = await chaveDe('at-1');
    const { corpo, segredo, assinatura } = aoRobo[0];
    expect(segredo).toBe(SENHA);
    expect(assinatura).toMatch(/^sha256=/);
    expect(corpo).toMatchObject({
      provedor: 'instagram',
      tenantId: T,
      cardapioToken: TOK,
      phoneNumberId: null,
      instancia: chave,
      de: chave,
      jid: null,
      nome: 'Maria',
      tipo: 'text',
      texto: 'Oi\nCadê meu pedido?',
      mensagemId: await ultimaDe('at-1'),
      conversa: null,
      plataforma: 'ifood',
      loja: { nome: 'Burger da Praça', aberto: true },
      roboSaudacao: 'Olá!',
      pedido: {
        numero: '4821',
        status: 'despachado',
        situacao: 'saiu para entrega com o entregador da loja',
        quemEntrega: 'loja',
        saiuAs: expect.stringMatching(/^\d{2}h\d{2}$/),
        previsao: '20h32',
        respostaPronta: expect.stringMatching(/^Oi, Maria! Seu pedido saiu às \d{2}h\d{2} e chega por volta das 20h32\.$/),
      },
    });
    const { timestamp: _t, ...semAHora } = corpo;
    expect(JSON.stringify(semAHora)).not.toMatch(/\d{10,}/); // nenhum telefone
    expect(await casosDo('at-1')).toHaveLength(0);
    expect(await doRobo('at-1')).toHaveLength(0); // o robô por regras não falou
    expect((await marcas('at-1')).map((m) => m.id)).toEqual([await ultimaDe('at-1')]); // a última fala espera o atendente
    // a fala seguinte da MESMA conversa vai com a MESMA chave (a memória do agente no n8n é pela conversa); a fala é outra
    await responder(chave, 'Oi, Maria! Já saiu, chega por volta das 20h32.');
    await fala('at-1', 'Obrigada, e vem com sachê?');
    expect(aoRobo).toHaveLength(2);
    expect(aoRobo[1].corpo).toMatchObject({ instancia: chave, de: chave, texto: 'Obrigada, e vem com sachê?', mensagemId: await ultimaDe('at-1') });
    expect(aoRobo[1].corpo.mensagemId).not.toBe(aoRobo[0].corpo.mensagemId);
  });

  it('a resposta pelo `responder` entra na fila de saída como do robô COM a marca do atendente, e a ponte pega', async () => {
    await pedido('at-2');
    await fala('at-2', 'Vocês têm sobremesa?');
    const chave = await chaveDe('at-2');
    expect(await responder(chave, 'Oi, Maria! Temos brownie e pudim no cardápio do app.')).toEqual({ ok: true, enviado: true, enviados: ['texto'] });
    expect(await doRobo('at-2')).toEqual([{ texto: 'Oi, Maria! Temos brownie e pudim no cardápio do app.', estado: 'pendente', roboIa: true }]);
    expect(await marcas('at-2')).toHaveLength(0); // respondida: não espera mais
    const { itens } = await ponte.pegar(await entrar(delivery), { canal: 'ifood' });
    expect(itens.map((i: any) => i.texto)).toContain('Oi, Maria! Temos brownie e pudim no cardápio do app.');
    // texto longo: até 3 mensagens de até 300 letras, na ordem; opções numeradas na mesma linha
    const longo = Array.from({ length: 7 }, (_, i) => `Esta é a explicação número ${i + 1} do atendente sobre o pedido, com detalhes.`).join(' ');
    expect(await responder(chave, longo, { opcoes: [{ titulo: 'Sim' }, { titulo: 'Não' }] })).toMatchObject({ ok: true, enviado: true });
    const partes = (await doRobo('at-2')).slice(1);
    expect(partes.length).toBeGreaterThanOrEqual(2);
    expect(partes.length).toBeLessThanOrEqual(3);
    for (const p of partes) {
      expect(p.texto.length).toBeLessThanOrEqual(TEXTO_MAX);
      expect(p.roboIa).toBe(true);
      expect(p.texto).not.toMatch(/\n/);
    }
    expect(partes.map((p) => p.texto).join(' ')).toContain('1) Sim; 2) Não. Responda com o número da opção.');
    expect(partes[0].texto.startsWith('Esta é a explicação número 1')).toBe(true); // a ordem
  });

  it('com link ou telefone NADA do atendente sai: no "cadê meu pedido" vai a resposta por regras; o motivo no log, sem o texto', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn');
    try {
      await pedido('tr-1');
      await fala('tr-1', 'Cadê meu pedido?');
      const chave = await chaveDe('tr-1');
      const r = await responder(chave, 'Seu pedido saiu! Acompanhe em https://rastreio.exemplo/abc ou me chame no (21) 99999-8888.');
      expect(r).toEqual({ ok: true, enviado: false, motivo: 'barrada_pela_plataforma', noLugar: 'resposta_por_regras' });
      const ditos = await doRobo('tr-1');
      expect(ditos).toEqual([{ texto: expect.stringMatching(/^Oi, Maria! Seu pedido saiu às \d{2}h\d{2} e já está a caminho\.$/), estado: 'pendente', roboIa: false }]);
      expect(ditos.some((d) => temContatoProibido(d.texto))).toBe(false);
      const logs = warn.mock.calls.map((c) => String(c[0]));
      expect(logs.some((l) => l.includes('barrada pela trava da plataforma'))).toBe(true);
      expect(logs.some((l) => l.includes('Cadê meu pedido') || l.includes('rastreio') || l.includes('99999'))).toBe(false);
      expect(await marcas('tr-1')).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('barrada numa conversa que não é o "cadê": o caso abre ("o atendente escreveu algo que a plataforma proíbe") e vai o "já chamei"', async () => {
    await pedido('tr-2');
    await fala('tr-2', 'O lanche veio sem o bacon');
    const chave = await chaveDe('tr-2');
    const r = await responder(chave, 'Poxa! Fala com a gente no WhatsApp que resolvemos.');
    expect(r).toEqual({ ok: true, enviado: false, motivo: 'barrada_pela_plataforma', noLugar: 'ja_chamei_a_equipe' });
    const [caso] = await casosDo('tr-2');
    expect(caso).toMatchObject({ status: 'aberto', tipo: 'chat', mensagem: 'O lanche veio sem o bacon' });
    expect(caso.detalhe.robo).toMatchObject({ motivo: expect.stringContaining('O atendente virtual escreveu algo que a plataforma proíbe'), quer: 'O lanche veio sem o bacon' });
    expect(await doRobo('tr-2')).toEqual([{ texto: CHAMEI_A_EQUIPE, estado: 'pendente', roboIa: false }]);
    expect(eventos.some((e) => e.nome === 'atendimento.novo' && e.dados.chamado.id === caso.id)).toBe(true);
  });

  it('caso aberto com a equipe = quieto: a entrada não vai ao n8n (soma no caso) e a resposta que chega não sai', async () => {
    await pedido('qt-1');
    await fala('qt-1', 'Quero falar com alguém');
    const chave = await chaveDe('qt-1');
    expect(aoRobo).toHaveLength(1);
    // a equipe assume (o caso abre por outro caminho — "Assumir a conversa", a 3ª pergunta…)
    await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, mensagem, detalhe) values ($1, $2, 'chat', 'ifood', 'x', $3::jsonb)`,
      [T, loja, JSON.stringify({ chat: { chave: 'ext:qt-1' } })],
    );
    expect(await responder(chave, 'Claro, Maria! Como posso ajudar?')).toEqual({ ok: true, enviado: false, motivo: 'conversa_com_a_equipe' });
    expect(await doRobo('qt-1')).toHaveLength(0);
    expect(await marcas('qt-1')).toHaveLength(0); // a equipe tem a conversa: a rotina não precisa abrir nada
    expect(await fala('qt-1', 'Alô?')).toMatchObject({ casosSomados: 1, casosNovos: 0 });
    expect(aoRobo).toHaveLength(1); // a fala nova não foi ao atendente
  });

  it(`limite: ${FALAS_DO_ATENDENTE_POR_HORA} falas do atendente no pedido na última hora — a próxima vai para a equipe (na entrada e na resposta)`, async () => {
    await pedido('lm-1');
    await fala('lm-1', 'Oi');
    const chave = await chaveDe('lm-1');
    for (let i = 0; i < FALAS_DO_ATENDENTE_POR_HORA - 1; i++) expect(await responder(chave, `Resposta ${i + 1}.`)).toMatchObject({ enviado: true });
    // a 8ª ainda sai; a 9ª, não
    expect(await responder(chave, 'Resposta 8.')).toMatchObject({ enviado: true });
    expect(await responder(chave, 'Resposta 9.')).toEqual({ ok: true, enviado: false, motivo: 'limite_por_hora', noLugar: 'ja_chamei_a_equipe' });
    const [caso] = await casosDo('lm-1');
    expect(caso.detalhe.robo.motivo).toBe(`O atendente virtual já respondeu ${FALAS_DO_ATENDENTE_POR_HORA} vezes a este pedido na última hora`);
    const ditos = await doRobo('lm-1');
    expect(ditos.filter((d) => d.roboIa)).toHaveLength(FALAS_DO_ATENDENTE_POR_HORA);
    expect(ditos[ditos.length - 1]).toMatchObject({ texto: CHAMEI_A_EQUIPE, roboIa: false });
    // na entrada: outro pedido já com 8 falas do atendente na hora não vai ao n8n
    await pedido('lm-2');
    await fala('lm-2', 'Oi');
    const k2 = await chaveDe('lm-2');
    for (let i = 0; i < FALAS_DO_ATENDENTE_POR_HORA; i++) await responder(k2, `R${i}.`);
    aoRobo.length = 0;
    expect(await fala('lm-2', 'E aí?')).toMatchObject({ casosNovos: 1 });
    expect(aoRobo).toHaveLength(0);
  });

  it('a entrega ao n8n que falha cai no robô por regras (a resposta do pedido, ou a equipe) — e a marca sai', async () => {
    n8nStatus = 502;
    await pedido('fl-1');
    expect(await fala('fl-1', 'Cadê meu pedido?')).toMatchObject({ paraOAtendente: 1 });
    expect(aoRobo).toHaveLength(1); // tentou
    expect(await doRobo('fl-1')).toEqual([{ texto: expect.stringMatching(/^Oi, Maria! Seu pedido saiu às .* 20h32\.$/), estado: 'pendente', roboIa: false }]);
    expect(await marcas('fl-1')).toHaveLength(0);
    await pedido('fl-2');
    await fala('fl-2', 'Faltou o refrigerante');
    expect((await casosDo('fl-2'))[0].detalhe.robo).toMatchObject({ motivo: 'Mensagem no chat do iFood' });
    expect((await doRobo('fl-2')).map((d) => d.texto)).toEqual([CHAMEI_A_EQUIPE]);
    expect(eventos.some((e) => e.nome === 'atendimento.novo')).toBe(true);
  });

  it('sem o robô nesta instalação (sem o endereço do n8n) ou sem cardápio ativo: o robô por regras direto, nada vai ao n8n', async () => {
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    await pedido('sd-1');
    expect(await fala('sd-1', 'Cadê meu pedido?')).toMatchObject({ roboRespondeu: 1 });
    expect(aoRobo).toHaveLength(0);
    process.env.N8N_ROBO_WEBHOOK_URL = `${base}/n8n`;
    await q(`update cardapio_config set ativo = false where tenant_id = $1`, [T]);
    try {
      await pedido('sd-2');
      expect(await fala('sd-2', 'Cadê meu pedido?')).toMatchObject({ roboRespondeu: 1 });
      expect(aoRobo).toHaveLength(0);
    } finally {
      await q(`update cardapio_config set ativo = true where tenant_id = $1`, [T]);
    }
  });

  it('ninguém envia pelo canal (V88): a fala não vai ao n8n e vira caso; a resposta que chega sem ninguém para enviar também vira caso', async () => {
    await sinal({ ifood: { logado: false } });
    await pedido('ne-1');
    expect(await fala('ne-1', 'Cadê meu pedido?')).toMatchObject({ casosNovos: 1, roboRespondeu: 0 });
    expect(aoRobo).toHaveLength(0);
    expect((await casosDo('ne-1'))[0].detalhe.robo.jaFez).toBe('Não respondeu: nenhum PC da ponte envia pelo chat do iFood agora');
    expect(await doRobo('ne-1')).toHaveLength(0);
    // a fala foi entregue com a ponte logada; a ponte cai antes da resposta
    await sinal();
    await pedido('ne-2');
    await fala('ne-2', 'Vocês têm sobremesa?');
    const chave = await chaveDe('ne-2');
    await sinal({ ifood: { logado: false } });
    expect(await responder(chave, 'Temos brownie!')).toEqual({ ok: true, enviado: false, motivo: 'ninguem_envia', noLugar: 'caso' });
    expect(await doRobo('ne-2')).toHaveLength(0);
    expect((await casosDo('ne-2'))[0].detalhe.robo.motivo).toBe('O atendente virtual respondeu, mas nenhum PC da ponte envia pelo chat agora');
  });

  // ───────────────────────── o "chamar atendente" com `chat:` ─────────────────────────

  it('`chamar_atendente` com chat: abre o caso de chat DESSA conversa, com o resumo e urgente; libera UM "já chamei" do robô', async () => {
    await pedido('ch-1');
    await fala('ch-1', 'O lanche veio frio');
    await fala('ch-1', 'Veio frio, que absurdo');
    const chave = await chaveDe('ch-1'); // a da conversa (a 1ª fala); o caso mostra a fala de AGORA
    const r: any = await cardapio.abrirAtendimento(
      TOK,
      { telefone: chave, tipo: 'erro', urgente: true, mensagem: 'Motivo: lanche frio (pedido 4821)\nQuer: uma solução\nJá fiz: pedi desculpas' },
      SENHA,
    );
    expect(r).toEqual({ ok: true, id: expect.any(String), prioridade: 'urgente', posicao: expect.any(Number), comAlguem: false });
    const [caso] = await casosDo('ch-1');
    expect(caso.id).toBe(r.id);
    expect(caso).toMatchObject({ tipo: 'chat', canal: 'ifood', prioridade: 'urgente', unidade_id: loja, mensagem: 'Veio frio, que absurdo' });
    expect(caso.detalhe.chat).toMatchObject({ chave: 'ext:ch-1', avisoLiberado: true, abertoPeloRobo: true });
    expect(caso.detalhe.robo).toMatchObject({ motivo: 'lanche frio (pedido 4821)', quer: 'uma solução', jaFez: 'pedi desculpas', humor: 'chateado' });
    expect(await doRobo('ch-1')).toHaveLength(0); // não manda nada sozinho: quem fala é o robô
    // o "já chamei" do robô sai UMA vez (o caso aberto cala o robô — V83)
    expect(await responder(chave, 'Poxa, Maria, sinto muito! Já chamei a equipe da loja, que responde aqui.')).toMatchObject({ enviado: true });
    expect(await responder(chave, 'Mais alguma coisa?')).toEqual({ ok: true, enviado: false, motivo: 'conversa_com_a_equipe' });
    expect((await doRobo('ch-1')).map((d) => d.roboIa)).toEqual([true]);
    // chamar de novo soma no mesmo caso (não abre outro)
    const r2: any = await cardapio.abrirAtendimento(TOK, { telefone: chave, mensagem: 'Motivo: de novo' }, SENHA);
    expect(r2.id).toBe(r.id);
    expect(await casosDo('ch-1')).toHaveLength(1);
    // V83: a conversa JÁ estava com a equipe quando ele chamou de novo — nada é liberado, o robô não fala por cima
    expect((await casosDo('ch-1'))[0].detalhe.chat.avisoLiberado).toBe(false);
    expect(await responder(chave, 'Já chamei de novo!')).toEqual({ ok: true, enviado: false, motivo: 'conversa_com_a_equipe' });
    expect((await doRobo('ch-1')).map((d) => d.roboIa)).toEqual([true]);
  });

  it('`chamar_atendente` com chat: de outra empresa (o token do cardápio) ou fala que não existe = 401; sem a senha = 401', async () => {
    await pedido('ch-2');
    await fala('ch-2', 'Oi');
    const chave = await chaveDe('ch-2');
    await expect(cardapio.abrirAtendimento(TOK2, { telefone: chave }, SENHA)).rejects.toThrow(UnauthorizedException);
    await expect(cardapio.abrirAtendimento(TOK, { telefone: chaveDoChat(randomUUID()) }, SENHA)).rejects.toThrow(UnauthorizedException);
    await expect(cardapio.abrirAtendimento(TOK, { telefone: chave }, 'errada')).rejects.toThrow(UnauthorizedException);
    expect(await casosDo('ch-2')).toHaveLength(0);
  });

  it('`chamar_atendente` com chat: fora do horário da equipe o caso nasce RECADO e o paraOCliente passa na trava da plataforma', async () => {
    const FUSO = 'America/Sao_Paulo';
    const daqui3 = new Date(Date.now() + 3 * 86_400_000);
    const dia = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(daqui3));
    await q(`update robo_config set equipe_atende = 'loja', equipe_fora_texto = 'Chama no WhatsApp! Voltamos {volta}.' where tenant_id = $1`, [T]);
    await q(`update cardapio_config set horarios = $2::jsonb where tenant_id = $1`, [T, JSON.stringify([{ dia, ativo: true, abre: '10:00', fecha: '11:00' }])]);
    try {
      await pedido('ch-3', { status: 'concluido' });
      await fala('ch-3', 'Não chegou nada');
      const chave = await chaveDe('ch-3');
      const r: any = await cardapio.abrirAtendimento(TOK, { telefone: chave, mensagem: 'Motivo: não chegou' }, SENHA);
      expect(r).toMatchObject({ ok: true, foraDoHorario: true, comAlguem: false, posicao: null, equipeVolta: expect.any(String) });
      expect(r.paraOCliente).toMatch(/^Nossa equipe volta /); // a frase da loja tinha "WhatsApp": vai a padrão
      expect(temContatoProibido(r.paraOCliente)).toBe(false);
      expect((await casosDo('ch-3'))[0].detalhe.recado).toBeTruthy();
      // o recado não cala o robô: a resposta dele sai
      expect(await responder(chave, r.paraOCliente)).toMatchObject({ enviado: true });
    } finally {
      await q(`update robo_config set equipe_atende = 'sempre', equipe_fora_texto = null where tenant_id = $1`, [T]);
      await q(`update cardapio_config set horarios = '[]'::jsonb where tenant_id = $1`, [T]);
    }
  });

  // ───────────────────────── as ferramentas com `chat:` ─────────────────────────

  it('as consultas leem a loja de verdade pela chave chat:; as instruções são as do chat', async () => {
    await pedido('fe-1');
    await fala('fe-1', 'Oi');
    const chave = await chaveDe('fe-1');
    expect(await cardapio.tokenDaLojaDoRobo(SENHA, chave)).toBe(TOK);
    await expect(cardapio.tokenDaLojaDoRobo(SENHA, chaveDoChat(randomUUID()))).rejects.toThrow(NotFoundException);
    await expect(cardapio.tokenDaLojaDoRobo('errada', chave)).rejects.toThrow(UnauthorizedException);
    const ins: any = await consultas.instrucoes('1', chave, undefined, undefined, SENHA);
    expect(ins).toMatchObject({ versao: VERSAO_DO_CHAT, canal: 'chat', plataforma: 'ifood' });
    expect(ins.texto).toContain('Você atende os clientes da Burger da Praça no chat do iFood');
    // o perfil do canal `chat` entra nas instruções dele
    await q(`update robo_config set atendente_perfis = $2::jsonb where tenant_id = $1`, [T, JSON.stringify({ chat: { perfil: 'objetivo' } })]);
    expect(((await consultas.instrucoes('1', chave, undefined, undefined, SENHA)) as any).texto).toContain('OBJETIVO');
    await q(`update robo_config set atendente_perfis = '{}'::jsonb where tenant_id = $1`, [T]);
  });

  it('pedidos / situação do pedido com chat: = o pedido DA conversa (nunca pelos dígitos); pedido, link, envio e mídia recusam', async () => {
    const pid = await pedido('fe-2');
    await fala('fe-2', 'Oi');
    const chave = await chaveDe('fe-2');
    const wa = new WhatsappService(db);
    const lista: any[] = await wa.pedidosPorTelefoneBot(chave, SENHA, chave);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ displayId: '4821', status: 'despachado', maisRecente: true, statusTexto: expect.stringContaining('Situação do pedido: saiu para entrega') });
    expect(await q(`select id from pedido_externo where id = $1`, [pid])).toHaveLength(1);
    expect(await wa.statusPedidoBot(chave, SENHA, chave, '9999')).toMatchObject({ encontrado: true, numero: '4821', status: 'despachado' });
    expect(await wa.pedidosPorTelefoneBot(chaveDoChat(randomUUID()), SENHA, chaveDoChat(randomUUID()))).toEqual([]);
    await expect(wa.resolver(chave, SENHA)).rejects.toThrow(NotFoundException);
    // as rotas do pedido: a recusa de regra que o robô entende (200, ok: false)
    expect(await pedidoCtl.ver({ instancia: chave }, SENHA)).toEqual(RESPOSTA_DO_PEDIDO_NO_CHAT);
    expect(await pedidoCtl.itens({ acao: 'adicionar', produto: 'X' }, { instancia: chave }, SENHA)).toEqual(RESPOSTA_DO_PEDIDO_NO_CHAT);
    expect(await pedidoCtl.registrar({}, { instancia: chave }, SENHA)).toEqual(RESPOSTA_DO_PEDIDO_NO_CHAT);
    await expect(pedidoCtl.ver({ instancia: chave }, 'errada')).rejects.toThrow(UnauthorizedException);
    await expect(pedidoCtl.ver({ instancia: chaveDoChat(randomUUID()) }, SENHA)).rejects.toThrow(NotFoundException);
    // o link do cliente, o envio pela API oficial e a mídia
    await expect(clienteSvc.criarLink(TOK, { telefone: chave }, SENHA)).rejects.toThrow(BadRequestException);
    expect(await q(`select 1 from cliente where tenant_id = $1`, [T])).toHaveLength(0);
    const cloud = new WhatsappCloudService(db);
    await expect(cloud.enviarPeloBot(SENHA, 'pid-1', chave, 'oi')).rejects.toThrow(RECUSA_NO_CHAT);
    await expect(cloud.enviarTemplatePeloBot(SENHA, 'pid-1', chave, 'modelo', 'pt_BR', [])).rejects.toThrow(RECUSA_NO_CHAT);
    const comWhatsapp = new RoboRespostaService(db, wa, cloud);
    await expect(comWhatsapp.midia(SENHA, { instancia: chave, mensagemId: 'abcdef123' })).rejects.toThrow(NotFoundException);
  });

  // ───────────────────────── a rotina "o atendente virtual não respondeu" ─────────────────────────

  it('a rotina: a fala entregue há mais de 2 min sem resposta vira caso + "já chamei" (uma vez só); a de agora espera', async () => {
    await pedido('ro-1');
    await fala('ro-1', 'Quero trocar a bebida');
    await pedido('ro-2');
    await fala('ro-2', 'Oi, tudo bem?'); // entregue agora: ainda espera
    await q(`update chat_plataforma_msg set robo_entregue_em = now() - interval '3 minutes' where tenant_id = $1 and pedido_externo = 'ro-1' and robo_entregue_em is not null`, [T]);
    expect(await ponte.semRespostaDoAtendente()).toBe(1);
    const [caso] = await casosDo('ro-1');
    expect(caso).toMatchObject({ tipo: 'chat', status: 'aberto', mensagem: 'Quero trocar a bebida' });
    expect(caso.detalhe.robo).toMatchObject({ motivo: 'O atendente virtual não respondeu', quer: 'Quero trocar a bebida' });
    expect((await doRobo('ro-1')).map((d) => d.texto)).toEqual([CHAMEI_A_EQUIPE]);
    expect(await marcas('ro-1')).toHaveLength(0);
    expect(await casosDo('ro-2')).toHaveLength(0);
    expect(await marcas('ro-2')).toHaveLength(1);
    // de novo: nada novo
    expect(await ponte.semRespostaDoAtendente()).toBe(0);
    expect(await casosDo('ro-1')).toHaveLength(1);
    // duas rodadas ao mesmo tempo (duas réplicas) sobre a mesma marca: UM caso e UM "já chamei" (a trava e o id da chave)
    await pedido('ro-1b');
    await fala('ro-1b', 'Quero cancelar');
    await q(`update chat_plataforma_msg set robo_entregue_em = now() - interval '3 minutes' where tenant_id = $1 and pedido_externo = 'ro-1b' and robo_entregue_em is not null`, [T]);
    const [a, b] = await Promise.all([ponte.semRespostaDoAtendente(), ponte.semRespostaDoAtendente()]);
    expect(a + b).toBe(1);
    expect(await casosDo('ro-1b')).toHaveLength(1);
    expect((await doRobo('ro-1b')).map((d) => d.texto)).toEqual([CHAMEI_A_EQUIPE]);
  });

  it('a rotina pega a fala que espera mesmo com mais de 100 marcas que NÃO esperam na frente (V84), e limpa todas', async () => {
    // 110 conversas com a marca velha mas já respondidas (o robô respondeu depois) — puláveis, MAIS VELHAS que a que espera
    const ids: string[] = [];
    for (let i = 0; i < 110; i++) ids.push(`pl-${i}`);
    await q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto, estado, robo_entregue_em, criado_em)
       select $1, $2, 'ifood', x, '1', 'Zé', 'entrada', 'cliente', 'oi', 'recebida', now() - interval '10 minutes', now() - interval '11 minutes'
         from unnest($3::text[]) x`,
      [T, loja, ids],
    );
    await q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_externo, pedido_numero, cliente_nome, direcao, autor, texto, estado, robo_ia, criado_em)
       select $1, $2, 'ifood', x, '1', 'Zé', 'saida', 'robo', 'olá', 'enviada', true, now() - interval '9 minutes'
         from unnest($3::text[]) x`,
      [T, loja, ids],
    );
    await pedido('ro-3');
    await fala('ro-3', 'Cadê o troco?');
    await q(`update chat_plataforma_msg set robo_entregue_em = now() - interval '3 minutes' where tenant_id = $1 and pedido_externo = 'ro-3' and robo_entregue_em is not null`, [T]);
    expect(await ponte.semRespostaDoAtendente()).toBe(1);
    expect(await casosDo('ro-3')).toHaveLength(1);
    expect(Number((await q(`select count(*)::int as n from chat_plataforma_msg where tenant_id = $1 and robo_entregue_em is not null and pedido_externo like 'pl-%'`, [T]))[0].n)).toBe(0);
    await q(`delete from chat_plataforma_msg where tenant_id = $1 and pedido_externo like 'pl-%'`, [T]);
  });

  it('a rotina com a ponte desligada: não abre caso e a marca sai; no servidor da loja, não roda', async () => {
    await pedido('ro-4');
    await fala('ro-4', 'Oi');
    await q(`update chat_plataforma_msg set robo_entregue_em = now() - interval '3 minutes' where tenant_id = $1 and pedido_externo = 'ro-4' and robo_entregue_em is not null`, [T]);
    process.env.EDGE_MODE = 'true';
    expect(await ponte.semRespostaDoAtendente()).toBe(0);
    expect(await marcas('ro-4')).toHaveLength(1);
    delete process.env.EDGE_MODE;
    await ajustar({ ligada: false });
    await ponte.semRespostaDoAtendente();
    expect(await casosDo('ro-4')).toHaveLength(0);
    expect(await marcas('ro-4')).toHaveLength(0);
  });

  // ───────────────────────── o teste do atendente com o canal `chat` ─────────────────────────

  it('o teste do atendente com canal chat: guardado como WhatsApp + plataforma; o corpo, as instruções, a trava e o chamar simulado', async () => {
    const ana = { tenantId: T, colaboradorId: ANA, categoria: 'gerente', nome: 'Ana' } as any;
    const criado = await treino.criarTeste(ana, { canal: 'chat' });
    expect(criado).toMatchObject({ canal: 'chat', foraDoHorario: false, mensagens: [] });
    expect((await q(`select canal, plataforma from atendente_teste where id = $1`, [criado.id]))[0]).toEqual({ canal: 'whatsapp', plataforma: 'ifood' });
    expect((await treino.verTeste(ana, criado.id)).canal).toBe('chat');
    aoRobo.length = 0;
    expect(await treino.mandarMensagem(ana, criado.id, { texto: 'Cadê meu pedido?' })).toMatchObject({ entregue: true });
    expect(aoRobo[0].corpo).toMatchObject({ provedor: 'instagram', instancia: chaveDoTeste(criado.id), de: chaveDoTeste(criado.id), plataforma: 'ifood', pedido: null, conversa: null });
    const ins: any = await consultas.instrucoes('1', chaveDoTeste(criado.id), undefined, undefined, SENHA);
    expect(ins).toMatchObject({ canal: 'chat', versao: VERSAO_DO_CHAT });
    expect(ins.texto).toContain('ESTA É UMA CONVERSA DE TESTE DA LOJA');
    // a trava: com link, a linha do robô fica (o gerente vê o que ele escreveu) e o sistema diz que o iFood barraria
    await resposta.responder(SENHA, { instancia: chaveDoTeste(criado.id), para: chaveDoTeste(criado.id), texto: 'Veja em www.loja.com.br' } as any);
    let msgs = (await treino.verTeste(ana, criado.id)).mensagens;
    expect(msgs.slice(-2)).toEqual([
      expect.objectContaining({ autor: 'robo', texto: 'Veja em www.loja.com.br' }),
      expect.objectContaining({ autor: 'sistema', simulado: { tipo: 'plataforma', detalhe: 'contato' }, texto: expect.stringContaining('O iFood barraria esta resposta') }),
    ]);
    // texto longo: as partes que sairiam
    const longo = Array.from({ length: 6 }, (_, i) => `Frase ${i + 1} do atendente, explicando com calma o que aconteceu com o pedido.`).join(' ');
    await resposta.responder(SENHA, { instancia: chaveDoTeste(criado.id), para: chaveDoTeste(criado.id), texto: longo } as any);
    msgs = (await treino.verTeste(ana, criado.id)).mensagens;
    const partes = msgs.filter((m) => m.autor === 'robo').slice(1);
    expect(partes.length).toBeGreaterThanOrEqual(2);
    for (const p of partes) expect(p.texto.length).toBeLessThanOrEqual(TEXTO_MAX);
    // o chamar atendente simulado: como caso de chat, nada de verdade é aberto
    const sim: any = await cardapio.abrirAtendimento(TOK, { telefone: chaveDoTeste(criado.id), tipo: 'fornecedor', mensagem: 'Motivo: teste' }, SENHA);
    expect(sim).toMatchObject({ ok: true, prioridade: 'normal' });
    expect(sim.paraOResponsavel).toBeUndefined(); // os assuntos não se aplicam no chat
    msgs = (await treino.verTeste(ana, criado.id)).mensagens;
    expect(msgs[msgs.length - 1]).toMatchObject({ autor: 'sistema', texto: expect.stringContaining('abriria o caso do chat do iFood para a equipe') });
    expect(await q(`select 1 from atendimento_chamado where tenant_id = $1`, [T])).toHaveLength(0);
  });

  // ───────────────────────── os ajustes e a tela ─────────────────────────

  it('os ajustes: `roboModo` lido e gravado campo a campo, com auditoria; valor inválido recusado ANTES de gravar; só gerente e presidente', async () => {
    await ajustar({ modo: 'regras' });
    const user = { tenantId: T, colaboradorId: ANA, categoria: 'gerente' } as any;
    expect((await ajustes.ajustes(T, loja)).roboModo).toBe('regras');
    await expect(ajustes.conferir(user, loja, { roboModo: 'ia' })).rejects.toThrow('Quem responde no chat: escolha "Frases prontas" ou "Atendente virtual".');
    await expect(ajustes.salvar(user, loja, { roboModo: 'ia', ligada: false })).rejects.toThrow(BadRequestException);
    expect((await q(`select chat_robo_modo, chat_ponte_ligada from robo_config where tenant_id = $1`, [T]))[0]).toEqual({ chat_robo_modo: 'regras', chat_ponte_ligada: true });
    const depois = await ajustes.salvar(user, loja, { roboModo: 'atendente' });
    expect(depois.roboModo).toBe('atendente');
    expect(auditados.find((a) => a.acao === 'ponte_do_chat_ajustada')?.detalhe).toEqual({ chat_robo_modo: 'atendente' });
    // RBAC no servidor: as rotas dos ajustes são só de gerente e presidente
    for (const metodo of ['ajustes', 'salvarAjustes'])
      expect(Reflect.getMetadata(ROLES_KEY, (AtendimentoController.prototype as any)[metodo])).toEqual(['presidente', 'gerente']);
  });

  it('a conversa do caso (`GET /atendimento/:id/chat`): cada mensagem traz `roboIa` — só a fala do atendente virtual é true', async () => {
    await pedido('tl-1');
    await fala('tl-1', 'Oi');
    const chave = await chaveDe('tl-1');
    await responder(chave, 'Oi, Maria! Em que posso ajudar?');
    const r: any = await cardapio.abrirAtendimento(TOK, { telefone: chave, mensagem: 'Motivo: quer falar com alguém' }, SENHA);
    const conversa = await chatCaso.conversaDaEmpresa(T, r.id);
    expect(conversa.mensagens.map((m) => [m.autor, m.roboIa])).toEqual([
      ['cliente', false],
      ['robo', true],
    ]);
  });
});
