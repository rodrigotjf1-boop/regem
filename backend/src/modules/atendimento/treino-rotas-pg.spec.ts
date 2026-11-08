import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ExecutionContext, ForbiddenException, Global, INestApplication, Module, NotFoundException, ValidationPipe } from '@nestjs/common';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import * as schema from '../../db/schema';
import { DRIZZLE } from '../../db/drizzle.module';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { perfilPadrao } from '../../auth/permissoes';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService } from './disputa-ifood.service';
import { Pedido99Service } from './pedido-99.service';
import { ChatIfoodService } from './chat-ifood.service';
import { FilaEAvisosService } from './fila-e-avisos.service';
import { ChatDoCasoService } from './chat-do-caso.service';
import { ChegadaService } from '../chegada/chegada.service';
import { PedidoRepetidoService } from '../pedido-repetido/pedido-repetido.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { AjustesDaPonteService } from '../ponte-chat/ajustes-da-ponte.service';
import { InstagramController } from '../instagram/instagram.controller';
import { InstagramService } from '../instagram/instagram.service';
import { TreinoDoAtendenteController } from './treino.controller';
import { TreinoDoAtendenteService } from './treino.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TREINAR O ATENDENTE — AS ROTAS DE VERDADE (mig 382): o app Nest montado, com as guardas reais (JWT, perfil, permissão e
// "só na nuvem"), o mesmo prefixo e o mesmo ValidationPipe do `main.ts`, e os controllers que dividem o prefixo
// `atendimento` — o AtendimentoController (rotas com o `:id` no 1º segmento: `:id/chat`, `:id/o-que-aconteceu`, …) e o do
// Instagram (`:id/instagram`) registrados ANTES do do treino (o pior caso: no Express, a 1ª rota que casa vence). Prova que
// `POST atendimento/teste`, `GET atendimento/teste/:id`, `POST atendimento/teste/:id/mensagem` e `atendimento/conhecimento`
// chegam ao controller do treino (nenhuma é engolida), que execução e supervisão levam 403, outra empresa 404, sem token
// 401 e o servidor da loja 404 (CloudOnly). O serviço de verdade, contra o Postgres (a 382 aplicada com a trava — ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('treino-rotas-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SEGREDO_JWT = 'segredo-jwt-do-teste-das-rotas-do-treino';

