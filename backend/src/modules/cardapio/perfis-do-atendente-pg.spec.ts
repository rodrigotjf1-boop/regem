import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Logger } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AtendimentoController } from '../atendimento/atendimento.controller';
import { FilaEAvisosService } from '../atendimento/fila-e-avisos.service';
import { CardapioService } from './cardapio.service';
import { RoboConsultasController } from './robo-consultas.controller';
import { perfisDaEmpresa, perfisPadrao, salvarPerfisDoAtendente } from './perfis-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PERFIL DO ATENDENTE VIRTUAL (mig 380 — protótipo `mockups/regem-central-atendimento.html` v11), contra o Postgres real:
// os ajustes (GET/PUT pelo controlador, sempre os dois canais), a mescla campo a campo dentro do jsonb (V82 — um canal não
// apaga o outro, um salvamento não desfaz o do lado), a auditoria, a recusa ANTES de gravar qualquer grupo (V86), o banco
// sem a 380 (os padrões, sem derrubar a transação), o servidor da loja (V1) e a rota de instruções do robô (o perfil de
// fora do horário quando a equipe não atende; falha ao ler = as instruções de hoje). Aplica a 342, a 353, a 379 e a 380
// (só da nuvem: o banco do CI é o de uma loja — ERR-329), com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('perfis-do-atendente-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SENHA = 'senha-do-robo-dos-perfis';
const FUSO = 'America/Sao_Paulo';
const semanaSp = (d: Date) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(d));
// Uma janela daqui a 3 dias (10:00–11:00): agora está SEMPRE fora dela.
const JANELA_LONGE = [{ dia: semanaSp(new Date(Date.now() + 3 * 86_400_000)), ativo: true, abre: '10:00', fecha: '11:00' }];
// Todos os dias, 00:00–23:59 (com a folga, sem buraco): agora está SEMPRE dentro.
const SEMPRE_ABERTA = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre: '00:00', fecha: '23:59' }));

