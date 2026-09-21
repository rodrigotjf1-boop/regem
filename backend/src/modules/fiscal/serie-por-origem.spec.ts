import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { FiscalService } from './fiscal.service';
import { idFiscalSerie } from '../../common/id-deterministico';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SÉRIE FISCAL POR ORIGEM (mig 278).
//
// O defeito: existia UM contador (`fiscal_config.proximo_numero`) para a loja e para a
// nuvem. Com o link da loja caído os dois lados seguem vendendo — o PDV local no balcão e
// a nuvem no delivery — e cada um anda a MESMA sequência às cegas. Duas notas com o mesmo
// número é a mesma CHAVE DE ACESSO: a SEFAZ rejeita por duplicidade e a venda fica sem
// documento.
//
// A correção não é trava nem coordenação (que a queda de internet quebra justamente quando
// seria necessária): cada ORIGEM numera a própria série, o que o Ajuste SINIEF 19/16
// (cl. 4ª, §1º) permite expressamente e não exige comunicar ao Fisco.
//
// Estes testes provam as quatro coisas que sustentam isso: as séries andam sozinhas, o
// contador não volta atrás depois de um banco novo, o banco barra número repetido, e
// ninguém consegue configurar as duas origens na mesma série.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('serie-por-origem.spec: sem TEST_PG_URL — PULADO');

descrever('numeração por origem, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new FiscalService(db, { registrar: async () => {} } as any);
  const reservar = (unidade: string | null, tenant: string) =>
    (servico as any).reservarNumero(db, tenant, unidade);

  let tenant = '';
  let unidade = '';
  const edgeOriginal = process.env.EDGE_MODE;

  const comoLoja = () => (process.env.EDGE_MODE = 'true');
  const comoNuvem = () => delete process.env.EDGE_MODE;

  beforeAll(async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste serie') returning id`);
    tenant = e.rows[0].id;
    const u = await pool.query(
      `insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`,
      [tenant],
    );
    unidade = u.rows[0].id;
    await pool.query(
      `insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, serie, serie_nuvem,
         cnpj, razao_social, ie, uf, codigo_uf, codigo_municipio, municipio, endereco, bairro, numero,
         csc_id, csc_token, url_qrcode_homolog)
       values ($1,$2,true,'2',1,2,'12345678000195','Bar do Teste','123','SP',35,3550308,'Sao Paulo',
               'Rua A','Centro','100','000001','CSC','https://homologacao.example/qrcode')`,
      [tenant, unidade],
    );
  });

  afterAll(async () => {
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('cada origem tem a SUA série e o SEU contador — um não anda o do outro', async () => {
    comoNuvem();
    const n1 = await reservar(unidade, tenant);
    const n2 = await reservar(unidade, tenant);
    expect(n1.serie).toBe(2);
    expect([n1.numero, n2.numero]).toEqual([1, 2]);

    // A loja começa do 1 na série DELA — não continua a sequência da nuvem.
    comoLoja();
    const l1 = await reservar(unidade, tenant);
    expect(l1.serie).toBe(1);
    expect(l1.numero).toBe(1);

    // E a nuvem segue de onde parou, sem enxergar a loja.
    comoNuvem();
    expect((await reservar(unidade, tenant)).numero).toBe(3);
  }, 60000);

  it('a linha do contador nasce com o id da CHAVE DE NEGÓCIO (as duas pontas, uma linha só)', async () => {
    const r = await pool.query(
      `select id, origem, serie from fiscal_serie where tenant_id = $1 order by origem`,
      [tenant],
    );
    expect(r.rows.map((x: any) => x.origem)).toEqual(['loja', 'nuvem']);
    expect(r.rows[0].id).toBe(idFiscalSerie(tenant, unidade, 'loja'));
    expect(r.rows[1].id).toBe(idFiscalSerie(tenant, unidade, 'nuvem'));
  }, 60000);

  it('banco novo NÃO faz o número voltar atrás (recupera pelo maior já emitido)', async () => {
    comoLoja();
    // Simula a reinstalação: as notas voltam da nuvem, o contador não.
    await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status, valor_total)
       values ($1,$2,'65',1,500,'2','autorizada','10.00')`,
      [tenant, unidade],
    );
    await pool.query(
      `update fiscal_serie set proximo_numero = 1 where tenant_id = $1 and origem = 'loja'`,
      [tenant],
    );
    const r = await reservar(unidade, tenant);
    expect(r.numero).toBe(501); // e não 1, que repetiria chave de acesso
  }, 60000);

  it('o banco barra duas notas com o mesmo número na mesma série', async () => {
    await pool.query(
      `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status, valor_total)
       values ($1,$2,'65',9,77,'2','autorizada','10.00')`,
      [tenant, unidade],
    );
    await expect(
      pool.query(
        `insert into nota_fiscal (tenant_id, unidade_id, modelo, serie, numero, ambiente, status, valor_total)
         values ($1,$2,'65',9,77,'2','autorizada','10.00')`,
        [tenant, unidade],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  }, 60000);

  it('série trocada na configuração recomeça a numeração daquela série', async () => {
    comoNuvem();
    await pool.query(`update fiscal_config set serie_nuvem = 7 where tenant_id = $1`, [tenant]);
    const r = await reservar(unidade, tenant);
    expect(r.serie).toBe(7);
    expect(r.numero).toBe(1); // o contador da série 2 não vale para a série 7
    await pool.query(`update fiscal_config set serie_nuvem = 2 where tenant_id = $1`, [tenant]);
  }, 60000);

  it('as duas origens na MESMA série são recusadas na configuração', async () => {
    await expect(
      servico.setConfig(tenant, unidade, { serie: 4, serieNuvem: 4 }),
    ).rejects.toThrow(/diferentes/i);
    // Mandar só um dos dois campos também colide com o que já está gravado.
    await expect(servico.setConfig(tenant, unidade, { serieNuvem: 1 })).rejects.toThrow(
      /diferentes/i,
    );
    // Série 0 é vedada (texto nacional a reserva a "série única"; ES e AL a proíbem).
    await expect(servico.setConfig(tenant, unidade, { serie: 0 })).rejects.toThrow(/1 a 999/);
  }, 60000);

  it('emissão desativada ou configuração ausente não reserva número', async () => {
    await pool.query(`update fiscal_config set ativo = false where tenant_id = $1`, [tenant]);
    await expect(reservar(unidade, tenant)).rejects.toThrow(/desativada/i);
    await expect(reservar(null, tenant)).rejects.toThrow(/Configure o fiscal/i);
    await pool.query(`update fiscal_config set ativo = true where tenant_id = $1`, [tenant]);
  }, 60000);
});