descrever('treinar o atendente — as rotas HTTP de verdade', () => {
  let pool: Pool;
  let db: any;
  let app: INestApplication;
  let base = '';
  let jwt: JwtService;
  const T = randomUUID();
  const T2 = randomUUID();
  const antes: Record<string, string | undefined> = {};
  const auditoria: any[] = [];
  const entregas: any[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  /** O token de uma pessoa (sem linha em `colaborador`: a guarda fica com o nível e as permissões do token). */
  const token = (cat: string, tenant = T) => jwt.sign({ sub: randomUUID(), tenant, cat, perm: perfilPadrao(cat).permissoes, nome: `Pessoa ${cat}` });
  const chamar = async (metodo: string, caminho: string, quem: string | null, corpo?: unknown) => {
    const r = await fetch(`${base}/api/v1/atendimento/${caminho}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(quem ? { Authorization: `Bearer ${quem}` } : {}) },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    let json: any = null;
    try {
      json = texto ? JSON.parse(texto) : null;
    } catch {
      json = texto;
    }
    return { status: r.status, json };
  };

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
    delete process.env.EDGE_MODE;
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo-das-rotas';
    process.env.N8N_ROBO_WEBHOOK_URL = 'https://n8n.teste.invalid/webhook/robo';
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    // a 383 altera `robo_config` (342) e `chat_plataforma_msg` (366): as duas antes, ou a suíte cai no beforeAll num banco em
    // que nenhuma outra spec criou as tabelas ainda
    await aplicar('342_robo_pausa_e_config.sql');
    await aplicar('366_ponte_do_chat.sql');
    await aplicar('382_treinar_atendente.sql');
    await aplicar('383_atendente_no_chat.sql'); // o teste do chat do iFood (F5): atendente_teste.plataforma (ERR-273)
    await q(`insert into empresa (id, nome) values ($1, 'teste rotas do treino'), ($2, 'outra empresa das rotas')`, [T, T2]);
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico) values ($1, null, $2, true, 'Loja das rotas')`, [T, `tok-rotas-${randomUUID()}`]);

    @Global()
    @Module({
      providers: [
        { provide: DRIZZLE, useValue: db },
        { provide: AuditoriaService, useValue: { registrar: async (e: any) => void auditoria.push(e) } },
      ],
      exports: [DRIZZLE, AuditoriaService],
    })
    class InfraTeste {}

    // O AtendimentoController e o do Instagram com os serviços de mentira — só o que as rotas de controle usam responde.
    @Module({
      imports: [InfraTeste, JwtModule.register({ secret: SEGREDO_JWT })],
      controllers: [AtendimentoController, InstagramController, TreinoDoAtendenteController],
      providers: [
        { provide: APP_GUARD, useClass: CloudOnlyGuard },
        TreinoDoAtendenteService,
        { provide: AtendimentoService, useValue: {} },
        { provide: DisputaIfoodService, useValue: {} },
        { provide: Pedido99Service, useValue: {} },
        { provide: ChatIfoodService, useValue: {} },
        { provide: FilaEAvisosService, useValue: {} },
        { provide: ChegadaService, useValue: {} },
        { provide: PedidoRepetidoService, useValue: {} },
        { provide: ProducaoPedidoService, useValue: {} },
        { provide: AjustesDaPonteService, useValue: {} },
        { provide: ChatDoCasoService, useValue: { conversa: async (_u: any, id: string) => ({ rota: 'chat-do-caso', id }) } },
        { provide: InstagramService, useValue: { conversa: async (_t: string, id: string) => ({ rota: 'instagram', id }) } },
      ],
    })
    class AppTeste {}

    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    const end: any = app.getHttpServer().address();
    base = `http://127.0.0.1:${end.port}`;
    jwt = app.get(JwtService);
    app.get(TreinoDoAtendenteService).buscar = (async (_url: any, init: any) => {
      entregas.push(JSON.parse(String(init?.body ?? 'null')));
      return { ok: true, status: 200 } as any;
    }) as any;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    await app?.close();
    if (!pool) return;
    for (const t of [T, T2]) {
      for (const tab of ['atendente_teste_msg', 'atendente_teste', 'atendente_conhecimento', 'cardapio_config'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });

  it('nenhuma rota do treino é engolida pelas de `:id` no 1º segmento — e as de controle continuam indo para os seus controllers', async () => {
    const gerente = token('gerente');
    const criado = await chamar('POST', 'teste', gerente, { canal: 'whatsapp' });
    expect(criado).toEqual({ status: 201, json: { id: expect.any(String), canal: 'whatsapp', foraDoHorario: false, esperandoResposta: false, mensagens: [] } });
    const id = criado.json.id;
    expect(await chamar('GET', `teste/${id}`, gerente)).toEqual({
      status: 200,
      json: { id, canal: 'whatsapp', foraDoHorario: false, esperandoResposta: false, mensagens: [] },
    });
    const msg = await chamar('POST', `teste/${id}/mensagem`, gerente, { texto: 'tem x-bacon?' });
    expect(msg).toMatchObject({ status: 201, json: { entregue: true, mensagem: { autor: 'cliente', texto: 'tem x-bacon?' } } });
    expect(entregas.at(-1)).toMatchObject({ instancia: `teste:${id}`, de: `teste:${id}`, texto: 'tem x-bacon?' });
    expect((await chamar('GET', `teste/${id}`, gerente)).json.esperandoResposta).toBe(true);
    // o que ele aprendeu
    expect(await chamar('GET', 'conhecimento', gerente)).toEqual({ status: 200, json: { itens: [], limite: 100 } });
    const novo = await chamar('POST', 'conhecimento', gerente, { assunto: 'entrega', pergunta: 'entrega no centro?', resposta: 'Entregamos!', origem: 'teste', extra: 'sai' });
    expect(novo).toMatchObject({ status: 201, json: { assunto: 'entrega', pergunta: 'entrega no centro?', resposta: 'Entregamos!', origem: 'teste', criadoPorNome: 'Pessoa gerente' } });
    expect(await chamar('PATCH', `conhecimento/${novo.json.id}`, gerente, { resposta: 'Entregamos, sim!' })).toMatchObject({
      status: 200,
      json: { id: novo.json.id, resposta: 'Entregamos, sim!' },
    });
    expect((await chamar('GET', 'conhecimento', gerente)).json.itens).toHaveLength(1);
    expect(await chamar('DELETE', `conhecimento/${novo.json.id}`, gerente)).toEqual({ status: 200, json: { ok: true } });
    expect(auditoria.map((e) => e.acao)).toEqual(['atendente_conhecimento_criado', 'atendente_conhecimento_alterado', 'atendente_conhecimento_apagado']);
    // controle positivo: as rotas de `:id` no 1º segmento seguem nos controllers delas
    const caso = randomUUID();
    expect(await chamar('GET', `${caso}/chat`, gerente)).toEqual({ status: 200, json: { rota: 'chat-do-caso', id: caso } });
    expect(await chamar('GET', `${caso}/instagram`, gerente)).toEqual({ status: 200, json: { rota: 'instagram', id: caso } });
  });

  it('o teste no CHAT DO iFOOD (F5, mig 383): POST e GET mostram `canal: "chat"`; a mensagem vai com a plataforma e sem pedido', async () => {
    const gerente = token('gerente');
    const criado = await chamar('POST', 'teste', gerente, { canal: 'chat' });
    expect(criado).toEqual({ status: 201, json: { id: expect.any(String), canal: 'chat', foraDoHorario: false, esperandoResposta: false, mensagens: [] } });
    const id = criado.json.id;
    expect((await chamar('GET', `teste/${id}`, gerente)).json).toMatchObject({ id, canal: 'chat' });
    expect(await q(`select canal, plataforma from atendente_teste where id = $1`, [id])).toEqual([{ canal: 'whatsapp', plataforma: 'ifood' }]);
    await chamar('POST', `teste/${id}/mensagem`, gerente, { texto: 'cadê meu pedido?' });
    expect(entregas.at(-1)).toMatchObject({ instancia: `teste:${id}`, provedor: 'instagram', plataforma: 'ifood', pedido: null });
    expect(await chamar('POST', 'teste', gerente, { canal: 'messenger' })).toMatchObject({
      status: 400,
      json: { message: 'Escolha o canal do teste: WhatsApp, Direct do Instagram ou chat do iFood.' },
    });
  });

  it('RBAC no servidor: execução e supervisão levam 403 em TODAS as rotas do treino; presidente entra; sem token 401', async () => {
    const id = (await chamar('POST', 'teste', token('presidente'), { canal: 'direct', foraDoHorario: true })).json.id;
    expect(id).toEqual(expect.any(String));
    const item = (await chamar('POST', 'conhecimento', token('presidente'), { assunto: 'outro', pergunta: 'p', resposta: 'r', origem: 'manual' })).json.id;
    const rotas: Array<[string, string, unknown?]> = [
      ['POST', 'teste', { canal: 'whatsapp' }],
      ['GET', `teste/${id}`],
      ['POST', `teste/${id}/mensagem`, { texto: 'oi' }],
      ['GET', 'conhecimento'],
      ['POST', 'conhecimento', { assunto: 'outro', pergunta: 'p', resposta: 'r', origem: 'manual' }],
      ['PATCH', `conhecimento/${item}`, { resposta: 'r2' }],
      ['DELETE', `conhecimento/${item}`],
    ];
    for (const cat of ['execucao', 'supervisao']) {
      const t = token(cat);
      for (const [m, c, corpo] of rotas) expect([cat, m, c, (await chamar(m, c, t, corpo)).status]).toEqual([cat, m, c, 403]);
    }
    for (const [m, c, corpo] of rotas) expect([m, c, (await chamar(m, c, null, corpo)).status]).toEqual([m, c, 401]);
    // nada mudou com as recusas
    expect((await q(`select count(*)::int as n from atendente_conhecimento where tenant_id = $1`, [T]))[0].n).toBe(1);
    expect((await q(`select count(*)::int as n from atendente_teste_msg where teste_id = $1`, [id]))[0].n).toBe(0);
  });

  it('multi-tenant e forma: teste e item de OUTRA empresa = 404; id que não é uuid = 400; o servidor da loja não responde (CloudOnly, 404)', async () => {
    const id = (await chamar('POST', 'teste', token('gerente'), { canal: 'whatsapp' })).json.id;
    const item = (await chamar('POST', 'conhecimento', token('gerente'), { assunto: 'outro', pergunta: 'p', resposta: 'r', origem: 'manual' })).json.id;
    const outra = token('gerente', T2);
    expect((await chamar('GET', `teste/${id}`, outra)).status).toBe(404);
    expect((await chamar('POST', `teste/${id}/mensagem`, outra, { texto: 'oi' })).status).toBe(404);
    expect((await chamar('PATCH', `conhecimento/${item}`, outra, { resposta: 'invasão' })).status).toBe(404);
    expect((await chamar('DELETE', `conhecimento/${item}`, outra)).status).toBe(404);
    expect((await chamar('GET', 'conhecimento', outra)).json).toEqual({ itens: [], limite: 100 });
    expect((await chamar('GET', 'teste/nao-e-uuid', token('gerente'))).status).toBe(400);
    expect((await chamar('DELETE', 'conhecimento/nao-e-uuid', token('gerente'))).status).toBe(400);
    // as recusas com código chegam à tela como combinado
    expect(await chamar('POST', 'teste', token('gerente', T2), { canal: 'whatsapp' })).toMatchObject({ status: 409, json: { code: 'SEM_CARDAPIO' } });
    process.env.N8N_ROBO_WEBHOOK_URL = '';
    try {
      expect(await chamar('POST', 'teste', token('gerente'), { canal: 'whatsapp' })).toEqual({
        status: 409,
        json: { statusCode: 409, code: 'ROBO_INDISPONIVEL', message: 'O atendente virtual não está disponível nesta instalação.' },
      });
    } finally {
      process.env.N8N_ROBO_WEBHOOK_URL = 'https://n8n.teste.invalid/webhook/robo';
    }
    // No servidor da loja: a guarda CloudOnly (que lê o EDGE_MODE ao nascer, como no processo da loja) barra TODAS as rotas
    // do treino com 404; e, se algo vazasse, o próprio serviço recusa abrir o teste (a 2ª barreira).
    process.env.EDGE_MODE = 'true';
    try {
      const guardaDaLoja = new CloudOnlyGuard(new Reflector());
      const nomes = ['criarTeste', 'verTeste', 'mandarMensagem', 'listarConhecimento', 'criarConhecimento', 'editarConhecimento', 'apagarConhecimento'] as const;
      for (const nome of nomes) {
        expect(Reflect.getMetadata(CLOUD_ONLY, TreinoDoAtendenteController.prototype[nome])).toBe(true);
        const ctx = { getHandler: () => TreinoDoAtendenteController.prototype[nome], getClass: () => TreinoDoAtendenteController } as unknown as ExecutionContext;
        expect(() => guardaDaLoja.canActivate(ctx)).toThrow(NotFoundException);
      }
      expect(await chamar('POST', 'teste', token('gerente'), { canal: 'whatsapp' })).toMatchObject({ status: 409, json: { code: 'ROBO_INDISPONIVEL' } });
    } finally {
      delete process.env.EDGE_MODE;
    }
  });

  it('o suporte (técnico da distribuição) passa como gerente pelo RolesGuard; execução e supervisão não', () => {
    const guarda = new RolesGuard(new Reflector());
    const contexto = (categoria: string, metodo: keyof TreinoDoAtendenteController) =>
      ({
        getHandler: () => TreinoDoAtendenteController.prototype[metodo],
        getClass: () => TreinoDoAtendenteController,
        switchToHttp: () => ({ getRequest: () => ({ user: { categoria } }) }),
      }) as unknown as ExecutionContext;
    for (const metodo of ['criarTeste', 'verTeste', 'mandarMensagem', 'listarConhecimento', 'criarConhecimento', 'editarConhecimento', 'apagarConhecimento'] as const) {
      for (const cat of ['presidente', 'gerente', 'suporte']) expect(guarda.canActivate(contexto(cat, metodo))).toBe(true);
      for (const cat of ['supervisao', 'execucao']) expect(() => guarda.canActivate(contexto(cat, metodo))).toThrow(ForbiddenException);
    }
  });
});