descrever('perfil do atendente virtual (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let fila: FilaEAvisosService;
  let ctl: AtendimentoController;
  const auditoria: any[] = [];
  const T = randomUUID();
  let ana: string;
  let cardapio: string;
  const INSTANCIA = `inst-perfis-${T.slice(0, 8)}`;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const gerente = () => ({ tenantId: T, colaboradorId: ana, categoria: 'gerente' }) as any;
  const coluna = async () => (await q(`select atendente_perfis from robo_config where tenant_id = $1`, [T]))[0]?.atendente_perfis;
  const horarios = (h: unknown[]) => q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [cardapio, JSON.stringify(h)]);
  const modoDaEquipe = (m: 'sempre' | 'loja') =>
    q(`insert into robo_config (tenant_id, equipe_atende) values ($1, $2) on conflict (tenant_id) do update set equipe_atende = $2`, [T, m]);
  const gravarPerfis = (v: unknown) =>
    q(`insert into robo_config (tenant_id, atendente_perfis) values ($1, $2::jsonb) on conflict (tenant_id) do update set atendente_perfis = $2::jsonb`, [
      T,
      JSON.stringify(v),
    ]);
  const dialeto = new PgDialect();
  /** O texto de uma consulta do drizzle (para achar a leitura dos perfis); o que não for `sql` volta vazio. */
  const textoDa = (consulta: any): string => {
    try {
      return dialeto.sqlToQuery(consulta).sql;
    } catch {
      return '';
    }
  };
  const naoUsar = () => new Proxy({}, { get: () => () => Promise.reject(new Error('não deveria ser chamado')) });
  const nulo = () => new Proxy({}, { get: () => async () => null });

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
    antes.EDGE_MODE = process.env.EDGE_MODE;
    antes.BOT_RESOLVER_SECRET = process.env.BOT_RESOLVER_SECRET;
    delete process.env.EDGE_MODE; // como NUVEM
    process.env.BOT_RESOLVER_SECRET = SENHA;
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['342_robo_pausa_e_config.sql', '353_app_atendimento.sql', '379_horario_da_equipe.sql', '380_perfis_do_atendente.sql']) await aplicar(m);
    fila = new FilaEAvisosService(db, { emit: () => true } as any, { registrar: async (e: any) => void auditoria.push(e) } as any);
    // Só a fila (o dono do grupo) é de verdade: os outros grupos devolvem "nada" na leitura (o GET não cai por eles).
    ctl = new AtendimentoController(nulo() as any, nulo() as any, nulo() as any, nulo() as any, fila, nulo() as any, nulo() as any, nulo() as any, nulo() as any, nulo() as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste perfil do atendente')`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana') returning id`, [T]);
    [{ id: cardapio }] = await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Burger da Praça', $3) returning id`,
      [T, `tok-${randomUUID()}`, INSTANCIA],
    );
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    if (!pool) return;
    await q(`delete from robo_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from colaborador where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    auditoria.length = 0;
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    await horarios(SEMPRE_ABERTA);
  });

  it('GET dos ajustes: sempre os cinco canais (F5: + o chat do iFood e da 99; F6: + os comentários do Instagram; mig 386: + o Messenger) com os padrões ("Como hoje", "O mesmo", sem jeito) e as opções', async () => {
    const r: any = await ctl.ajustes(gerente(), null);
    expect(r.perfis).toEqual({
      whatsapp: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      direct: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      chat: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      comentarios: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      messenger: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
    });
    expect(r.perfisOpcoes).toEqual({
      canais: ['whatsapp', 'direct', 'chat', 'comentarios', 'messenger'],
      rotulos: {
        whatsapp: 'WhatsApp',
        direct: 'Direct do Instagram',
        chat: 'Chat do iFood e da 99',
        comentarios: 'Comentários do Instagram',
        messenger: 'Messenger do Facebook',
      },
      perfis: ['hoje', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor'],
      foraDoHorario: ['mesmo', 'profissional', 'cordial', 'gentil', 'descontraido', 'objetivo', 'acolhedor'],
      jeitoMax: 300,
    });
    // linha com lixo no jsonb (outro escritor antigo): normalizado, a tela recebe os padrões no que não vale
    await gravarPerfis({ whatsapp: { perfil: 'bravo', foraDoHorario: 'objetivo', jeito: 12 }, direct: 'cordial', messenger: {}, tiktok: { perfil: 'gentil' } });
    expect((await ctl.ajustes(gerente(), null)).perfis).toEqual({
      whatsapp: { perfil: 'hoje', foraDoHorario: 'objetivo', jeito: null },
      direct: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      chat: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      comentarios: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      messenger: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
    });
  });

  it('PUT: grava o que veio, um canal não apaga o outro, as outras colunas ficam (V82) e cada mudança vai à auditoria', async () => {
    await q(`insert into robo_config (tenant_id, avisar_gerente_min, equipe_atende) values ($1, 5, 'loja')`, [T]);
    const r1: any = await ctl.salvarAjustes(gerente(), null, { perfis: { whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo' } } });
    expect(r1.perfis.whatsapp).toEqual({ perfil: 'cordial', foraDoHorario: 'objetivo', jeito: null });
    expect(r1.perfis.direct).toEqual({ perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null });
    const r2: any = await ctl.salvarAjustes(gerente(), null, { perfis: { direct: { perfil: 'gentil', jeito: ' assine como\nBurger ' } } });
    expect(r2.perfis).toEqual({
      whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo', jeito: null },
      direct: { perfil: 'gentil', foraDoHorario: 'mesmo', jeito: 'assine como Burger' },
      chat: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      comentarios: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      messenger: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
    });
    // no banco: só os campos que mudaram de cada canal (o resto vem dos padrões na leitura)
    expect(await coluna()).toEqual({ whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo' }, direct: { perfil: 'gentil', jeito: 'assine como Burger' } });
    const [outras] = await q(`select avisar_gerente_min, equipe_atende from robo_config where tenant_id = $1`, [T]);
    expect(outras).toEqual({ avisar_gerente_min: 5, equipe_atende: 'loja' }); // outros donos (V82)
    expect(auditoria.map((a) => [a.acao, a.detalhe])).toEqual([
      ['atendente_perfil_alterado', { canal: 'whatsapp', campo: 'perfil', de: 'hoje', para: 'cordial' }],
      ['atendente_perfil_alterado', { canal: 'whatsapp', campo: 'foraDoHorario', de: 'mesmo', para: 'objetivo' }],
      ['atendente_perfil_alterado', { canal: 'direct', campo: 'perfil', de: 'hoje', para: 'gentil' }],
      ['atendente_perfil_alterado', { canal: 'direct', campo: 'jeito', de: null, para: 'assine como Burger' }],
    ]);
    expect(auditoria.every((a) => a.tipo === 'config' && a.entidadeTipo === 'robo_config' && a.atorId === ana)).toBe(true);
    // nada mudou: nada na auditoria; jeito vazio volta a "sem jeito"
    auditoria.length = 0;
    await ctl.salvarAjustes(gerente(), null, { perfis: { whatsapp: { perfil: 'cordial' } } });
    expect(auditoria).toEqual([]);
    const r3: any = await ctl.salvarAjustes(gerente(), null, { perfis: { direct: { jeito: '' } } });
    expect(r3.perfis.direct).toEqual({ perfil: 'gentil', foraDoHorario: 'mesmo', jeito: null });
    expect(auditoria.map((a) => a.detalhe)).toEqual([{ canal: 'direct', campo: 'jeito', de: 'assine como Burger', para: null }]);
  });

  it('linha nova (sem robo_config): o PUT cria a linha com o canal inteiro', async () => {
    const r = await fila.salvarPerfis(gerente(), { direct: { foraDoHorario: 'acolhedor' } });
    expect(r.direct).toEqual({ perfil: 'hoje', foraDoHorario: 'acolhedor', jeito: null });
    expect(await coluna()).toEqual({ direct: { perfil: 'hoje', foraDoHorario: 'acolhedor', jeito: null } });
  });

  it('mescla campo a campo: um salvamento que leu ANTES do outro gravar não desfaz o campo do outro (V82)', async () => {
    await gravarPerfis({ whatsapp: { perfil: 'cordial' } });
    // Entre a leitura e a gravação deste salvamento, "outra tela" grava o jeito do mesmo canal.
    let outroGravou = false;
    const dbComCorrida = {
      execute: async (consulta: any) => {
        const r = await db.execute(consulta);
        if (!outroGravou && textoDa(consulta).includes("-> 'atendente_perfis'")) {
          outroGravou = true;
          await q(`update robo_config set atendente_perfis = jsonb_set(atendente_perfis, '{whatsapp,jeito}', '"trate por você"') where tenant_id = $1`, [T]);
        }
        return r;
      },
    };
    const r = await salvarPerfisDoAtendente(dbComCorrida, gerente(), { whatsapp: { foraDoHorario: 'gentil' } });
    expect(outroGravou).toBe(true);
    expect(r.whatsapp).toEqual({ perfil: 'cordial', foraDoHorario: 'gentil', jeito: 'trate por você' });
    // canal com lixo no jsonb (não objeto): recomeça do objeto vazio, sem virar lista
    await gravarPerfis({ whatsapp: 'lixo', direct: { perfil: 'objetivo' } });
    const r2 = await fila.salvarPerfis(gerente(), { whatsapp: { perfil: 'acolhedor' } });
    expect(r2).toEqual({
      whatsapp: { perfil: 'acolhedor', foraDoHorario: 'mesmo', jeito: null },
      direct: { perfil: 'objetivo', foraDoHorario: 'mesmo', jeito: null },
      chat: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      comentarios: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
      messenger: { perfil: 'hoje', foraDoHorario: 'mesmo', jeito: null },
    });
    expect(await coluna()).toEqual({ whatsapp: { perfil: 'acolhedor' }, direct: { perfil: 'objetivo' } });
    // o canal do chat (F5) grava como os outros, só os campos que mudaram, sem tocar nos outros canais
    const r3 = await fila.salvarPerfis(gerente(), { chat: { perfil: 'objetivo', foraDoHorario: 'gentil' } });
    expect(r3.chat).toEqual({ perfil: 'objetivo', foraDoHorario: 'gentil', jeito: null });
    expect(await coluna()).toEqual({ whatsapp: { perfil: 'acolhedor' }, direct: { perfil: 'objetivo' }, chat: { perfil: 'objetivo', foraDoHorario: 'gentil' } });
  });

  it('salvar com vários grupos: a recusa dos perfis vem ANTES de gravar qualquer grupo (V86)', async () => {
    await q(`insert into robo_config (tenant_id, avisar_gerente_min) values ($1, 5)`, [T]);
    const so: any = new AtendimentoController(naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any, fila, naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any);
    await expect(so.salvarAjustes(gerente(), null, { fila: { avisarGerenteMin: 10 }, perfis: { whatsapp: { perfil: 'bravo' } } })).rejects.toThrow(
      'Perfil do WhatsApp: escolha um dos perfis da lista.',
    );
    await expect(so.salvarAjustes(gerente(), null, { equipe: { atende: 'loja' }, perfis: { direct: { jeito: 'a'.repeat(301) } } })).rejects.toThrow(
      'Jeito da loja (Direct): no máximo 300 letras.',
    );
    // (o Messenger ganhou perfil na mig 386: o canal que não existe é outro)
    await expect(so.salvarAjustes(gerente(), null, { fila: { avisarGerenteMin: 10 }, perfis: { tiktok: { perfil: 'cordial' } } })).rejects.toThrow(
      'não tem perfil',
    );
    // e a recusa de OUTRO grupo também não grava os perfis
    await expect(so.salvarAjustes(gerente(), null, { perfis: { whatsapp: { perfil: 'cordial' } }, equipe: { antesMin: 45 } })).rejects.toThrow('Começa a atender');
    const [l] = await q(`select avisar_gerente_min, equipe_atende, atendente_perfis from robo_config where tenant_id = $1`, [T]);
    expect(l).toEqual({ avisar_gerente_min: 5, equipe_atende: 'sempre', atendente_perfis: {} });
    expect(auditoria).toEqual([]);
  });

  it('num banco sem a 380 (ou sem a robo_config): os padrões, e a TRANSAÇÃO de quem chama segue', async () => {
    const esquema = `perfis_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await q(`create schema ${esquema}`);
    const isolado = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema},public` });
    try {
      const c = await isolado.connect();
      try {
        await c.query('begin');
        const dbTx = drizzle(c as any, { schema });
        expect(await perfisDaEmpresa(dbTx, T)).toEqual(perfisPadrao());
        await c.query(`create table ${esquema}.robo_config (tenant_id uuid primary key, equipe_atende text)`);
        await c.query(`insert into ${esquema}.robo_config (tenant_id) values ($1)`, [T]);
        expect(await perfisDaEmpresa(dbTx, T)).toEqual(perfisPadrao());
        expect((await c.query('select 1 as ok')).rows[0].ok).toBe(1); // a transação não foi derrubada
        await c.query('rollback');
      } finally {
        c.release();
      }
    } finally {
      await isolado.end();
      await q(`drop schema ${esquema} cascade`);
    }
  });

  it('no servidor da loja (sem a robo_config): os padrões, sem ler o banco (V1)', async () => {
    process.env.EDGE_MODE = 'true';
    try {
      expect(await perfisDaEmpresa({ execute: () => Promise.reject(new Error('não deveria ler')) } as any, T)).toEqual(perfisPadrao());
    } finally {
      delete process.env.EDGE_MODE;
    }
  });

  describe('a rota de instruções do robô (publico/bot/instrucoes)', () => {
    const u = {} as any;
    const instrucoes = (rota: RoboConsultasController, fluxo = '1') => rota.instrucoes(fluxo, INSTANCIA, '', undefined, SENHA) as Promise<any>;
    const ABERTURA_DE_HOJE = 'Você atende os clientes da Burger da Praça no WhatsApp. Converse como uma pessoa da equipe: simpática, acolhedora e objetiva.';
    const ABERTURA_COM_PERFIL = 'Você atende os clientes da Burger da Praça no WhatsApp. Converse como uma pessoa da equipe.';
    let rota: RoboConsultasController;
    beforeAll(() => {
      rota = new RoboConsultasController(new CardapioService(db, u, u, u, u, u, { emit: () => true } as any, u));
    });

    it('sem perfil ("Como hoje"): as instruções de hoje, sem bloco', async () => {
      const r = await instrucoes(rota);
      expect(r.texto.startsWith(`${ABERTURA_DE_HOJE}\n\nJEITO DE CONVERSAR`)).toBe(true);
      expect(r.texto).not.toContain('PERFIL DE ATENDIMENTO');
    });

    it('fora do horário da equipe: o perfil de FORA, logo depois da abertura; no horário (ou "Sempre"), o do canal', async () => {
      await gravarPerfis({ whatsapp: { perfil: 'cordial', foraDoHorario: 'objetivo', jeito: 'nunca prometa brinde' }, direct: { perfil: 'gentil' } });
      await modoDaEquipe('loja');
      await horarios(JANELA_LONGE); // a equipe NÃO atende agora
      const noite = await instrucoes(rota, '2');
      expect(noite.fluxo).toBe(2);
      expect(noite.texto.startsWith(`${ABERTURA_COM_PERFIL}\n\nPERFIL DE ATENDIMENTO (escolhido pela loja): OBJETIVO.`)).toBe(true);
      expect(noite.texto).toContain('JEITO DA LOJA (escrito pela loja, siga quando não contrariar as regras abaixo): nunca prometa brinde');
      expect(noite.texto).not.toContain('CORDIAL');
      expect(noite.texto).not.toContain('GENTIL'); // o perfil do Direct não vai ao WhatsApp
      await horarios(SEMPRE_ABERTA); // a equipe atende
      const dia = await instrucoes(rota);
      expect(dia.texto.startsWith(`${ABERTURA_COM_PERFIL}\n\nPERFIL DE ATENDIMENTO (escolhido pela loja): CORDIAL.`)).toBe(true);
      // "Sempre": a equipe atende sempre — o do canal, mesmo com a janela longe
      await modoDaEquipe('sempre');
      await horarios(JANELA_LONGE);
      expect((await instrucoes(rota)).texto).toContain('(escolhido pela loja): CORDIAL.');
      // "O mesmo" fora do horário: o do canal
      await modoDaEquipe('loja');
      await gravarPerfis({ whatsapp: { perfil: 'cordial', foraDoHorario: 'mesmo' } });
      expect((await instrucoes(rota)).texto).toContain('(escolhido pela loja): CORDIAL.');
    });

    it('erro ao ler os perfis: as instruções de hoje (o robô não cai), com aviso no log', async () => {
      await gravarPerfis({ whatsapp: { perfil: 'objetivo' } });
      const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const dbQueFalha = new Proxy(db, {
          get(alvo, prop) {
            if (prop !== 'execute') return Reflect.get(alvo, prop);
            return (consulta: any) =>
              textoDa(consulta).includes("-> 'atendente_perfis'") ? Promise.reject(new Error('conexão caiu')) : alvo.execute(consulta);
          },
        });
        const rotaQueFalha = new RoboConsultasController(new CardapioService(dbQueFalha, u, u, u, u, u, { emit: () => true } as any, u));
        const r = await instrucoes(rotaQueFalha);
        expect(r.texto.startsWith(`${ABERTURA_DE_HOJE}\n\nJEITO DE CONVERSAR`)).toBe(true);
        expect(r.texto).not.toContain('OBJETIVO');
        expect(aviso.mock.calls.some((c) => String(c[0]).includes('perfil do atendente (whatsapp) não lido') && String(c[0]).includes('conexão caiu'))).toBe(true);
      } finally {
        aviso.mockRestore();
      }
      // com a leitura de volta, o perfil volta
      expect((await instrucoes(rota)).texto).toContain('(escolhido pela loja): OBJETIVO.');
    });
  });
});
