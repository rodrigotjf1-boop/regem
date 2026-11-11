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

// A SÉRIE NÃO REPETE ENTRE A NUVEM E O SERVIDOR DA LOJA (auditoria do KDS, 11/11/2026, O13 — achado nº 5 de 20/10).
//
// O contador é de cada máquina (não sincroniza). A série D é numerada pelo servidor da loja (ele aceita os pedidos de
// canal quando está ligado) e pela nuvem (quando ele cai): cada lado com o seu contador, os dois chegavam ao mesmo D-47
// no dia. Os cartões e as vendas sincronizam — o número sai acima do maior já usado no período, nesta loja e origem.
descrever('a senha não repete entre a nuvem e o servidor da loja (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const servico = new ProducaoPedidoService(db, { registrar: async () => {} } as any, { emit: () => undefined } as any);
  let tenant = '';
  const loja = async () => (await pool.query(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [tenant])).rows[0].id as string;
  // Um cartão da cozinha que o sincronismo trouxe do OUTRO lado (com o número que o contador de lá deu).
  const cartaoDoOutroLado = (unidade: string, senha: number, prefixo = PREFIXO_DELIVERY, quando = 'now()') =>
    pool.query(
      `insert into producao_pedido (tenant_id, unidade_id, senha, senha_prefixo, status, criado_em, updated_at)
       values ($1, $2, $3, $4, 'recebido', ${quando}, ${quando})`,
      [tenant, unidade, senha, prefixo],
    );
  const proxima = (unidade: string, prefixo = PREFIXO_DELIVERY) => servico.proximaSenha(db, tenant, unidade, prefixo);

  beforeAll(async () => {
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste senha entre lados') returning id`)).rows[0].id;
  });
  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  it('o outro lado chegou ao D-55 hoje: este, com o contador no 2, continua do 56 — e segue', async () => {
    const u = await loja();
    expect(await proxima(u)).toBe(1);
    expect(await proxima(u)).toBe(2);
    await cartaoDoOutroLado(u, 55);
    expect(await proxima(u)).toBe(56);
    expect(await proxima(u)).toBe(57);
  }, 60000);

  it('a venda sem cartão na cozinha (só bebida) também conta', async () => {
    const u = await loja();
    await pool.query(
      `insert into comanda (id, tenant_id, unidade_id, status, senha, senha_prefixo, total) values ($1,$2,$3,'fechada',30,$4,0)`,
      [randomUUID(), tenant, u, PREFIXO_DELIVERY],
    );
    expect(await proxima(u)).toBe(31);
  }, 60000);

  it('não contam: o dia anterior (período diário), outra origem, outra loja', async () => {
    const u = await loja();
    const outra = await loja();
    await cartaoDoOutroLado(u, 300, PREFIXO_DELIVERY, `now() - interval '25 hours'`);
    await cartaoDoOutroLado(u, 90, PREFIXO_BALCAO);
    await cartaoDoOutroLado(outra, 70);
    expect(await proxima(u)).toBe(1);
  }, 60000);

  it('na virada do dia o contador zera, mas não abaixo do que o outro lado já usou no dia novo', async () => {
    const u = await loja();
    expect(await proxima(u)).toBe(1);
    await pool.query(
      // Data fixa no passado: `current_date` é o dia da SESSÃO (UTC no CI) — depois das 21h seria "amanhã" (ERR-087).
      `update senha_contador set valor = 80, ultimo_reset = '2020-01-01' where tenant_id = $1 and unidade_id = $2 and prefixo = $3`,
      [tenant, u, PREFIXO_DELIVERY],
    );
    await cartaoDoOutroLado(u, 5);
    expect(await proxima(u)).toBe(6);
  }, 60000);

  it("período 'nunca': conta o que o outro lado usou nos últimos dois dias, não o de antes", async () => {
    const u = await loja();
    await pool.query(`insert into kds_cor_config (tenant_id, unidade_id, senha_periodo) values ($1, $2, 'nunca')`, [tenant, u]);
    await cartaoDoOutroLado(u, 900, PREFIXO_DELIVERY, `now() - interval '4 days'`);
    await cartaoDoOutroLado(u, 40, PREFIXO_DELIVERY, `now() - interval '24 hours'`);
    expect(await proxima(u)).toBe(41);
  }, 60000);
});

describe('onde começa o período da senha', () => {
  const inicio = (periodo: string, hoje: string) =>
    (new ProducaoPedidoService({} as any, {} as any, {} as any) as any).inicioDoPeriodoDaSenha(periodo, hoje);

  it('diário: o próprio dia; semanal: a segunda-feira; nunca: dois dias antes', () => {
    expect(inicio('diario', '2026-11-11')).toBe('2026-11-11');
    expect(inicio('semanal', '2026-11-11')).toBe('2026-11-09'); // 11/11/2026 é quarta; a semana começa na segunda, 09/11
    expect(inicio('semanal', '2026-11-09')).toBe('2026-11-09');
    expect(inicio('nunca', '2026-11-01')).toBe('2026-10-30');
  });
});

// ERR-087 — QUANDO O CONTADOR ZERA.
//
// A decisão era tomada comparando a data gravada pelo banco (dia da loja) com
// `new Date().toISOString()` (dia em UTC). Das 21h à meia-noite as duas discordam, e o contador
// concluía "virou o dia" a CADA pedido: toda senha do horário de pico saía 1. Aqui a função é
// exercitada com datas fixas, então o teste vale a qualquer hora do dia em que for rodado — o
// teste antigo, que dependia do relógio, só reprovava depois das 21h.
describe('quando o contador de senha zera', () => {
  const decidir = (periodo: string, ultimoReset: string, hoje: string) =>
    (new ProducaoPedidoService({} as any, {} as any, {} as any) as any).precisaReset(periodo, ultimoReset, hoje);

  it('mesmo dia da operação: NÃO zera (era o caso quebrado depois das 21h)', () => {
    expect(decidir('diario', '2026-09-22', '2026-09-22')).toBe(false);
  });

  it('dia seguinte: zera', () => {
    expect(decidir('diario', '2026-09-22', '2026-09-23')).toBe(true);
  });

  it('semanal: dentro da mesma semana não zera; na semana seguinte zera', () => {
    // 21/09/2026 é SEGUNDA e 27/09 é domingo: a semana vai de 21 a 27 (começa na segunda).
    expect(decidir('semanal', '2026-09-21', '2026-09-27')).toBe(false); // seg → dom, mesma semana
    expect(decidir('semanal', '2026-09-22', '2026-09-27')).toBe(false); // ter → dom, mesma semana
    expect(decidir('semanal', '2026-09-20', '2026-09-21')).toBe(true); // dom → seg, semana nova
    expect(decidir('semanal', '2026-09-22', '2026-09-28')).toBe(true); // segunda seguinte
  });

  it("'nunca' não zera, e data ausente não inventa reset", () => {
    expect(decidir('nunca', '2020-01-01', '2026-09-22')).toBe(false);
    expect(decidir('diario', '', '2026-09-22')).toBe(false);
  });

  it('a data do banco vem como TEXTO — lida como Date, escorregaria um dia', () => {
    // Prova do motivo da mudança: o mesmo instante dá datas diferentes nos dois caminhos.
    const instante = new Date('2026-09-23T02:30:00Z'); // 23h30 de 22/09 em São Paulo
    expect(instante.toISOString().slice(0, 10)).toBe('2026-09-23'); // caminho antigo (UTC)
    expect(instante.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })).toBe('2026-09-22');
  });
});
