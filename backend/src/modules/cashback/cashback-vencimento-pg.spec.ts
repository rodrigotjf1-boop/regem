import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

// O VENCIMENTO DO CASHBACK SAI DO EXTRATO (mig 355). O defeito que isto guarda: o crédito feito no servidor da loja
// subia para a nuvem, o gatilho da 274 recalculava o SALDO, mas o vencimento da nuvem ficava o antigo (ou vazio) — o
// saldo de quem acabou de ganhar vencia antes da hora quando o cliente abria o cardápio, e o aviso "vence em…" da
// Onda 3 diria a data errada. Agora o gatilho renova a data no crédito de plano com prazo, também na linha que chega
// pelo sync, sem nunca voltar a data para trás; e a correção de uma vez só estende.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cashback-vencimento-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '355_cashback_vencimento_do_extrato.sql');
const DIA = 86_400_000;

descrever('vencimento do cashback pelo extrato (mig 355)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  let tenant = '';
  let comPrazo = '';
  let semPrazo = '';

  beforeAll(async () => {
    // Só quando falta (banco local antigo): no CI ela já veio pelo apply-all (ERR-351).
    const [{ tem }] = (
      await pool.query(
        `select position('mig 355' in pg_get_functiondef(to_regprocedure(current_schema() || '.cashback_saldo_do_extrato()'))) > 0 as tem`,
      )
    ).rows;
    if (!tem) await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(ARQUIVO, 'utf8'))));
    const e = await pool.query(`insert into empresa (nome) values ('Teste vencimento do cashback') returning id`);
    tenant = e.rows[0].id;
    const p1 = await pool.query(
      `insert into cashback_plano (tenant_id, tipo, ativo, percentual, prazo_resgate_dias) values ($1, 'valor', true, 5, 30) returning id`,
      [tenant],
    );
    comPrazo = p1.rows[0].id;
    const p2 = await pool.query(
      `insert into cashback_plano (tenant_id, tipo, ativo, percentual, prazo_resgate_dias) values ($1, 'valor', false, 5, null) returning id`,
      [tenant],
    );
    semPrazo = p2.rows[0].id;
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  /** Um lançamento; `comoSync` marca a sessão como a do sincronismo (a linha que chega do outro lado). */
  const lancar = async (tel: string, delta: number, origem: string, opts: { plano?: string | null; diasAtras?: number; comoSync?: boolean } = {}) => {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('begin');
      if (opts.comoSync) await c.query(`select set_config('regem.sync', 'on', true)`);
      await c.query(
        `insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem, plano_id, criado_em)
         values ($1, $2, 'valor', $3, $4, $5, now() - make_interval(days => $6::int))`,
        [tenant, tel, String(delta), origem, opts.plano ?? null, opts.diasAtras ?? 0],
      );
      await c.query('commit');
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  const linha = async (tel: string) => {
    const r = await pool.query(
      `select saldo::float8 as saldo, extract(epoch from expira_em) * 1000 as vence from cashback_saldo
        where tenant_id = $1 and telefone = $2 and tipo = 'valor'`,
      [tenant, tel],
    );
    return r.rows[0] as { saldo: number; vence: number | null } | undefined;
  };
  const diasDaqui = (ms: number | null | undefined) => (ms == null ? null : Math.round((Number(ms) - Date.now()) / DIA));

  it('o crédito que chega pelo sync renova a data (data do lançamento + prazo do plano)', async () => {
    const tel = '21988880001';
    await lancar(tel, 4, 'credito', { plano: comPrazo, diasAtras: 5, comoSync: true });
    const l = await linha(tel);
    expect(l?.saldo).toBeCloseTo(4, 2);
    expect(diasDaqui(l?.vence)).toBe(25); // 30 dias depois do crédito de 5 dias atrás
  });

  it('crédito mais novo renova; o velho que chega atrasado não volta a data para trás', async () => {
    const tel = '21988880002';
    await lancar(tel, 3, 'credito', { plano: comPrazo, diasAtras: 10, comoSync: true });
    expect(diasDaqui((await linha(tel))?.vence)).toBe(20);
    await lancar(tel, 2, 'credito', { plano: comPrazo, diasAtras: 1 });
    expect(diasDaqui((await linha(tel))?.vence)).toBe(29);
    await lancar(tel, 5, 'credito', { plano: comPrazo, diasAtras: 20, comoSync: true }); // chegou atrasado
    const l = await linha(tel);
    expect(diasDaqui(l?.vence)).toBe(29);
    expect(l?.saldo).toBeCloseTo(10, 2);
  });

  it('resgate, estorno, expiração e crédito de plano sem prazo não mexem na data', async () => {
    const tel = '21988880003';
    await lancar(tel, 6, 'credito', { plano: comPrazo, diasAtras: 2 });
    const antes = (await linha(tel))?.vence;
    await lancar(tel, -2, 'resgate');
    await lancar(tel, 1, 'estorno_devolucao', { plano: comPrazo }); // devolução não é crédito novo, mesmo ligada ao plano
    await lancar(tel, 3, 'credito', { plano: semPrazo });
    await lancar(tel, 2, 'credito'); // sem plano (ajuste antigo)
    const l = await linha(tel);
    expect(l?.vence).toBe(antes);
    expect(l?.saldo).toBeCloseTo(10, 2);
    // sem crédito de plano com prazo, o saldo novo nasce sem data (como antes)
    const tel2 = '21988880004';
    await lancar(tel2, 3, 'credito', { plano: semPrazo });
    expect((await linha(tel2))?.vence ?? null).toBeNull();
  });

  it('a correção de uma vez estende a data atrasada; sem data e data mais tarde ficam como estão', async () => {
    const atrasada = '21988880005';
    const semData = '21988880006';
    const maisTarde = '21988880007';
    for (const tel of [atrasada, semData, maisTarde]) await lancar(tel, 5, 'credito', { plano: comPrazo, diasAtras: 3 });
    // como a nuvem estava: a data do crédito velho (o novo foi feito na loja), sem data, e uma data mais à frente
    await pool.query(`update cashback_saldo set expira_em = now() - interval '4 days' where tenant_id = $1 and telefone = $2`, [tenant, atrasada]);
    await pool.query(`update cashback_saldo set expira_em = null where tenant_id = $1 and telefone = $2`, [tenant, semData]);
    await pool.query(`update cashback_saldo set expira_em = now() + interval '60 days' where tenant_id = $1 and telefone = $2`, [tenant, maisTarde]);

    // o arquivo inteiro, como na nuvem (de novo se cruzar com o DDL de outra spec — ERR-194)
    const r: any = await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(ARQUIVO, 'utf8'))));
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows as { item: string; estado: string }[];
    expect(conferencia.map((x) => x.estado)).toEqual(['ok', 'ok', 'ok']);

    expect(diasDaqui((await linha(atrasada))?.vence)).toBe(27);
    expect((await linha(semData))?.vence ?? null).toBeNull();
    expect(diasDaqui((await linha(maisTarde))?.vence)).toBe(60);
  });
});
