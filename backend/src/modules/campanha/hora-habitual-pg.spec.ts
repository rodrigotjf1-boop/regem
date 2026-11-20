import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarEvento, type OrigemConsentimento } from '../../common/consentimento-marketing';
import { conferirEnvioHabitual } from '../../common/segmentos-do-perfil';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CAMPANHA NA HORA HABITUAL DE CADA CLIENTE (F7 parte 4b do plano do perfil do cliente, mig 480), contra o Postgres real:
// o momento de cada cliente em cada dia (a faixa daquele dia, a habitual, o pico da loja, 19h sem nada), de 30 a 60 min
// antes, dentro de 8h–23h; só o aceite CLICADO; a prévia com quem fica de fora e as horas; a fila que manda na hora de cada
// um, espera sem concluir e conclui quando acaba. As tabelas só da nuvem (195, 226, 300, 459) num schema SÓ DESTE TESTE, sem
// FK para as compartilhadas (LIC-088); empresa, cliente, pedido_externo e modulo_ativacao são os do `public`.
// O `PGOPTIONS` entra junto (rodar também com `PGOPTIONS="-c timezone=UTC"` — V46).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('hora-habitual-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/** Quarta-feira, 18/11/2026, às HH:MM de São Paulo (UTC−3). */
const quarta = (hhmm: string) => new Date(`2026-11-18T${hhmm}:00-03:00`);
const entre = (v: number, de: number, ate: number) => v >= de && v <= ate;

