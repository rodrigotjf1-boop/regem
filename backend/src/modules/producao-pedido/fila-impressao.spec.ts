import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FILA DE IMPRESSÃO DO PAINEL — contra o Postgres real (TEST_PG_URL).
//
// O painel de Equipamentos mostrava "as 40 impressões mais recentes", de qualquer situação. Num dia
// de movimento, a impressão que FALHOU (a única que pede ação: reimprimir) saía da lista atrás de
// 40 impressas depois dela. Agora vêm todas as que estão na fila e as que falharam, mais as 40
// impressas mais recentes.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('fila-impressao.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('fila de impressão do painel', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  // o método só usa o banco
  const fila = (t: string, unidade: string | null = null) => (ProducaoPedidoService.prototype as any).filaRecente.call({ db }, t, unidade) as Promise<any[]>;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['impressao_job', 'equipamento', 'unidade']) await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste fila de impressão') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const imp = (await q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token) values ($1, $2, 'Impressora de teste', 'impressora', $3) returning id`, [t, u, randomBytes(12).toString('hex')]))[0].id as string;
    return { t, u, imp };
  }
  /** Um job com a situação pedida, criado há `min` minutos. */
  const job = async (c: { t: string; u: string | null; imp: string }, status: string, min: number, unidade: string | null | undefined = undefined) =>
    (await q(
      `insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo, status, criado_em) values ($1, $2, $3, 'producao', 'teste', $4, now() - make_interval(mins => $5)) returning id`,
      [c.t, unidade === undefined ? c.u : unidade, c.imp, status, min],
    ))[0].id as string;

  it('a impressão que falhou e a que está na fila não somem atrás de 40 impressas depois delas', async () => {
    const c = await empresa();
    const falhou = await job(c, 'erro', 600);
    const naFila = await job(c, 'pendente', 500);
    const enviando = await job(c, 'enviando', 400);
    await q(
      `insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo, status, criado_em)
       select $1, $2, $3, 'cupom', 'teste', 'impresso', now() - make_interval(mins => g) from generate_series(1, 55) g`,
      [c.t, c.u, c.imp],
    );
    const r = await fila(c.t);
    const ids = r.map((j) => j.id);
    expect(ids).toEqual(expect.arrayContaining([falhou, naFila, enviando]));
    expect(r.filter((j) => j.status === 'impresso')).toHaveLength(40);
    expect(r).toHaveLength(43);
    // da mais nova para a mais antiga, com o nome da impressora
    const tempos = r.map((j) => new Date(j.criadoEm).getTime());
    expect([...tempos].sort((a, b) => b - a)).toEqual(tempos);
    expect(r[0].impressora).toBe('Impressora de teste');
  });

  it('quem tem loja vê a fila dela e os jobs sem loja; outra empresa nunca aparece', async () => {
    const a = await empresa();
    const b = await empresa();
    const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Outra loja de teste') returning id`, [a.t]))[0].id as string;
    const daLoja = await job(a, 'erro', 5);
    const semLoja = await job(a, 'pendente', 4, null);
    const daOutra = await job(a, 'erro', 3, outraLoja);
    await job(b, 'erro', 2);
    expect((await fila(a.t, a.u)).map((j) => j.id).sort()).toEqual([daLoja, semLoja].sort());
    expect((await fila(a.t)).map((j) => j.id).sort()).toEqual([daLoja, semLoja, daOutra].sort());
  });
});
