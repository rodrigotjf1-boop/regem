import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { noGrupoDeControle, sqlNoGrupoDeControle } from '../../common/grupo-de-controle';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O GRUPO DE CONTROLE DAS CAMPANHAS (F7 parte 3 do plano do perfil do cliente, mig 465), contra o Postgres real: o sorteio
// fixo é o mesmo no banco e no Node; ligado, a prévia diz quantos ficam de fora, o criar não manda para eles e os guarda
// com status 'controle'; o resultado compara quem recebeu × o controle; desligado, nada muda.
// As tabelas só da nuvem num schema SÓ DESTE TESTE (LIC-088).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('grupo-de-controle-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) => s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

descrever('o grupo de controle das campanhas (Postgres)', () => {
  const SCHEMA = `teste_gc_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let svc: CampanhaService;
  const empresas: string[] = [];
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
    await pool.query(readFileSync(join(MIGS, '465_campanha_grupo_de_controle.sql'), 'utf8'));
    db = drizzle(pool, { schema });
    const numeros = { resolver: async () => ({ provedor: 'evolution', instancia: 'loja-1' }) };
    const whatsapp = { enviarPorInstancia: async () => undefined };
    svc = new CampanhaService(db, whatsapp as any, numeros as any, { limiteEnvio: async () => null } as any);
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    for (const t of empresas) {
      await admin.query(`delete from pedido_externo where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from cliente where tenant_id = $1`, [t]).catch(() => {});
      await admin.query(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  /** Uma empresa com 200 clientes (com 10%, o controle nunca sai vazio: 0,9^200 ≈ 0). */
  async function empresa(controle: boolean) {
    const [{ id: t }] = (await admin.query(`insert into empresa (nome) values ('Teste grupo de controle') returning id`)).rows;
    empresas.push(t);
    await q(`insert into relacionamento_config (tenant_id, grupo_controle) values ($1, $2)`, [t, controle]);
    await admin.query(
      `insert into cliente (tenant_id, nome, telefone) select $1, 'Cliente ' || g, '2198800' || lpad(g::text, 4, '0') from generate_series(1, 200) g`,
      [t],
    );
    return t as string;
  }

  it('o sorteio fixo é o mesmo no banco e no Node, e fica perto de 10%', async () => {
    const t = await empresa(true);
    const banco: any = await db.execute(sql`select c.id, ${sqlNoGrupoDeControle()} as g from cliente c where c.tenant_id = ${t}::uuid`);
    const r = banco.rows ?? banco;
    expect(r).toHaveLength(200);
    for (const x of r) expect(x.g).toBe(noGrupoDeControle(t, x.id));
    const n = r.filter((x: any) => x.g).length;
    expect(n).toBeGreaterThan(5);
    expect(n).toBeLessThan(45);
  });

  it('ligado: a prévia diz quantos ficam de fora, o criar não manda para eles e os guarda; o resultado compara os dois grupos', async () => {
    const t = await empresa(true);
    const prev: any = await svc.previa(t, 'todos');
    expect(prev.total + prev.foraPorControle).toBe(200);
    expect(prev.foraPorControle).toBeGreaterThan(0);
    const r = await svc.criar(t, null, null, { segmento: 'todos', mensagem: 'Promoção de teste', intervaloSeg: 3 });
    expect(r.total).toBe(prev.total);
    const [conta] = await q(
      `select count(*) filter (where status = 'pendente')::int as pendentes, count(*) filter (where status = 'controle')::int as controle,
              count(*) filter (where status = 'controle' and variante is not null)::int as controle_com_variante
         from campanha_envio where campanha_id = $1`,
      [r.id],
    );
    expect(conta).toEqual({ pendentes: prev.total, controle: prev.foraPorControle, controle_com_variante: 0 });

    // Os envios saem há 3 dias; metade de quem recebeu pede depois; do controle, só um pede.
    await q(`update campanha_envio set status = 'enviado', enviado_em = now() - interval '3 days' where campanha_id = $1 and status = 'pendente'`, [r.id]);
    const recebeu = await q(`select cliente_id from campanha_envio where campanha_id = $1 and status = 'enviado' order by cliente_id`, [r.id]);
    const ctrl = await q(`select cliente_id from campanha_envio where campanha_id = $1 and status = 'controle' order by cliente_id`, [r.id]);
    const pedir = async (cli: string) =>
      admin.query(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, cliente_nome, client_ref, cliente_id, criado_em)
         values ($1,'cardapio','entrega','[]'::jsonb,40,'concluido','X',$2,$3, now() - interval '1 day')`,
        [t, randomUUID(), cli],
      );
    const metade = recebeu.slice(0, Math.floor(recebeu.length / 2));
    for (const x of metade) await pedir(x.cliente_id);
    await pedir(ctrl[0].cliente_id);
    const m: any = await svc.metricas(t, r.id);
    expect(m.controle.recebeu).toMatchObject({ base: recebeu.length, pediram: metade.length });
    expect(m.controle.controle).toMatchObject({ base: ctrl.length, pediram: 1 });
    expect(m.controle.pouco).toBe(true); // menos de 100 no controle
    expect(m.controle.recebeu.taxa).toBeCloseTo((100 * metade.length) / recebeu.length, 0);
    // A conta do A/B e os tetos não enxergam o controle (status próprio, sem variante).
    expect(m.total).toBe(prev.total);
  });

  it('desligado: a prévia e o criar como antes (sem a conta do controle)', async () => {
    const t = await empresa(false);
    const prev: any = await svc.previa(t, 'todos');
    expect(prev).toEqual({ total: 200, foraPorOferta: 0, intervaloOfertasDias: null });
    const r = await svc.criar(t, null, null, { segmento: 'todos', mensagem: 'Promoção de teste', intervaloSeg: 3 });
    expect(r.total).toBe(200);
    expect(await q(`select count(*)::int as n from campanha_envio where campanha_id = $1 and status = 'controle'`, [r.id])).toEqual([{ n: 0 }]);
    expect((await svc.metricas(t, r.id)).controle).toBeNull();
  });
});
