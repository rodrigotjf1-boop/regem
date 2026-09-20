import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { CashbackService } from '../cashback/cashback.service';

// CASHBACK E FIDELIDADE — O SALDO É RECALCULADO DO EXTRATO (mig 274).
//
// O defeito que isto guarda: o crédito de cashback acontece nos DOIS lados (o painel de
// delivery roda no servidor local) e o gasto só na nuvem. Nada disso sincronizava — o
// cliente ganhava um cashback que não conseguia gastar, o estorno de um pedido cancelado
// na loja nunca chegava, e o prêmio usado de um lado continuava disponível no outro.
//
// A correção não foi "sincronizar o saldo": número sincronizado por última-escrita-vence
// faz um crédito apagar o outro (dois lados creditam 5 e 8, o saldo vira 8). O que
// sincroniza é o EXTRATO, que só anexa; o saldo virou cache recalculado por gatilho —
// inclusive quando a linha chega pelo sync, que é o caso testado aqui.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('dinheiro-do-cliente.spec: sem TEST_PG_URL — PULADO');

descrever('saldo de cashback e pontos de fidelidade vêm do extrato', () => {
  const pool = new Pool({ connectionString: URL_PG });
  let tenant = '';
  const tel = '21999990001';

  beforeAll(async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste dinheiro') returning id`);
    tenant = e.rows[0].id;
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  const saldo = async (tipo = 'valor') => {
    const r = await pool.query(
      'select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = $3',
      [tenant, tel, tipo],
    );
    return r.rows.length ? Number(r.rows[0].saldo) : null;
  };

  const movimento = async (delta: number, origem: string, comoSync = false) => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      // `comoSync` reproduz a linha CHEGANDO pelo sincronismo: a sessão é marcada, que é o
      // que desliga o carimbo automático. O recálculo do saldo NÃO pode depender disso.
      if (comoSync) await c.query(`select set_config('regem.sync', 'on', true)`);
      await c.query(
        `insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem)
         values ($1, $2, 'valor', $3, $4)`,
        [tenant, tel, String(delta), origem],
      );
      await c.query('commit');
    } finally {
      c.release();
    }
  };

  it('crédito na loja aparece no saldo (era o cashback que o cliente nunca conseguia gastar)', async () => {
    await movimento(10, 'credito');
    expect(await saldo()).toBe(10);
  });

  it('dois créditos somam — nenhum apaga o outro', async () => {
    await movimento(8, 'credito');
    expect(await saldo()).toBe(18);
  });

  it('crédito que CHEGA PELO SYNC também entra na conta', async () => {
    await movimento(5, 'credito', true);
    expect(await saldo()).toBe(23);
  });

  it('resgate abate', async () => {
    await movimento(-3, 'resgate');
    expect(await saldo()).toBe(20);
  });

  it('estorno de pedido cancelado devolve (é o que não chegava à nuvem)', async () => {
    await movimento(-20, 'estorno');
    expect(await saldo()).toBe(0);
  });

  it('saldo nunca fica negativo', async () => {
    await movimento(-5, 'resgate');
    expect(await saldo()).toBe(0);
  });

  it('o SERVIÇO credita uma vez só (o gatilho soma; o serviço não pode somar de novo)', async () => {
    // Regressão do risco introduzido junto com o gatilho: o serviço lia o saldo DEPOIS do
    // gatilho já ter somado e somava o delta outra vez — R$ 10 viravam R$ 20.
    const tel2 = '21999990002';
    await pool.query(
      `insert into cashback_plano (tenant_id, tipo, ativo, status, percentual, base)
       values ($1, 'valor', true, 'ativo', 10, 'total')`,
      [tenant],
    );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const servico = new CashbackService(drizzle(pool) as any);
    await servico.creditarPedido(tenant, { telefone: tel2, pedidoId: crypto.randomUUID(), total: 100 });
    const r = await pool.query(
      `select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`,
      [tenant, tel2],
    );
    expect(Number(r.rows[0].saldo)).toBe(10); // 10% de 100 — uma vez só
  }, 60000);

  it('o prêmio sai NA meta, não um ponto antes (o gatilho já somou quando o serviço lê)', async () => {
    const { FidelidadeService } = await import('../fidelidade/fidelidade.service');
    const tel3 = '21999990003';
    const p = await pool.query(
      `insert into fidelidade_plano (tenant_id, nome, pontos_meta, ativo, status, qualificador_tipo)
       values ($1, 'Meta 3', 3, true, 'ativo', 'qualquer') returning id`,
      [tenant],
    );
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    const servico = new FidelidadeService(drizzle(pool) as any);
    const premios: number[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await servico.pontuarPedido(tenant, {
        telefone: tel3,
        pedidoId: crypto.randomUUID(),
        produtoIds: [],
      } as never, 0); // intervalo anti-abuso desligado no teste
      premios.push(r.premios.length);
    }
    // Prêmio só no 3º pedido (a meta), e a cartela volta a zero.
    expect(premios).toEqual([0, 0, 1]);
    const saldoFinal = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [p.rows[0].id, tel3],
    );
    expect(Number(saldoFinal.rows[0].pontos)).toBe(0);
  }, 60000);

  // A correção de uma vez (bloco 4b da mig 274), rodada com o SQL REAL do arquivo.
  // Cenário reproduzido da produção (20/09/2026): o cliente resgatou R$ 3,40 num pedido e,
  // 4 ms depois, ganhou R$ 3,06 pelo mesmo pedido; as duas gravações se atropelaram e a do
  // resgate apagou o crédito. O extrato tinha as três linhas certas; o saldo, não.
  it('a correção de uma vez conserta o saldo atropelado e preserva o ajuste manual de pontos', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const arquivo = readFileSync(
      join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '274_paridade_cashback_fidelidade.sql'),
      'utf8',
    );
    // Recorta a partir do `--` do cabeçalho: cortar no meio do comentário deixaria um
    // traço solto e o Postgres recusaria o bloco inteiro.
    const bloco = arquivo.slice(arquivo.indexOf('-- ── 4b)'), arquivo.indexOf('-- ── 5) Marcador'));
    expect(bloco.length).toBeGreaterThan(500); // guarda contra o marcador sumir

    // 1) Cashback: extrato certo, saldo atropelado.
    const tel4 = '21999990004';
    for (const [d, o] of [[3.4, 'credito'], [-3.4, 'resgate'], [3.06, 'credito']] as [number, string][]) {
      await pool.query(
        `insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem) values ($1,$2,'valor',$3,$4)`,
        [tenant, tel4, String(d), o],
      );
    }
    await pool.query(
      `update cashback_saldo set saldo = 0 where tenant_id = $1 and telefone = $2 and tipo = 'valor'`,
      [tenant, tel4],
    );

    // 2) Fidelidade: pontos que NÃO saem do extrato (o ajuste manual antigo não deixava rastro).
    const pl = await pool.query(
      `insert into fidelidade_plano (tenant_id, nome, pontos_meta) values ($1,'Ajuste antigo',5) returning id`,
      [tenant],
    );
    const plano = pl.rows[0].id;
    const tel5 = '21999990005';
    await pool.query(
      `insert into fidelidade_cliente (tenant_id, plano_id, telefone, pontos) values ($1,$2,$3,4)`,
      [tenant, plano, tel5],
    );

    await pool.query(bloco);

    const saldoCorrigido = await pool.query(
      `select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`,
      [tenant, tel4],
    );
    expect(Number(saldoCorrigido.rows[0].saldo)).toBeCloseTo(3.06, 2); // o crédito perdido volta

    const ajuste = await pool.query(
      `select delta, motivo from fidelidade_ajuste where plano_id = $1 and telefone = $2`,
      [plano, tel5],
    );
    expect(ajuste.rows).toHaveLength(1);
    expect(Number(ajuste.rows[0].delta)).toBe(4); // virou lançamento de abertura
    const pontos = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [plano, tel5],
    );
    expect(Number(pontos.rows[0].pontos)).toBe(4); // e o número do cliente não mudou

    // Rodar de novo não duplica o lançamento de abertura.
    await pool.query(bloco);
    const denovo = await pool.query(
      `select count(*)::int as n from fidelidade_ajuste where plano_id = $1 and telefone = $2`,
      [plano, tel5],
    );
    expect(denovo.rows[0].n).toBe(1);
  }, 90000);

  it('fidelidade: pontos = ganhos − (meta × prêmios), e o prêmio zera a cartela', async () => {
    const p = await pool.query(
      `insert into fidelidade_plano (tenant_id, nome, pontos_meta) values ($1, 'Cartela', 3) returning id`,
      [tenant],
    );
    const plano = p.rows[0].id;
    for (let i = 0; i < 3; i++) {
      await pool.query(
        `insert into fidelidade_ponto (tenant_id, plano_id, telefone, pedido_id) values ($1, $2, $3, gen_random_uuid())`,
        [tenant, plano, tel],
      );
    }
    const antes = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [plano, tel],
    );
    expect(Number(antes.rows[0].pontos)).toBe(3);

    // Bateu a meta → vira prêmio, e a cartela recomeça.
    await pool.query(
      `insert into fidelidade_resgate (tenant_id, plano_id, telefone, status) values ($1, $2, $3, 'disponivel')`,
      [tenant, plano, tel],
    );
    const depois = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [plano, tel],
    );
    expect(Number(depois.rows[0].pontos)).toBe(0);

    // Pedido cancelado: o ponto é estornado e some da conta, inclusive vindo pelo sync.
    await pool.query(
      `insert into fidelidade_ponto (tenant_id, plano_id, telefone, pedido_id) values ($1, $2, $3, gen_random_uuid())`,
      [tenant, plano, tel],
    );
    const comExtra = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [plano, tel],
    );
    expect(Number(comExtra.rows[0].pontos)).toBe(1);

    await pool.query(
      `update fidelidade_ponto set estornado = true
        where plano_id = $1 and telefone = $2 and estornado = false and id = (
          select id from fidelidade_ponto where plano_id = $1 and telefone = $2 and estornado = false
           order by criado_em desc limit 1)`,
      [plano, tel],
    );
    const estornado = await pool.query(
      'select pontos from fidelidade_cliente where plano_id = $1 and telefone = $2',
      [plano, tel],
    );
    expect(Number(estornado.rows[0].pontos)).toBe(0);
  }, 60000);
});
