import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { hojeISO, somarDias } from '../../common/data';
import { EtiquetaValidadeService } from './etiqueta-validade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LISTA DE ETIQUETAS VIVAS — contra Postgres (TEST_PG_URL). A aba Etiquetas mostra e conta as
// etiquetas que ainda estão na prateleira; a lista sem filtro corta nas 300 mais recentes de
// qualquer situação, e era aí que a vencida antiga (a que pede a perda) ficava de fora.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('etiquetas de validade: lista das vivas (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let servico: EtiquetaValidadeService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const hoje = hojeISO();

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Etiquetas teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const loja = async (t: string, nome: string) =>
    (await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
  // `haDias` = há quantos dias foi criada; `vence` = dias até a validade (negativo = já venceu).
  const etiqueta = (t: string, descricao: string, status: string, vence: number, haDias: number, extra: { unidade?: string; apagada?: boolean } = {}) =>
    q(
      `insert into etiqueta_validade (tenant_id, unidade_id, descricao, status, validade, codigo, created_at, deleted_at)
       values ($1, $2, $3, $4, $5, $6, now() - ($7 || ' days')::interval, $8)`,
      [t, extra.unidade ?? null, descricao, status, somarDias(hoje, vence), randomUUID().slice(0, 12), String(haDias), extra.apagada ? new Date() : null],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    servico = new EtiquetaValidadeService(drizzle(pool, { schema }) as any, {} as any, {} as any, {} as any);
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['etiqueta_validade', 'unidade']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('com mais de 300 etiquetas já baixadas, a vencida antiga some da lista sem filtro e aparece na das vivas', async () => {
    const t = await empresa();
    await etiqueta(t, 'Vencida antiga de teste', 'fechado', -3, 10);
    await etiqueta(t, 'Em uso de teste', 'em_uso', 1, 9);
    await q(
      `insert into etiqueta_validade (tenant_id, descricao, status, validade, codigo)
       select $1, 'Baixada de teste ' || n, 'baixado', $2, 'b-' || n from generate_series(1, 305) n`,
      [t, hoje],
    );

    const semFiltro = await servico.listar(t, null);
    expect(semFiltro).toHaveLength(300);
    expect(semFiltro.some((e: any) => e.descricao === 'Vencida antiga de teste')).toBe(false);

    const vivas = await servico.listar(t, null, true);
    expect(vivas.map((e: any) => e.descricao)).toEqual(['Vencida antiga de teste', 'Em uso de teste']);
    expect(vivas[0]).toMatchObject({ vencida: true, diasRestantes: -3 });
    expect(vivas[1]).toMatchObject({ vencida: false, diasRestantes: 1 });
  });

  it('só fechada e em uso são vivas; vem da que vence primeiro para a última; apagada e de outra empresa ficam fora', async () => {
    const t = await empresa();
    const outra = await empresa();
    await etiqueta(t, 'Vence em 5 de teste', 'fechado', 5, 0);
    await etiqueta(t, 'Vence hoje de teste', 'em_uso', 0, 1);
    await etiqueta(t, 'Vencida de teste', 'em_uso', -1, 2);
    for (const status of ['baixado', 'vencido', 'substituida']) await etiqueta(t, `Situação ${status} de teste`, status, 2, 0);
    await etiqueta(t, 'Apagada de teste', 'fechado', 2, 0, { apagada: true });
    await etiqueta(outra, 'De outra empresa', 'fechado', 2, 0);

    const vivas = await servico.listar(t, null, true);
    expect(vivas.map((e: any) => e.descricao)).toEqual(['Vencida de teste', 'Vence hoje de teste', 'Vence em 5 de teste']);
    // sem o filtro continua vindo tudo o que não foi apagado, como sempre foi
    expect(await servico.listar(t, null)).toHaveLength(6);
  });

  it('com a loja escolhida, só as etiquetas dela', async () => {
    const t = await empresa();
    const a = await loja(t, 'Loja A de teste');
    const b = await loja(t, 'Loja B de teste');
    await etiqueta(t, 'Da loja A de teste', 'fechado', 2, 0, { unidade: a });
    await etiqueta(t, 'Da loja B de teste', 'fechado', 1, 0, { unidade: b });

    expect((await servico.listar(t, a, true)).map((e: any) => e.descricao)).toEqual(['Da loja A de teste']);
    expect((await servico.listar(t, null, true)).map((e: any) => e.descricao)).toEqual(['Da loja B de teste', 'Da loja A de teste']);
  });
});
