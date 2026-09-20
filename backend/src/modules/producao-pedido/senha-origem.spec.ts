import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProducaoPedidoService } from './producao-pedido.service';
import { PREFIXO_BALCAO, PREFIXO_DELIVERY, rotuloSenha } from '../../common/senha-origem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SENHA POR ORIGEM (mig 275).
//
// O defeito: a senha era UM contador por loja. Quando a internet da loja cai, os dois
// lados seguem atendendo — o PDV local no balcão e a NUVEM no delivery, que assume a loja
// depois de 3 minutos sem sinal — e cada um incrementa o seu contador até baterem no mesmo
// número. Duas senhas 47 no mesmo dia, uma em cada balcão de entrega.
//
// A correção não é trava nem coordenação (que a queda de internet quebra justamente quando
// é necessária): cada origem numera a PRÓPRIA sequência. Estes testes provam que as duas
// sequências andam sozinhas e não se encostam.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('senha-origem.spec: sem TEST_PG_URL — PULADO');

describe('rótulo da senha', () => {
  it('escreve com a origem na frente', () => {
    expect(rotuloSenha(12, PREFIXO_BALCAO)).toBe('B-12');
    expect(rotuloSenha(7, PREFIXO_DELIVERY)).toBe('D-7');
  });

  it('pedido antigo (sem origem) continua só com o número', () => {
    expect(rotuloSenha(47, null)).toBe('47');
    expect(rotuloSenha(47, '')).toBe('47');
  });

  it('sem senha não escreve nada', () => {
    expect(rotuloSenha(null, PREFIXO_BALCAO)).toBe('');
    expect(rotuloSenha(undefined, PREFIXO_DELIVERY)).toBe('');
  });
});

descrever('contador por origem, contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new ProducaoPedidoService(db, { registrar: async () => {} } as any, { emit: () => undefined } as any);
  let tenant = '';
  let unidade = '';

  beforeAll(async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste senha') returning id`);
    tenant = e.rows[0].id;
    const u = await pool.query(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [tenant]);
    unidade = u.rows[0].id;
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  const proxima = (prefixo: string) => servico.proximaSenha(db, tenant, unidade, prefixo);

  it('balcão e delivery têm sequências independentes — nunca se encostam', async () => {
    expect(await proxima(PREFIXO_BALCAO)).toBe(1);
    expect(await proxima(PREFIXO_BALCAO)).toBe(2);
    // O delivery começa do 1 mesmo com o balcão no 2: é outra sequência.
    expect(await proxima(PREFIXO_DELIVERY)).toBe(1);
    expect(await proxima(PREFIXO_BALCAO)).toBe(3);
    expect(await proxima(PREFIXO_DELIVERY)).toBe(2);
  }, 60000);

  it('o número repete entre origens, e é por isso que o prefixo faz parte da senha', async () => {
    const r = await pool.query(
      `select prefixo, valor from senha_contador where tenant_id = $1 order by prefixo`,
      [tenant],
    );
    const porPrefixo = Object.fromEntries(r.rows.map((x: any) => [x.prefixo, Number(x.valor)]));
    expect(porPrefixo[PREFIXO_BALCAO]).toBe(3);
    expect(porPrefixo[PREFIXO_DELIVERY]).toBe(2);
    // Sem o prefixo, "2" seria ambíguo — com ele, B-2 e D-2 são pedidos diferentes.
    expect(rotuloSenha(2, PREFIXO_BALCAO)).not.toBe(rotuloSenha(2, PREFIXO_DELIVERY));
  }, 60000);

  it('duas vendas ao mesmo tempo na MESMA origem não repetem número', async () => {
    // A trava por linha (`for update`) continua valendo dentro de cada sequência: é o que
    // impede dois caixas do mesmo balcão de emitirem a mesma senha.
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        pool.connect().then(async (c) => {
          try {
            await c.query('begin');
            const tx = drizzle(c as any) as any;
            const n = await servico.proximaSenha(tx, tenant, unidade, PREFIXO_BALCAO);
            await c.query('commit');
            return n;
          } finally {
            c.release();
          }
        }),
      ),
    );
    expect(new Set(ids).size).toBe(ids.length);
  }, 90000);

  it('outra loja da mesma empresa tem a própria contagem', async () => {
    const u2 = await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Filial') returning id`, [tenant]);
    const n = await servico.proximaSenha(db, tenant, u2.rows[0].id, PREFIXO_BALCAO);
    expect(n).toBe(1);
  }, 60000);

  it('a comanda guarda de onde veio a senha', async () => {
    const id = randomUUID();
    await pool.query(
      `insert into comanda (id, tenant_id, unidade_id, status, senha, senha_prefixo, total)
       values ($1,$2,$3,'fechada',9,$4,0)`,
      [id, tenant, unidade, PREFIXO_DELIVERY],
    );
    const r = await pool.query('select senha, senha_prefixo from comanda where id = $1', [id]);
    expect(rotuloSenha(r.rows[0].senha, r.rows[0].senha_prefixo)).toBe('D-9');
  }, 60000);
});
