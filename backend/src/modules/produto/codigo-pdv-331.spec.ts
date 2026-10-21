import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Auditoria do KDS (20/10/2026, ERR-257): os canais mandam o código PDV em cada item e o aceite liga o item pelo
// `produto.codigo` antes do nome; os produtos da loja tinham os códigos de outro sistema, alguns iguais ao código PDV de
// OUTRO item. A mig 331 põe o código PDV dos canais em 63 produtos (lista conferida pelo dono): duas fases por causa do
// índice único (tenant_id, codigo), auditoria encadeada com o código de antes, só na nuvem.
// A spec monta os produtos COM OS IDS da lista numa transação desfeita no fim, com cada código novo ocupado por outro
// produto da lista antes da troca (sem a fase 1, o índice único recusaria).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('codigo-pdv-331.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '331_codigo_pdv_dos_canais_nos_produtos.sql');

// Os dois blocos `values` da migration (o da troca e o da conferência), como [{ id, codigo }].
function listas(texto: string) {
  return [...texto.matchAll(/\(values\s*([\s\S]*?)\)\s*as l\(produto_id, codigo\)/g)].map((m) =>
    [...m[1].matchAll(/\('([0-9a-f-]{36})'::uuid, '(\d+)'\)/g)].map((x) => ({ id: x[1], codigo: x[2] })),
  );
}

describe('migration 331 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('só nuvem, passa pela trava do Supabase, só id e código (sem nome) e a mesma lista na troca e na conferência', () => {
    expect(texto.split(/\r?\n/)[0]).toBe('-- @cloud-only');
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    const [troca, conferencia, ...outros] = listas(texto);
    expect(outros).toEqual([]);
    expect(troca).toHaveLength(63);
    expect(conferencia).toEqual(troca);
    expect(new Set(troca.map((x) => x.id)).size).toBe(63);
    expect(new Set(troca.map((x) => x.codigo)).size).toBe(63);
    // Regra de dado sensível: nenhum nome de produto ou de loja no repositório.
    expect(texto).not.toMatch(/\b(coca|trio|numero|batata|nuggets|combo|burg\w*|mister|cheddar)\b/i);
  });
});

descrever('migration 331 (Postgres)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const sql331 = readFileSync(ARQUIVO, 'utf8');
  const [lista] = listas(sql331);
  afterAll(async () => {
    await pool.end();
  }, 60_000);

  // Monta, no cliente em transação, a empresa e os produtos com os ids da lista: o 1º já com o código novo, o 2º excluído,
  // o último sem código (como dois produtos da loja) e os demais num CICLO — cada um com o código NOVO do seguinte e o
  // último do ciclo com o do primeiro: nenhum código novo está livre, então nenhuma ordem de gravação escapa do índice
  // único sem a fase 1.
  async function montar(q: (s: string, p?: any[]) => Promise<any[]>) {
    const t = (await q(`insert into empresa (nome) values ('teste migration 331') returning id`))[0].id as string;
    const [jaCerto, excluido, ...resto] = lista;
    const produto = (id: string, codigo: string | null, excluidoEm = false) =>
      q(
        `insert into produto (id, tenant_id, codigo, nome, preco_venda, deleted_at)
         values ($1, $2, $3, 'Produto de teste', '10.00', case when $4::boolean then now() end)`,
        [id, t, codigo, excluidoEm],
      );
    await produto(jaCerto.id, jaCerto.codigo);
    await produto(excluido.id, 'antigo-excluido', true);
    const ciclo = resto.length - 1;
    const antigo = (i: number) => (i === ciclo ? null : resto[(i + 1) % ciclo].codigo);
    for (let i = 0; i < resto.length; i++) await produto(resto[i].id, antigo(i));
    const fora = randomUUID();
    await produto(fora, 'fora-da-lista');
    const codigos = async () =>
      new Map((await q(`select id, codigo from produto where tenant_id = $1`, [t])).map((x: any) => [x.id, x.codigo]));
    return { t, jaCerto, excluido, resto, antigo, fora, codigos };
  }

  it('troca em duas fases, deixa de fora o excluído e quem não está na lista, audita o código de antes e não repete', async () => {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      // "Como nuvem": a migration só roda onde existe `edge_status` (o banco do CI é de loja).
      if (!(await q(`select to_regclass(current_schema() || '.edge_status') as t`))[0].t) {
        await q(`create table edge_status (equipamento_id uuid primary key, tenant_id uuid, unidade_id uuid, versao text, recebido_em timestamptz)`);
      }
      const m = await montar(q);
      // Só a leitura da auditoria usa o serviço (`registrar` abriria transação própria e confirmaria esta).
      const auditoria = new AuditoriaService(drizzle(c as any, { schema }) as any);

      const res: any = await c.query(sql331);
      const conferencia = (Array.isArray(res) ? res[res.length - 1] : res).rows[0];
      expect(conferencia).toMatchObject({ ok: true, nuvem: true, produtos_na_lista: '62', com_codigo_novo: '62' });

      const depois = await m.codigos();
      for (const x of [m.jaCerto, ...m.resto]) expect(depois.get(x.id)).toBe(x.codigo);
      expect(depois.get(m.excluido.id)).toBe('antigo-excluido');
      expect(depois.get(m.fora)).toBe('fora-da-lista');

      // Auditoria: uma linha, na corrente da empresa, com o código de antes de cada produto que trocou (o que já estava
      // certo não entra).
      const aud = await q(`select seq, actor_tipo, tipo, entidade_tipo, detalhe from audit_log where tenant_id = $1 and acao = 'trocou_codigo_pdv'`, [m.t]);
      expect(aud).toHaveLength(1);
      expect(aud[0]).toMatchObject({ seq: 1, actor_tipo: 'distribuicao', tipo: 'cadastro', entidade_tipo: 'produto' });
      expect(aud[0].detalhe).toMatchObject({ migration: '331', produtos: m.resto.length });
      const esperadas = m.resto
        .map((x, i) => ({ de: m.antigo(i), id: x.id, para: x.codigo }))
        .sort((a, b) => Number(a.para) - Number(b.para));
      expect(aud[0].detalhe.trocas).toEqual(esperadas);
      expect(await auditoria.verificarCadeia(m.t)).toEqual({ ok: true, total: 1, quebras: [] });

      // De novo: nada a trocar, nenhuma auditoria a mais.
      await c.query(sql331);
      expect((await q(`select count(*)::int as n from audit_log where tenant_id = $1 and acao = 'trocou_codigo_pdv'`, [m.t]))[0].n).toBe(1);
      expect(await m.codigos()).toEqual(depois);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });

  it('no servidor da loja (sem edge_status) não troca nada: os códigos chegam pela sincronização', async () => {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      if ((await q(`select to_regclass(current_schema() || '.edge_status') as t`))[0].t) return; // banco "como nuvem"
      const m = await montar(q);
      const antes = await m.codigos();
      const res: any = await c.query(sql331);
      expect((Array.isArray(res) ? res[res.length - 1] : res).rows[0]).toMatchObject({ ok: true, nuvem: false });
      expect(await m.codigos()).toEqual(antes);
      expect((await q(`select count(*)::int as n from audit_log where tenant_id = $1`, [m.t]))[0].n).toBe(0);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});
