import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sqlCalcularPerfis } from './calculo-do-perfil';

const MIG_459 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '459_perfil_do_cliente.sql');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CÁLCULO DO PERFIL DO CLIENTE (F1a do docs/plano-perfil-cliente.md, mig 459), contra o Postgres real. O banco do CI é
// o de uma loja: as tabelas só da nuvem (459 e a nota do pedido da 453) sobem DENTRO da transação, desfeita no fim.
// Cenários: a cliente fiel e atrasada (ritmo, faixa, hora, de sempre, reclamações agrupadas, avaliações, etiquetas com o
// porquê); quem só pediu pela 99 (fora — D1); o cliente novo (confiança baixa); quem pediu para não ser analisado (o
// perfil antigo sai); e o cálculo de UM cliente.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('perfil-cliente-pg.spec: sem TEST_PG_URL — PULADO');

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');

describe('migration 459 (arquivo)', () => {
  const texto = readFileSync(join(MIGS, '459_perfil_do_cliente.sql'), 'utf8');
  it('é só da nuvem, sem drop, com RLS nas quatro tabelas', () => {
    expect(texto).toMatch(/^-- @cloud-only/);
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    for (const t of ['cliente_perfil', 'cliente_escolha', 'cliente_declarado', 'perfil_cliente_execucao'])
      expect(texto).toMatch(new RegExp(`alter table ${t} enable row level security`));
  });
});

