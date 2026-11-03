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
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
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
        template_idioma text, template_vars jsonb, mensagem_b text, cliques integer not null default 0,
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
});
