import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FinanceiroService } from './financeiro.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PAGAR E ESTORNAR A CONTA UMA VEZ SÓ — contra Postgres (TEST_PG_URL). O "Já paguei" do Mister (M3a parte 4) e o botão
// da tela chamam o MESMO `pagar`; dois toques ao mesmo tempo (dois aparelhos, a rede que reenvia, o duplo clique) não
// podem lançar a saída do caixa duas vezes. Idem o estorno: um só lançamento inverso por pagamento. Antes, os dois liam
// "aberto" e gravavam (a leitura vinha antes da troca da situação); agora a troca condicional vem primeiro.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('titulo-pagar-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('pagar e estornar a conta uma vez só (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 12 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const auditados: any[] = [];
  const financeiro = new FinanceiroService(db, { registrar: async (e: any) => void auditados.push(e) } as any, {} as any);
  let ator: string;
  const novaConta = async (o: { recorrencia?: string; descricao?: string } = {}) => {
    const t: any = await financeiro.criar(T, ator, 'presidente', { tipo: 'pagar', descricao: o.descricao ?? 'Boleto · teste', valor: 480, vencimento: '2026-11-30', recorrencia: o.recorrencia } as any);
    return t.id as string;
  };
  const lancamentos = (titulo: string) => q(`select tipo, valor::text as valor from lancamento_caixa where titulo_id = $1 order by created_at, tipo`, [titulo]);
  const situacao = async (titulo: string) => (await q(`select status from titulo_financeiro where id = $1`, [titulo]))[0]?.status;
  const varias = <T>(n: number, f: () => Promise<T>) => Promise.allSettled(Array.from({ length: n }, f));

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste pagar uma vez')`, [T]);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidente', 'presidente') returning id`, [T]);
    [{ id: ator }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Ana', $2) returning id`, [T, funcao]);
    // O pool já com as conexões abertas: senão os pedidos "ao mesmo tempo" saem um por vez (cada um esperando abrir a sua
    // conexão) e a corrida passa por sorte no código antigo (V98).
    await Promise.all(Array.from({ length: 10 }, () => pool.query('select pg_sleep(0.05)')));
  });
  afterAll(async () => {
    for (const t of ['lancamento_caixa', 'titulo_financeiro', 'colaborador', 'funcao']) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('cinco "pagar" ao mesmo tempo: um paga, os outros ouvem "não está aberto" — uma saída só no caixa', async () => {
    const id = await novaConta();
    const r = await varias(5, () => financeiro.pagar(T, ator, 'presidente', id, {} as any));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    for (const x of r.filter((y) => y.status === 'rejected') as PromiseRejectedResult[]) expect(x.reason).toBeInstanceOf(BadRequestException);
    expect(await lancamentos(id)).toEqual([{ tipo: 'saida', valor: '480' }]);
    expect(await situacao(id)).toBe('pago');
  });

  it('cinco "estornar" ao mesmo tempo: um estorna, os outros são recusados — um lançamento inverso só, e a conta volta a aberta', async () => {
    const id = await novaConta();
    await financeiro.pagar(T, ator, 'presidente', id, {} as any);
    const r = await varias(5, () => financeiro.estornar(T, ator, 'presidente', id));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect((await lancamentos(id)).map((l) => l.tipo).sort()).toEqual(['entrada', 'saida']);
    expect(await situacao(id)).toBe('aberto');
    // Paga de novo e estorna de novo: o ciclo segue funcionando (o pagamento novo é o que se estorna).
    await financeiro.pagar(T, ator, 'presidente', id, {} as any);
    await financeiro.estornar(T, ator, 'presidente', id);
    expect((await lancamentos(id)).map((l) => l.tipo).sort()).toEqual(['entrada', 'entrada', 'saida', 'saida']);
    expect(await situacao(id)).toBe('aberto');
    // Estornar a conta em aberto (nada pago agora) é recusado.
    await expect(financeiro.estornar(T, ator, 'presidente', id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a conta recorrente paga duas vezes ao mesmo tempo gera UMA próxima', async () => {
    const id = await novaConta({ recorrencia: 'mensal' });
    await varias(4, () => financeiro.pagar(T, ator, 'presidente', id, {} as any));
    expect(await q(`select vencimento::text as v, status from titulo_financeiro where tenant_id = $1 and descricao = 'Boleto · teste' and id <> $2 and recorrencia = 'mensal'`, [T, id])).toEqual([
      { v: '2026-12-30', status: 'aberto' },
    ]);
  });

  it('pagar, estornar e pagar de novo a conta recorrente não cria a próxima duas vezes (ERR-566)', async () => {
    const id = await novaConta({ recorrencia: 'mensal', descricao: 'Aluguel · teste' });
    await financeiro.pagar(T, ator, 'presidente', id, {} as any);
    await financeiro.estornar(T, ator, 'presidente', id);
    await financeiro.pagar(T, ator, 'presidente', id, {} as any);
    expect(await q(`select vencimento::text as v, status from titulo_financeiro where tenant_id = $1 and descricao = 'Aluguel · teste' and id <> $2`, [T, id])).toEqual([
      { v: '2026-12-30', status: 'aberto' },
    ]);
    expect((await lancamentos(id)).map((l) => l.tipo).sort()).toEqual(['entrada', 'saida', 'saida']);
  });
});