descrever('perfil do cliente — o cálculo (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (459) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088): a
  // transação do teste só tem DML — DDL com a trava da empresa dentro dela é o risco do ERR-539 (deadlock com as outras suítes no banco dividido).
  const SCHEMA = `teste_perfil_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    await pool.query(semFkCompartilhada(readFileSync(MIG_459, 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  async function cenario(c: PoolClient) {
    const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
    if (!(await q(`select to_regclass('pedido_avaliacao') as t`))[0].t) {
      await q(`create table pedido_avaliacao (id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
        unidade_id uuid, pedido_id uuid not null, nota smallint not null, pesou text[] not null default '{}',
        comentario text, origem text not null, chamado_id uuid, criado_em timestamptz not null default clock_timestamp())`);
    }
    const t = (await q(`insert into empresa (nome) values ('teste perfil 459') returning id`))[0].id as string;
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    const cliente = async (nome: string, tel: string) =>
      (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, tel]))[0].id as string;
    // `diasAtras` a partir de hoje às 23:40 UTC (= 20:40 em Brasília, a faixa "início da noite").
    const pedido = async (cl: string, canal: string, diasAtras: number, itens: any[], total = 70) =>
      (await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens,
           total, cliente_id, criado_em)
         values ($1,$2,$3,$4,'1','Cliente','entrega','concluido',$5::jsonb,$6,$7,
                 (date_trunc('day', now() at time zone 'UTC') at time zone 'UTC') + interval '23 hours 40 minutes'
                   - make_interval(days => $8::int)) returning id`,
        [t, u, canal, randomUUID(), JSON.stringify(itens), total, cl, diasAtras],
      ))[0].id as string;
    const xbacon = { descricao: 'X-Bacon da casa', codigo: '10', quantidade: 1 };
    const coca = { descricao: 'Coca 2 L', codigo: '20', quantidade: 1 };
    const batata = { descricao: 'Batata rústica', codigo: '30', quantidade: 1 };

    // Ana: 10 pedidos diretos a cada 6 dias, o último há 11 dias (atrasada contra o próprio ritmo).
    const ana = await cliente('Ana', '21977770001');
    const pedAna: string[] = [];
    for (let i = 0; i < 10; i++) pedAna.push(await pedido(ana, 'cardapio_web', 11 + 6 * i, i < 8 ? [xbacon, coca] : [xbacon, batata]));
    // Duas notas baixas por atraso (o mesmo motivo duas vezes) e um caso de pedido errado.
    await q(`insert into pedido_avaliacao (tenant_id, pedido_id, nota, pesou, origem, criado_em) values
             ($1,$2,3,'{"Tempo de entrega"}','pagina', now() - interval '12 days'), ($1,$3,2,'{"Tempo de entrega","Temperatura"}','pagina', now() - interval '18 days'),
             ($1,$4,5,'{}','pagina', now() - interval '24 days')`, [t, pedAna[0], pedAna[1], pedAna[2]]);
    await q(`insert into atendimento_chamado (tenant_id, unidade_id, tipo, pedido_id, prioridade, status, canal, criado_em)
             values ($1,$2,'erro',$3,'normal','resolvido','whatsapp', now() - interval '30 days')`, [t, u, pedAna[3]]);

    // Bia: só pela 99 — fica fora do perfil (D1).
    const bia = await cliente('Bia', '21977770002');
    for (let i = 0; i < 3; i++) await pedido(bia, '99food', 5 + 7 * i, [xbacon]);
    // Caio: um pedido direto há 2 dias.
    const caio = await cliente('Caio', '21977770003');
    await pedido(caio, 'anotaai', 2, [batata], 40);
    // Duda: pedia direto, já tinha perfil, e pediu para não ser analisada.
    const duda = await cliente('Duda', '21977770004');
    for (let i = 0; i < 4; i++) await pedido(duda, 'cardapio', 3 + 5 * i, [coca], 20);
    await q(`insert into cliente_perfil (cliente_id, tenant_id, calculado_em) values ($1,$2, now() - interval '2 days')`, [duda, t]);
    await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'nao_analisar',true,'cardapio_perfil')`, [t, duda]);
    return { q, t, ana, bia, caio, duda };
  }

  it('grava o perfil dos clientes diretos com ritmo, gosto, reclamações agrupadas e etiquetas explicáveis', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const { q, t, ana, bia, caio, duda } = await cenario(c);
      const db = drizzle(c as any);
      const gravados: any = await db.execute(sqlCalcularPerfis(t, null, true));
      const ids = (gravados.rows ?? gravados).map((r: any) => r.cliente_id).sort();
      expect(ids).toEqual([ana, caio].sort()); // nem a Bia (99) nem a Duda (não analisar)
      await q(`delete from cliente_perfil where tenant_id = $1 and calculado_em < now()`, [t]);
      expect(await q(`select 1 from cliente_perfil where cliente_id = $1`, [duda])).toEqual([]);
      expect(await q(`select 1 from cliente_perfil where cliente_id = $1`, [bia])).toEqual([]);

      const [a] = await q(`select * from cliente_perfil where cliente_id = $1`, [ana]);
      expect(a.pedidos_diretos).toBe(10);
      expect(a.confianca).toBe('alta');
      expect(Number(a.intervalo_dias)).toBeGreaterThan(5);
      expect(Number(a.intervalo_dias)).toBeLessThan(8);
      expect(Number(a.atraso)).toBeGreaterThan(1.5);
      expect(a.faixa_habitual).toBe('inicio_noite');
      expect(a.camadas.ritmo.hora_habitual).toBe('20:40');
      expect(a.camadas.gosto.de_sempre).toEqual({ nome: 'X-Bacon da casa', pedidos: 10 });
      expect(a.camadas.gosto.favoritos[0].nome).toBe('X-Bacon da casa');
      expect(a.etiquetas).toEqual(expect.arrayContaining(['atrasado', 'reclamou_repetido']));
      expect(a.camadas.porque.atrasado).toMatch(/dias sem pedir; o intervalo habitual é de \d+ dias \(\d+,\d+×; o limite é 1,5\)/);
      const grupos = a.camadas.reclamacoes.grupos;
      expect(grupos[0]).toMatchObject({ motivo: 'atraso', nome: 'atraso', vezes: 2 });
      expect(grupos.map((g: any) => g.motivo)).toEqual(expect.arrayContaining(['chegou_frio', 'pedido_errado']));
      expect(a.camadas.reclamacoes.total).toBe(4); // atraso 2× + frio + pedido errado
      expect(a.camadas.avaliacoes).toMatchObject({ quantas: 3, ultimas: [3, 2, 5], mais_pesa: 'Tempo de entrega' });
      expect(Number(a.camadas.avaliacoes.media)).toBeCloseTo(3.3, 1);

      const [k] = await q(`select * from cliente_perfil where cliente_id = $1`, [caio]);
      expect(k).toMatchObject({ pedidos_diretos: 1, confianca: 'baixa', segmento: 'recentes', faixa_habitual: null });
      expect(k.etiquetas).toContain('novo');
      expect(k.camadas.gosto.de_sempre).toBeUndefined();
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('o cálculo de UM cliente usa os números da loja inteira e não mexe nos outros', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const { q, t, ana, caio } = await cenario(c);
      const db = drizzle(c as any);
      await db.execute(sqlCalcularPerfis(t, null, true));
      const [antes] = await q(`select intervalo_dias, ticket_ajustado from cliente_perfil where cliente_id = $1`, [caio]);
      const so: any = await db.execute(sqlCalcularPerfis(t, ana, true));
      expect((so.rows ?? so).map((r: any) => r.cliente_id)).toEqual([ana]);
      const [depois] = await q(`select intervalo_dias, ticket_ajustado from cliente_perfil where cliente_id = $1`, [caio]);
      expect(depois).toEqual(antes);
      // Sem tabela de notas (banco de loja): as avaliações vêm vazias, o resto do perfil sai igual.
      await db.execute(sqlCalcularPerfis(t, ana, false));
      const [a] = await q(`select pedidos_diretos, camadas from cliente_perfil where cliente_id = $1`, [ana]);
      expect(a.pedidos_diretos).toBe(10);
      expect(a.camadas.avaliacoes.quantas).toBe(0);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
