import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CAMPANHA PULA QUEM RECEBEU OFERTA AUTOMÁTICA (decisão do dono 3B, 03/11/2026), contra o Postgres real: "uma oferta
// por cliente a cada N dias" valia só num sentido (a automática pulava quem recebeu campanha). Agora a campanha também
// pula quem recebeu uma oferta AUTOMÁTICA no intervalo das Automáticas — na prévia (que diz quantos ficaram de fora), ao
// montar a lista e, de novo, na hora de mandar (a oferta que saiu depois — LIC-514). O telefone casa pela CHAVE (55, sem
// o 9, número curto), com o filtro barato antes (ERR-353).
// O banco do CI é o de uma loja: as tabelas só da nuvem (campanha, envio, exclusão, automáticas) sobem num schema SÓ
// DESTE TESTE (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('campanha-oferta-recente-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

descrever('a campanha pula quem recebeu oferta automática (3B)', () => {
  const SCHEMA = `teste_camp_oferta_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: Pool;
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const saidas: { para: string; texto: string }[] = [];
  let svc: CampanhaService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public -c timezone=UTC` }); // a sessão em UTC, como a nuvem (ERR-542)
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create table ${SCHEMA}.campanha (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, criado_por uuid, segmento text not null,
        mensagem text not null, intervalo_seg integer not null default 7, teto_dia integer, total integer not null default 0,
        enviados integer not null default 0, falhas integer not null default 0, status text not null default 'enviando',
        instancia_tipo text not null default 'loja', tipo text not null default 'avulsa', link text, imagem_ref text,
        dias_semana jsonb, hora_inicio time, hora_fim time, teto_semana integer, teto_mes integer, cupom_codigo text,
        agendada boolean not null default false, inicia_em timestamptz, termina_em timestamptz, template_nome text,
        template_idioma text, template_vars jsonb, mensagem_b text, cliques integer not null default 0, clube_premio_id uuid,
        criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
      create table ${SCHEMA}.campanha_envio (
        id uuid primary key default gen_random_uuid(), campanha_id uuid not null, tenant_id uuid not null, cliente_id uuid,
        telefone text not null, status text not null default 'pendente', erro text, enviado_em timestamptz,
        variante text, clicou boolean not null default false, clicado_em timestamptz);`);
    for (const [arq, linhas] of [
      ['356_relacionamento_automaticas.sql', 5],
      ['357_aniversario_do_cliente.sql', 5],
      ['358_sentimos_sua_falta.sql', 2],
    ] as [string, number][]) {
      const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(join(MIGS, arq), 'utf8'))));
      const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows as { ok: boolean }[];
      if (conf.length !== linhas || conf.some((l) => !l.ok)) throw new Error(`conferência da ${arq}: ${JSON.stringify(conf)}`);
    }
    db = drizzle(pool, { schema });
    const numeros = { resolver: async () => ({ provedor: 'evolution', instancia: 'loja-1' }) };
    const whatsapp = { enviarPorInstancia: async (_t: string, _i: string, para: string, texto: string) => void saidas.push({ para, texto }) };
    const cloud = { limiteEnvio: async () => null };
    svc = new CampanhaService(db, whatsapp as any, numeros as any, cloud as any);
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  async function empresa(intervalo?: number) {
    const [{ id: t }] = (await admin.query(`insert into empresa (nome) values ('Teste campanha × automáticas') returning id`)).rows;
    empresas.push(t);
    if (intervalo) await q(`insert into relacionamento_config (tenant_id, intervalo_ofertas_dias) values ($1, $2)`, [t, intervalo]);
    return t as string;
  }
  const cliente = async (t: string, nome: string, tel: string) =>
    (await admin.query(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, tel])).rows[0].id as string;
  /** Uma mensagem das automáticas para a CHAVE do telefone, `dias` dias atrás. */
  const automatica = (t: string, chave: string, dias: number, o: { oferta?: boolean; status?: string } = {}) =>
    q(
      `insert into relacionamento_envio (tenant_id, tipo, chave_telefone, referencia, telefone, dia, oferta, status, enviado_em)
       values ($1, 'aniversario', $2, $3, $2, current_date, $4, $5, case when $5 = 'enviado' then now() - make_interval(days => $6::int) end)`,
      [t, chave, randomUUID(), o.oferta ?? true, o.status ?? 'enviado', dias],
    );

  it('a prévia separa quem recebeu oferta automática no intervalo e diz quantos; o intervalo é o das Automáticas', async () => {
    const t = await empresa();
    await cliente(t, 'Ana Lima', '21987670001');
    await automatica(t, '21987670001', 2);
    await cliente(t, 'Beto Reis', '21987670002');
    await automatica(t, '21987670002', 10); // fora dos 7 dias
    await cliente(t, 'Cris Melo', '21987670003');
    await automatica(t, '21987670003', 1, { oferta: false }); // o aviso do cashback (utilidade) não é oferta
    await cliente(t, 'Davi Souza', '21987670004');
    await automatica(t, '21987670004', 0, { status: 'pendente' }); // ainda na fila: quem segura é o envio
    await cliente(t, 'Edu Prado', '2187670005'); // o cadastro sem o nono dígito
    await automatica(t, '21987670005', 1);
    await cliente(t, 'Fábio Nunes', '0055123'); // número curto e estranho: a chave decide
    await automatica(t, '123', 1);
    await cliente(t, 'Gil Rocha', '21987670007');

    expect(await svc.previa(t, 'todos')).toEqual({ total: 4, foraPorOferta: 3, intervaloOfertasDias: 7 });
    await q(`insert into relacionamento_config (tenant_id, intervalo_ofertas_dias) values ($1, 15)`, [t]);
    expect(await svc.previa(t, 'todos')).toEqual({ total: 3, foraPorOferta: 4, intervaloOfertasDias: 15 });
  });

  it('sem oferta automática no intervalo, a prévia fica como antes', async () => {
    const t = await empresa(7);
    await cliente(t, 'Hugo Dias', '21987671001');
    await cliente(t, 'Iara Luz', '21987671002');
    await automatica(t, '21987671002', 9);
    expect(await svc.previa(t, 'todos')).toEqual({ total: 2, foraPorOferta: 0, intervaloOfertasDias: null });
  });

  it('criar: quem recebeu oferta fica fora da lista; na hora de mandar, a oferta que saiu DEPOIS também segura', async () => {
    const t = await empresa();
    await cliente(t, 'Júlia Melo', '21987672001');
    await cliente(t, 'Caio Tavares', '21987672002');
    await cliente(t, 'Lia Gomes', '21987672003');
    await automatica(t, '21987672003', 1);
    const r = await svc.criar(t, null, null, { segmento: 'todos', mensagem: 'Promoção de teste', intervaloSeg: 3 });
    expect(r.total).toBe(2);
    const lista = await q(`select telefone from campanha_envio where campanha_id = $1 order by telefone`, [r.id]);
    expect(lista.map((x: any) => x.telefone)).toEqual(['21987672001', '21987672002']);

    // O Caio recebe uma oferta automática DEPOIS de a campanha ser montada.
    await automatica(t, '21987672002', 0);
    await q(`update campanha set intervalo_seg = 0 where id = $1`, [r.id]);
    for (let i = 0; i < 4; i++) await svc.worker();
    const envios = await q(`select telefone, status, erro from campanha_envio where campanha_id = $1 order by telefone`, [r.id]);
    expect(envios).toEqual([
      { telefone: '21987672001', status: 'enviado', erro: null },
      { telefone: '21987672002', status: 'excluido', erro: 'recebeu uma oferta automática no intervalo das Automáticas' },
    ]);
    expect(saidas.map((s) => s.para)).toEqual(['5521987672001']);
  });

  // ── o lote do envio em rodízio (V84, ERR-491) ──
  /** Uma campanha "enviando" com um destinatário pendente, gravada direto (o id escolhido dá a ordem do lote). */
  async function campanhaCom(id: string, t: string, telefone: string, extra: Record<string, unknown> = {}) {
    const colunas = ['id', 'tenant_id', 'segmento', 'mensagem', 'intervalo_seg', 'status', ...Object.keys(extra)];
    const valores = [id, t, 'todos', 'Promoção do rodízio', 0, 'enviando', ...Object.values(extra)];
    await q(`insert into campanha (${colunas.join(', ')}) values (${valores.map((_, i) => `$${i + 1}`).join(', ')})`, valores);
    await q(`insert into campanha_envio (campanha_id, tenant_id, telefone) values ($1, $2, $3)`, [id, t, telefone]);
  }

  it('campanhas fora da janela ou com o teto batido não tomam o lote: as outras saem na volta seguinte (rodízio)', async () => {
    const t = await empresa();
    const [c1, c2, c3, c4, c5] = Array.from({ length: 5 }, () => randomUUID()).sort();
    const amanha = new Date(Date.now() + 86_400_000);
    await campanhaCom(c1, t, '21987673001', { agendada: true, inicia_em: amanha }); // fora da janela
    await campanhaCom(c2, t, '21987673002', { agendada: true, inicia_em: amanha }); // fora da janela
    await campanhaCom(c3, t, '21987673003', { teto_dia: 1 }); // o teto do dia já foi
    await q(`insert into campanha_envio (campanha_id, tenant_id, telefone, status, enviado_em) values ($1, $2, '21987673009', 'enviado', now())`, [c3, t]);
    await campanhaCom(c4, t, '21987673004');
    await campanhaCom(c5, t, '21987673005');
    const antes = saidas.length;
    svc.loteDoWorker = 2;
    try {
      await svc.worker(); // c1 e c2: fora da janela
      expect(saidas.slice(antes)).toEqual([]);
      await svc.worker(); // c3: teto; c4: sai
      await svc.worker(); // c5: sai; a página curta recomeça
    } finally {
      svc.loteDoWorker = 20;
    }
    expect(saidas.slice(antes).map((s) => s.para).sort()).toEqual(['5521987673004', '5521987673005']);
    // As que não podiam continuam "enviando", com o destinatário à espera — voltam quando puderem.
    const paradas = await q(
      `select c.status, e.status as envio from campanha c join campanha_envio e on e.campanha_id = c.id and e.status = 'pendente' where c.id = any($1::uuid[])`,
      [[c1, c2, c3]],
    );
    expect(paradas).toEqual(Array.from({ length: 3 }, () => ({ status: 'enviando', envio: 'pendente' })));
    await q(`update campanha set status = 'concluida' where tenant_id = $1`, [t]);
  });

  it('modelo oficial com cupom: o botão "copiar cupom" leva o código DA CAMPANHA (saía o texto fixo "CUPOM")', async () => {
    const t = await empresa();
    const id = randomUUID();
    await campanhaCom(id, t, '21987674001', { template_nome: 'promo_com_cupom', template_idioma: 'pt_BR', cupom_codigo: 'VOLTA10', instancia_tipo: 'marketing' });
    const chamadas: any[][] = [];
    const oficial = new CampanhaService(
      db,
      {} as any,
      { resolver: async () => ({ provedor: 'cloud', phoneId: 'numero-de-marketing' }) } as any,
      { limiteEnvio: async () => null, enviarTemplate: async (...a: any[]) => void chamadas.push(a) } as any,
    );
    await oficial.worker();
    expect(chamadas).toHaveLength(1);
    const [empresaDoEnvio, numero, modelo, , , opcoes] = chamadas[0];
    expect([empresaDoEnvio, numero, modelo, opcoes.cupom, opcoes.phoneId]).toEqual([t, '5521987674001', 'promo_com_cupom', 'VOLTA10', 'numero-de-marketing']);
    expect(await q(`select status from campanha_envio where campanha_id = $1`, [id])).toEqual([{ status: 'enviado' }]);
    await q(`update campanha set status = 'concluida' where tenant_id = $1`, [t]);
  });

  it('a campanha com prêmio surpresa (Clube, mig 477): o prêmio nasce antes da mensagem, o link vai sempre e o clique leva ao prêmio', async () => {
    const t = await empresa();
    const premio = randomUUID();
    const [okId, falhaId] = [randomUUID(), randomUUID()];
    await campanhaCom(okId, t, '21987675001', { clube_premio_id: premio });
    const premios: any[] = [];
    const surpresa = {
      darPelaCampanha: async (e: any) => {
        if (e.telefone === '21987675002') throw new Error('o prêmio da campanha não existe mais');
        premios.push(e);
        return 'https://app.exemplo/p/codigo-do-premio-123';
      },
      linkDaCampanha: async (envioId: string) => (premios.some((p) => p.envioId === envioId) ? 'https://app.exemplo/p/codigo-do-premio-123' : null),
    };
    const comClube = new CampanhaService(db, (svc as any).whatsapp, (svc as any).numeros, {} as any, {} as any, surpresa as any);
    saidas.length = 0;
    await comClube.worker();
    const [envio] = await q(`select id, status from campanha_envio where campanha_id = $1`, [okId]);
    expect(envio.status).toBe('enviado');
    expect(premios).toEqual([{ tenantId: t, envioId: envio.id, clienteId: null, telefone: '21987675001', premioId: premio }]);
    // a campanha sem link próprio leva o link rastreado mesmo assim (é por ele que o destinatário revela o prêmio)
    expect(saidas).toHaveLength(1);
    expect(saidas[0].texto).toContain(`/publico/campanha/r/${envio.id}`);
    // o clique leva ao link pessoal do prêmio (e conta o clique como sempre)
    expect(await comClube.registrarClique(envio.id)).toBe('https://app.exemplo/p/codigo-do-premio-123');
    expect((await q(`select clicou from campanha_envio where id = $1`, [envio.id]))[0].clicou).toBe(true);
    // sem o prêmio, nada sai: o envio fica em falha com o motivo
    await q(`update campanha set status = 'concluida' where id = $1`, [okId]);
    await campanhaCom(falhaId, t, '21987675002', { clube_premio_id: premio });
    saidas.length = 0;
    await comClube.worker();
    expect(saidas).toEqual([]);
    expect(await q(`select status, erro from campanha_envio where campanha_id = $1`, [falhaId])).toEqual([
      { status: 'falha', erro: 'o prêmio da campanha não existe mais' },
    ]);
    // sem o Clube (o módulo não subiu), a campanha com prêmio não sai
    const semClube = new CampanhaService(db, (svc as any).whatsapp, (svc as any).numeros, {} as any);
    await q(`update campanha_envio set status = 'pendente', erro = null where campanha_id = $1`, [falhaId]);
    await semClube.worker();
    expect((await q(`select erro from campanha_envio where campanha_id = $1`, [falhaId]))[0].erro).toBe('o Clube não está disponível para criar o prêmio');
    await expect(semClube.criar(t, null, null, { segmento: 'todos', mensagem: 'Com prêmio', clubePremioId: premio })).rejects.toThrow(
      'O Clube não está disponível agora',
    );
    await q(`update campanha set status = 'concluida' where tenant_id = $1`, [t]);
  });

  it('o teto do dia começa à meia-noite de Brasília, em qualquer fuso da sessão (ERR-542)', async () => {
    const t = await empresa();
    const c = randomUUID();
    await campanhaCom(c, t, '21987674001', { teto_dia: 1 });
    // Enviado às 23h30 de ONTEM em Brasília: não conta no teto de hoje. Antes, com a sessão em UTC (a nuvem), o "hoje"
    // começava às 21h da véspera e este envio contava.
    await q(
      `insert into campanha_envio (campanha_id, tenant_id, telefone, status, enviado_em)
       values ($1, $2, '21987674009', 'enviado',
               (date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') - interval '30 minutes')`,
      [c, t],
    );
    // A sessão desta spec está em UTC, como a nuvem (o pool, lá em cima).
    expect(await (svc as any).enviadosNoPeriodo(c, 'day')).toBe(0);
    // E o envio de agora conta.
    await q(`insert into campanha_envio (campanha_id, tenant_id, telefone, status, enviado_em) values ($1, $2, '21987674010', 'enviado', now())`, [c, t]);
    expect(await (svc as any).enviadosNoPeriodo(c, 'day')).toBe(1);
  });
});
