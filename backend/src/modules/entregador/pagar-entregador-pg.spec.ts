import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acharEntregador, recusaDoAcerto, resumoDoPagamento, type LinhaDoAcerto } from '../mister/mister-acoes-entregador';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EntregadorService } from './entregador.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { hojeISO } from '../../common/data';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PAGAR O ENTREGADOR NÃO PAGA EM DOBRO (ERR-565, 22/11/2026). O fechamento não tem índice único desde a mig 207 (um período
// pode ter vários acertos): quem impede pagar duas vezes é a marca no pedido. Dois pedidos juntos liam os mesmos pedidos antes
// de qualquer um marcar, e uma falha no meio deixava o fechamento sem a sangria. As tabelas são só da nuvem: o teste aplica as
// três migrations delas (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pagar-entregador-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG = (a: string) => join(__dirname, '../../../../database/migrations', a);

descrever('pagar o entregador (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 8 });
  const db = drizzle(pool, { schema }) as any;
  // No banco dividido do CI, a instrução pode cair em impasse com a migration ou a limpeza de outra spec (ERR-570). Cada uma aqui
  // é sozinha na transação: repetir é seguro.
  const q = async (s: string, p: any[] = []) => (await repetirNaCorridaDeCatalogo(() => pool.query(s, p))).rows;
  const svc = new EntregadorService(db, {} as any, {} as any);
  const empresas: string[] = [];

  beforeAll(async () => {
    for (const a of ['202_entregador_pagamento.sql', '205_entregador_perfil_pagamento.sql', '207_entregador_fechamento_periodo.sql']) {
      await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG(a), 'utf8'))));
    }
  });
  afterAll(async () => {
    if (empresas.length) {
      await pool.query('delete from pedido_externo where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from entregador_fechamento where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from entregador_perfil_pagamento where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from lancamento_caixa where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from caixa_sessao where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from colaborador where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from unidade where tenant_id = any($1::uuid[])', [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** Uma loja com o caixa de entregas aberto e um entregador com 3 entregas de R$ 8 ainda sem acerto. */
  async function montar() {
    const t = (await q(`insert into empresa (nome) values ('teste pagar entregador') returning id`))[0].id as string;
    empresas.push(t);
    const p = (await q(`insert into colaborador (tenant_id, nome) values ($1, 'Moto Um') returning id`, [t]))[0].id as string;
    await q(
      `insert into entregador_perfil_pagamento (tenant_id, colaborador_id, modelo, base_taxa, periodicidade) values ($1, $2, 'so_taxas', 'real', 'dia')`,
      [t, p],
    );
    await q(`insert into caixa_sessao (tenant_id, status, origem) values ($1, 'aberta', 'delivery')`, [t]);
    for (let i = 0; i < 3; i++) {
      await q(
        `insert into pedido_externo (tenant_id, canal, tipo, status, total, taxa_entrega, entregador_id, concluido_em)
         values ($1, 'cardapio', 'entrega', 'concluido', 40, 8, $2, now())`,
        [t, p],
      );
    }
    return { t, p };
  }
  const contas = async (t: string) => ({
    fechamentos: (await q(`select count(*)::int as n from entregador_fechamento where tenant_id = $1`, [t]))[0].n,
    sangrias: (await q(`select count(*)::int as n, coalesce(sum(valor), 0)::float8 as v from lancamento_caixa where tenant_id = $1 and categoria = 'pagamento_entregador'`, [t]))[0],
    semAcerto: (await q(`select count(*)::int as n from pedido_externo where tenant_id = $1 and entregador_fechamento_id is null`, [t]))[0].n,
  });

  it('o Mister lê o acerto e paga por este serviço (etapa 2 de 24/11): as linhas têm o que as conferências dele leem', async () => {
    const { t, p } = await montar();
    // `listarEntregadores` é do DeliveryService: aqui, o entregador da empresa montada.
    const comLista = new EntregadorService(db, { listarEntregadores: async () => [{ id: p, nome: 'Moto Um' }] } as any, {} as any);
    const [l] = (await comLista.fechamentoEntregadores(t)) as LinhaDoAcerto[];
    expect(l).toMatchObject({ colaboradorId: p, nome: 'Moto Um', modelo: 'so_taxas', entregas: 3, diaria: 0, taxas: 2400, total: 2400, turnoAberto: true, pagoNoTurno: false, pagoCentavos: 0 });
    expect(acharEntregador([l], 'moto um')).toEqual({ linha: l });
    expect(recusaDoAcerto(l)).toBeNull();
    const hoje = hojeISO();
    expect(resumoDoPagamento(l)).toBe(
      `Pagar R$ 24,00 a Moto Um (só taxas: 3 entregas de ${hoje.slice(8, 10)}/${hoje.slice(5, 7)}; taxas R$ 24,00). Sai como sangria do caixa de entregas, e essas entregas ficam acertadas.`,
    );
    expect(await comLista.pagarEntregador(t, null, p)).toMatchObject({ ok: true, entregas: 3, total: 2400, fechamentoId: expect.any(String) });
    const [depois] = (await comLista.fechamentoEntregadores(t)) as LinhaDoAcerto[];
    expect(depois).toMatchObject({ entregas: 0, total: 0, pagoNoTurno: true, pagoCentavos: 2400 });
    expect(recusaDoAcerto(depois)).toBe('Moto Um já foi pago neste turno do caixa de entregas (R$ 24,00). Um novo pagamento só no próximo turno.');
  });

  it('paga uma vez: fechamento, sangria e os pedidos marcados; pagar de novo diz que não há nada', async () => {
    const { t, p } = await montar();
    expect(await svc.pagarEntregador(t, null, p)).toMatchObject({ ok: true, entregas: 3, total: 2400 });
    expect(await contas(t)).toEqual({ fechamentos: 1, sangrias: { n: 1, v: 24 }, semAcerto: 0 });
    await expect(svc.pagarEntregador(t, null, p)).rejects.toThrow('Nada a pagar');
    expect((await contas(t)).sangrias.n).toBe(1);
  });

  it('o segundo pagamento espera a trava do entregador e, depois dela, não acha o que pagar', async () => {
    const { t, p } = await montar();
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('select 1 from colaborador where id = $1 for no key update', [p]);
      const eu = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
      const pagando = svc.pagarEntregador(t, null, p);
      pagando.catch(() => undefined);
      let preso = false;
      for (let i = 0; i < 100 && !preso; i++) {
        preso = (await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [eu]))[0].n > 0;
        if (!preso) await new Promise((r) => setTimeout(r, 30));
      }
      expect(preso).toBe(true);
      // Enquanto ele espera, os pedidos são acertados: ele tem de ler DEPOIS da trava.
      await c.query(`update pedido_externo set entregador_fechamento_id = gen_random_uuid() where tenant_id = $1`, [t]);
      await c.query('commit');
      await expect(pagando).rejects.toThrow('Nada a pagar');
      expect((await contas(t)).sangrias.n).toBe(0);
    } finally {
      c.release();
    }
  });

  it('vários cliques juntos pagam uma vez só', async () => {
    const { t, p } = await montar();
    const r = await Promise.allSettled(Array.from({ length: 6 }, () => svc.pagarEntregador(t, null, p)));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(await contas(t)).toEqual({ fechamentos: 1, sangrias: { n: 1, v: 24 }, semAcerto: 0 });
  });

  it('a falha no meio não deixa fechamento sem sangria nem pedido marcado', async () => {
    const { t, p } = await montar();
    const comFalha = Object.create(db);
    comFalha.transaction = (fn: any) =>
      db.transaction((tx: any) => {
        const falso = Object.create(tx);
        falso.execute = (consulta: any) => {
          const texto = JSON.stringify(consulta?.queryChunks ?? '');
          if (texto.includes('insert into lancamento_caixa')) throw new Error('falha na sangria');
          return tx.execute(consulta);
        };
        return fn(falso);
      });
    const quebrado = new EntregadorService(comFalha, {} as any, {} as any);
    await expect(quebrado.pagarEntregador(t, null, p)).rejects.toThrow('falha na sangria');
    expect(await contas(t)).toEqual({ fechamentos: 0, sangrias: { n: 0, v: 0 }, semAcerto: 3 });
  });

  describe('a loja do lançamento', () => {
    const financeiro = new FinanceiroService(db, { registrar: async () => undefined } as any, {} as any);
    const loja = async (t: string, nome: string) => (await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, nome]))[0].id as string;
    const lojaDaSangria = async (t: string) =>
      (await q(`select unidade_id from lancamento_caixa where tenant_id = $1 and categoria = 'pagamento_entregador'`, [t]))[0].unidade_id as string | null;
    const pedidosDaLoja = (t: string, ...lojas: (string | null)[]) =>
      Promise.all(
        lojas.map((l, i) =>
          q(`update pedido_externo set unidade_id = $2 where id = (select id from pedido_externo where tenant_id = $1 order by id offset $3 limit 1)`, [t, l, i]),
        ),
      );
    const saidasDaDre = async (t: string, l: string | null) => {
      const hoje = hojeISO();
      const dre: any = await financeiro.dreCaixa(t, hoje, hoje, l);
      return dre.despesas.find((d: any) => d.categoria === 'pagamento_entregador')?.valor ?? 0;
    };

    it('a sessão com loja: grava a loja da sessão, mesmo com pedido de outra', async () => {
      const { t, p } = await montar();
      const [a, b] = [await loja(t, 'Loja A'), await loja(t, 'Loja B')];
      await q(`update caixa_sessao set unidade_id = $2 where tenant_id = $1`, [t, a]);
      await pedidosDaLoja(t, b, b, b);
      await svc.pagarEntregador(t, null, p);
      expect(await lojaDaSangria(t)).toBe(a);
    });

    it('a sessão sem loja (como o caixa de entregas nasce): vale a loja dos pedidos, e o relatório da loja passa a contar', async () => {
      const { t, p } = await montar();
      const [a, b] = [await loja(t, 'Loja A'), await loja(t, 'Loja B')];
      await pedidosDaLoja(t, a, a, a);
      await svc.pagarEntregador(t, null, p);
      expect(await lojaDaSangria(t)).toBe(a);
      expect(await saidasDaDre(t, a)).toBe(24);
      expect(await saidasDaDre(t, b)).toBe(0);
      expect(await saidasDaDre(t, null)).toBe(24); // em "todas", uma vez só
    });

    it('a sessão sem loja e pedidos de duas lojas: fica sem loja, sem atribuir por palpite, e segue em "todas"', async () => {
      const { t, p } = await montar();
      const [a, b] = [await loja(t, 'Loja A'), await loja(t, 'Loja B')];
      await pedidosDaLoja(t, a, a, b);
      await svc.pagarEntregador(t, null, p);
      expect(await lojaDaSangria(t)).toBeNull();
      expect(await saidasDaDre(t, a)).toBe(0);
      expect(await saidasDaDre(t, null)).toBe(24);
    });

    it('a sessão e os pedidos sem loja (empresa de uma loja antiga): fica sem loja, como sempre', async () => {
      const { t, p } = await montar();
      await svc.pagarEntregador(t, null, p);
      expect(await lojaDaSangria(t)).toBeNull();
      expect(await saidasDaDre(t, null)).toBe(24);
    });
  });

  it('sem o caixa de entregas aberto não paga', async () => {
    const { t, p } = await montar();
    await q(`update caixa_sessao set status = 'fechada' where tenant_id = $1`, [t]);
    await expect(svc.pagarEntregador(t, null, p)).rejects.toThrow('Abra o caixa de entregas');
    expect(await contas(t)).toEqual({ fechamentos: 0, sangrias: { n: 0, v: 0 }, semAcerto: 3 });
  });
});
