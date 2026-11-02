import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LOJA ESCOLHE NÃO USAR O CÓDIGO DE ENTREGA (mig 348, pedido do dono de 01/11/2026). O código nasce com todo pedido pelo
// valor padrão da coluna; desligado, o gatilho tira o código do pedido NOVO — qualquer caminho que cria pedido, na nuvem
// ou no servidor da loja. O pedido que só está viajando pelo sync (marca `regem.sync`) chega como nasceu, e o que já está
// em andamento não muda. Vale o ajuste da loja do pedido; sem ele, o da empresa.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('codigo-entrega-opcional-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_348 = join(__dirname, '../../../../database/migrations', '348_codigo_de_entrega_opcional.sql');

descrever('código de entrega opcional (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const u = {} as any;
  const cardapio = new CardapioService(db, u, u, u, u, u, u, u, auditoria);
  const empresas: string[] = [];

  beforeAll(async () => {
    // Idempotente: o banco do CI já a tem (apply-all-local); um banco de teste antigo, não. De novo na corrida (ERR-194).
    await repetirNaCorridaDeCatalogo(() => pool.query(readFileSync(MIG_348, 'utf8')));
  });
  beforeEach(() => {
    auditados.length = 0;
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_externo', 'cardapio_config', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste código opcional') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  const ajuste = (t: string, usar: boolean, unidade: string | null = null) =>
    q(`insert into cardapio_config (tenant_id, unidade_id, token, usar_codigo_entrega) values ($1,$2,$3,$4)`, [t, unidade, `tk-${randomUUID()}`, usar]);
  const loja = async (t: string) => (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja teste') returning id`, [t]))[0].id as string;
  /** Um pedido novo, sem dizer o código (o banco sorteia); devolve o código com que ele nasceu. */
  const pedidoNovo = async (t: string, unidade: string | null = null) =>
    (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status)
         values ($1,$2,'cardapio','entrega','[]'::jsonb,30,'novo') returning codigo_entrega`,
        [t, unidade],
      )
    )[0].codigo_entrega as string | null;

  it('padrão (ligado, ou loja sem ajuste): o pedido nasce com o código de 4 dígitos, como sempre', async () => {
    const t = await empresa();
    expect(await pedidoNovo(t)).toMatch(/^\d{4}$/);
    await ajuste(t, true);
    expect(await pedidoNovo(t)).toMatch(/^\d{4}$/);
  });

  it('a loja desligou: o pedido novo nasce sem código; o que já existia segue com o dele', async () => {
    const t = await empresa();
    await ajuste(t, true);
    const antes = (
      await q(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status) values ($1,'cardapio','entrega','[]'::jsonb,30,'despachado') returning id, codigo_entrega`,
        [t],
      )
    )[0];
    await q(`update cardapio_config set usar_codigo_entrega = false where tenant_id = $1`, [t]);
    expect(await pedidoNovo(t)).toBeNull();
    // Mesmo quem manda um código explícito (um caminho que copiasse o de outro pedido) não fura o ajuste.
    const explicito = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, codigo_entrega) values ($1,'cardapio','entrega','[]'::jsonb,30,'novo','1234') returning codigo_entrega`,
      [t],
    );
    expect(explicito[0].codigo_entrega).toBeNull();
    const [depois] = await q(`select codigo_entrega from pedido_externo where id = $1`, [antes.id]);
    expect(depois.codigo_entrega).toBe(antes.codigo_entrega);
  });

  it('o pedido que só está viajando pelo sync (marca regem.sync) chega com o código com que nasceu', async () => {
    const t = await empresa();
    await ajuste(t, false);
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('regem.sync', 'on', true)`);
      const r = await c.query(
        `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, codigo_entrega) values ($1,'cardapio','entrega','[]'::jsonb,30,'despachado','4821') returning codigo_entrega`,
        [t],
      );
      await c.query('commit');
      expect(r.rows[0].codigo_entrega).toBe('4821');
    } finally {
      c.release();
    }
  });

  it('vale o ajuste da loja do pedido; sem linha da loja, o da empresa', async () => {
    const t = await empresa();
    const lojaA = await loja(t);
    const lojaB = await loja(t);
    await ajuste(t, false); // a empresa desligou
    await ajuste(t, true, lojaA); // a loja A religou para ela
    expect(await pedidoNovo(t, lojaA)).toMatch(/^\d{4}$/);
    expect(await pedidoNovo(t, lojaB)).toBeNull(); // a loja B herda o da empresa
    expect(await pedidoNovo(t)).toBeNull();
  });

  it('salvar o ajuste: só sim ou não; ausente mantém; quem mudou fica na auditoria', async () => {
    const t = await empresa();
    await cardapio.setConfig(t, null, { ativo: true }, 'gerente', null);
    let [row] = await q(`select usar_codigo_entrega from cardapio_config where tenant_id = $1`, [t]);
    expect(row.usar_codigo_entrega).toBe(true);
    expect(auditados).toEqual([]);
    await expect(cardapio.setConfig(t, null, { usarCodigoEntrega: 'talvez' }, 'gerente', null)).rejects.toThrow('usarCodigoEntrega');
    const ator = randomUUID();
    const r = await cardapio.setConfig(t, null, { usarCodigoEntrega: false }, 'gerente', ator);
    expect(r.usarCodigoEntrega).toBe(false);
    expect(auditados).toEqual([
      expect.objectContaining({ tenantId: t, atorId: ator, atorPerfil: 'gerente', tipo: 'delivery', acao: 'desligou_codigo_entrega', detalhe: { de: true, para: false } }),
    ]);
    // Salvar outra coisa não mexe no código nem audita de novo.
    await cardapio.setConfig(t, null, { nomePublico: 'Loja X' }, 'gerente', ator);
    [row] = await q(`select usar_codigo_entrega from cardapio_config where tenant_id = $1`, [t]);
    expect(row.usar_codigo_entrega).toBe(false);
    expect(auditados).toHaveLength(1);
    await cardapio.setConfig(t, null, { usarCodigoEntrega: 'true' }, 'gerente', ator);
    expect(auditados[1]).toMatchObject({ acao: 'ligou_codigo_entrega', detalhe: { de: false, para: true } });
  });
});