descrever('a campanha na hora habitual (Postgres)', () => {
  const SCHEMA = `teste_hh_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const T = randomUUID();
  const OUTRA = randomUUID();
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let svc: CampanhaService;
  const saidas: string[] = [];
  const ids: Record<string, string> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `${process.env.PGOPTIONS ?? ''} -c search_path=${SCHEMA},public`.trim() });
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);
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
    for (const m of ['300_marketing_consentimento.sql', '459_perfil_do_cliente.sql'])
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, m), 'utf8')));
    const r: any = await pool.query(readFileSync(join(MIGS, '480_campanha_hora_habitual.sql'), 'utf8'));
    const conf = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    if (conf.length !== 1 || !conf[0].ok) throw new Error(`conferência da 480: ${JSON.stringify(conf)}`);
    db = drizzle(pool, { schema });
    const numeros = { resolver: async () => ({ provedor: 'evolution', instancia: 'loja-1' }) };
    const whatsapp = { enviarPorInstancia: async (_t: string, _i: string, para: string) => void saidas.push(para) };
    svc = new CampanhaService(db, whatsapp as any, numeros as any, { limiteEnvio: async () => null } as any);
    svc.relogio = () => quarta('15:00');

    await admin.query(`insert into empresa (id, nome) values ($1,'teste hora habitual'), ($2,'outra')`, [T, OUTRA]);
    await admin.query(`insert into modulo_ativacao (tenant_id, modulo, ativo) values ($1,'perfil_cliente',true)`, [T]);

    // O pico da loja (pedidos diretos, sem cliente): quarta da semana passada às 20h00, 20h00 e 20h20; sábado às 12h30 (2×);
    // um do iFood às 11h00 de quarta, que NÃO conta. Datas relativas a hoje (sempre dentro dos 90 dias).
    const pedido = (canal: string, local: string) =>
      admin.query(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, client_ref, criado_em)
         values ($1, $2, 'entrega', '[]'::jsonb, 40, 'concluido', 'X', $3,
                 (date_trunc('week', now() at time zone 'America/Sao_Paulo') + ${local}::interval) at time zone 'America/Sao_Paulo')`,
        [T, canal, randomUUID()],
      );
    for (const l of [`'-5 days 20:00'`, `'-5 days 20:00'`, `'-5 days 20:20'`, `'-2 days 12:30'`, `'-2 days 12:30'`]) await pedido('cardapio', l);
    for (let i = 0; i < 5; i++) await pedido('ifood', `'-5 days 11:00'`);

    const cliente = async (nome: string, telefone: string, perfil: { faixa: string; hora: string | null; grade: any } | null, origem: OrigemConsentimento) => {
      const id = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [T, nome, telefone]))[0].id as string;
      if (perfil)
        await q(
          `insert into cliente_perfil (cliente_id, tenant_id, segmento, faixa_habitual, camadas)
           values ($1, $2, 'leais', $3, jsonb_build_object('ritmo', jsonb_strip_nulls(jsonb_build_object('grade', $4::jsonb, 'hora_habitual', $5::text))))`,
          [id, T, perfil.faixa, JSON.stringify(perfil.grade), perfil.hora],
        );
      await registrarEvento(db, { tenantId: T, telefone, clienteId: id, origem }, 'aceite');
      ids[nome] = id;
    };
    // Ana: início da noite, 20h10; na quarta pede no início da noite, no sábado no almoço (3 × 1).
    await cliente('Ana', '21988870001', { faixa: 'inicio_noite', hora: '20:10', grade: { '3': { inicio_noite: 5 }, '6': { almoco: 3, inicio_noite: 1 } } }, 'cardapio_perfil');
    // Bia: sem perfil (a base importada) — o pico da loja de cada dia; terça sem pedido na loja → 19h.
    await cliente('Bia', '21988870002', null, 'whatsapp');
    // Caio: madrugada, 01h10 — nada de marketing de madrugada: 23h.
    await cliente('Caio', '21988870003', { faixa: 'madrugada', hora: '01:10', grade: {} }, 'cardapio_checkout');
    // Duda: só a caixa que já vinha marcada no checkout — fora da campanha pelo perfil (D15).
    await cliente('Duda', '21988870004', { faixa: 'inicio_noite', hora: '19:00', grade: {} }, 'cardapio_checkout_marcada');
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`delete from modulo_ativacao where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`delete from pedido_externo where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`delete from cliente where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it('a conferência: ausente/falso = não; sim só com o módulo, presidente ou gerente; valor torto = 400', async () => {
    const gerente = { tenantId: T, categoria: 'gerente' };
    await expect(conferirEnvioHabitual(db, gerente, undefined)).resolves.toBe(false);
    await expect(conferirEnvioHabitual(db, gerente, false)).resolves.toBe(false);
    await expect(conferirEnvioHabitual(db, gerente, true)).resolves.toBe(true);
    await expect(conferirEnvioHabitual(db, gerente, '1')).resolves.toBe(true);
    await expect(conferirEnvioHabitual(db, gerente, 'talvez')).rejects.toBeInstanceOf(BadRequestException);
    await expect(conferirEnvioHabitual(db, { tenantId: T, categoria: 'supervisao' }, true)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(conferirEnvioHabitual(db, { tenantId: OUTRA, categoria: 'presidente' }, true)).rejects.toThrow(/Ligue o módulo/);
  });

  it('a prévia: só o aceite clicado, quem fica de fora e como os envios se espalham num dia como hoje (quarta)', async () => {
    const p: any = await svc.previa(T, 'todos', undefined, {});
    expect(p.total).toBe(3); // Ana, Bia e Caio
    expect(p.habitual.foraPorAceite).toBe(1); // a Duda
    expect(p.habitual.dia).toBe(3);
    // Ana 20h10 − 30..60 → 19h10–19h40; Bia no pico de quarta (≈20h07) → 19h07–19h37; Caio → 23h.
    expect(p.habitual.porHora).toEqual({ '19': 2, '23': 1 });
    // Sem a hora habitual, a prévia de sempre (a Duda entra; sem o bloco novo).
    const comum: any = await svc.previa(T, 'todos');
    expect(comum.total).toBe(4);
    expect(comum.habitual).toBeUndefined();
  });

  it('o criar: a marca na campanha e os 7 momentos de cada um; a campanha de sempre fica sem nada disso', async () => {
    const r = await svc.criar(T, null, null, { segmento: 'todos', mensagem: 'Combo da noite', intervaloSeg: 3, envioHabitual: true });
    expect(r.total).toBe(3);
    ids.campanha = r.id;
    expect((await q(`select envio_habitual from campanha where id = $1`, [r.id]))[0].envio_habitual).toBe(true);
    const alvos: Record<string, number[]> = {};
    for (const l of await q(`select cliente_id, minutos_alvo from campanha_envio where campanha_id = $1`, [r.id]))
      alvos[Object.keys(ids).find((k) => ids[k] === l.cliente_id)!] = l.minutos_alvo;
    expect(Object.keys(alvos).sort()).toEqual(['Ana', 'Bia', 'Caio']);
    for (const a of Object.values(alvos)) expect(a).toHaveLength(7);
    // Ana: quarta e segunda (sem pedido na segunda → a faixa habitual) na hora dela; sábado no almoço = a hora da loja (12h30).
    expect(entre(alvos.Ana[2], 1150, 1180)).toBe(true);
    expect(entre(alvos.Ana[0], 1150, 1180)).toBe(true);
    expect(entre(alvos.Ana[5], 690, 720)).toBe(true);
    // Bia: quarta no pico da loja (início da noite, ≈20h07); terça, a loja sem pedido → 19h; sábado no almoço.
    expect(entre(alvos.Bia[2], 1146, 1178)).toBe(true);
    expect(entre(alvos.Bia[1], 1080, 1110)).toBe(true);
    expect(entre(alvos.Bia[5], 690, 720)).toBe(true);
    // Caio: todo dia às 23h (o limite).
    expect(alvos.Caio).toEqual([1380, 1380, 1380, 1380, 1380, 1380, 1380]);

    const comum = await svc.criar(T, null, null, { segmento: 'todos', mensagem: 'Promoção de sempre', intervaloSeg: 3 });
    expect(comum.total).toBe(4);
    expect((await q(`select envio_habitual from campanha where id = $1`, [comum.id]))[0].envio_habitual).toBe(false);
    expect(await q(`select count(*)::int as n from campanha_envio where campanha_id = $1 and minutos_alvo is not null`, [comum.id])).toEqual([{ n: 0 }]);
    await q(`update campanha set status = 'pausada' where id = $1`, [comum.id]); // fora da fila do próximo teste
  });

  it('a janela da campanha agendada limita os momentos (11h–14h: ninguém depois das 13h50)', async () => {
    const r = await svc.criar(T, null, null, {
      segmento: 'todos', mensagem: 'Almoço', intervaloSeg: 3, envioHabitual: true, agendada: true, horaInicio: '11:00', horaFim: '14:00',
    });
    const todos = (await q(`select minutos_alvo from campanha_envio where campanha_id = $1`, [r.id])).flatMap((l: any) => l.minutos_alvo);
    expect(todos.length).toBe(21);
    expect(todos.every((m: number) => m >= 660 && m <= 830)).toBe(true);
    await q(`update campanha set status = 'pausada' where id = $1`, [r.id]);
  });

  it('a fila: manda na hora de cada um, espera sem concluir e conclui quando acaba', async () => {
    const id = ids.campanha;
    await q(`update campanha set intervalo_seg = 0 where id = $1`, [id]);
    const situacao = async () => (await q(`select status, enviados from campanha where id = $1`, [id]))[0];

    svc.relogio = () => quarta('15:00'); // ninguém na hora
    await svc.worker();
    expect(saidas).toEqual([]);
    expect(await situacao()).toEqual({ status: 'enviando', enviados: 0 });

    svc.relogio = () => quarta('19:45'); // Ana e Bia (o momento delas já chegou; a janela vai até ~20h40)
    await svc.worker();
    await svc.worker();
    await svc.worker(); // a terceira volta não acha ninguém na hora — e não conclui (o Caio espera)
    expect(saidas.sort()).toEqual(['5521988870001', '5521988870002']);
    expect(await situacao()).toEqual({ status: 'enviando', enviados: 2 });

    svc.relogio = () => quarta('23:05'); // o Caio
    await svc.worker();
    expect(saidas).toContain('5521988870003');
    await svc.worker(); // acabou: conclui
    expect(await situacao()).toEqual({ status: 'concluida', enviados: 3 });
  });

  it('a lista diz quais campanhas vão na hora habitual', async () => {
    const lista: any[] = await svc.listar(T);
    const minha = lista.find((c) => c.id === ids.campanha);
    expect(minha.envio_habitual).toBe(true);
    expect(lista.filter((c) => c.envio_habitual).length).toBe(2);
  });
});
