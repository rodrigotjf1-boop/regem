import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from './estoque.service';
import { ContagemService } from '../contagem/contagem.service';
import { RecebimentoService } from '../recebimento/recebimento.service';
import { FichasService } from '../fichas/fichas.service';
import { DesperdicioService } from '../desperdicio/desperdicio.service';
import { EtiquetaValidadeService } from '../etiqueta-validade/etiqueta-validade.service';
import { hojeISO, somarDias } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ESTOQUE NÃO ANDA DUAS VEZES — contra Postgres (TEST_PG_URL). Achados da revisão do estoque de 25/11/2026 (lote E1):
// dois ajustes para o mesmo saldo contado se somavam (EST-B-01); a saída à mão não baixava o lote (EST-B-02); duas
// contagens da mesma lista lançavam a mesma diferença (EST-E-01); duas notas do mesmo insumo sobrescreviam o custo médio
// uma da outra (EST-D-01) e o lote da nota saía sem loja (EST-D-02); a edição da ficha podia deixá-la sem ingrediente
// (EST-C-01) e aceitava rendimento negativo (EST-C-03); a etiqueta já aberta saía com a validade de fechado (EST-F-03),
// duas aberturas juntas criavam duas substitutas (EST-F-04) e a perda baixava outro lote (EST-F-02). Os testes de corrida
// seguram uma trava pela conexão do teste e esperam as DUAS chamadas presas atrás dela (V72), nunca por tempo.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('estoque-revisao-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('o estoque não anda duas vezes (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 14 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const aud = { registrar: async () => undefined } as any;
  const eventos = new EventEmitter2();
  const estoque = new EstoqueService(db, aud);
  const contagem = new ContagemService(db, eventos, aud);
  const recebimentos = new RecebimentoService(db, aud, eventos);
  const fichas = new FichasService(db, aud);
  const etiquetas = new EtiquetaValidadeService(db, aud, eventos, new DesperdicioService(db));
  let loja: string;

  const novoInsumo = async (nome: string, unidade = 'kg', extra: { custo?: number; diasAberto?: number } = {}) =>
    (
      await q(
        `insert into item_estoque (tenant_id, unidade_id, nome, unidade_medida, custo_medio, validade_aberto_dias)
         values ($1, $2, $3, $4, $5, $6) returning id`,
        [T, loja, nome, unidade, extra.custo ?? 0, extra.diasAberto ?? null],
      )
    )[0].id as string;
  const entrada = (item: string, qtd: number, custo: number | null = null) =>
    q(
      `insert into movimento_estoque (tenant_id, unidade_id, item_id, tipo, quantidade, custo_unitario, motivo, data)
       values ($1, $2, $3, 'entrada', $4, $5, 'teste', $6)`,
      [T, loja, item, qtd, custo, hojeISO()],
    );
  const saldo = async (item: string) =>
    Number(
      (
        await q(
          `select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end), 0) as s
             from movimento_estoque where item_id = $1`,
          [item],
        )
      )[0].s,
    );
  const novoLote = async (item: string, qtd: number, diasParaVencer: number) =>
    (
      await q(
        `insert into lote (tenant_id, item_id, unidade_id, validade, quantidade, entrada) values ($1, $2, $3, $4, $5, $6) returning id`,
        [T, item, loja, somarDias(hojeISO(), diasParaVencer), qtd, hojeISO()],
      )
    )[0].id as string;
  const saldoDoLote = async (lote: string) =>
    Number(
      (
        await q(
          `select l.quantidade - coalesce((select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = l.id), 0) as s
             from lote l where l.id = $1`,
          [lote],
        )
      )[0].s,
    );
  /** Uma conexão do teste com a transação aberta (para segurar a trava) e o número dela no banco. */
  const conexaoComTransacao = async (): Promise<{ c: PoolClient; pid: number }> => {
    const c = await pool.connect();
    await c.query('begin');
    const [{ pid }] = (await c.query('select pg_backend_pid() as pid')).rows;
    return { c, pid };
  };
  /**
   * Espera `quantas` sessões presas atrás da conexão `pid` do teste — direto OU na fila de quem já espera por ela: na
   * mesma linha, a segunda sessão espera a primeira (a trava da tupla), não a conexão do teste. Só a fila que nasce no
   * `pid` do teste conta: no CI os arquivos dividem o banco (V72). `false` se não juntar em ~6 s.
   */
  const esperarPresas = async (pid: number, quantas: number) => {
    for (let i = 0; i < 120; i++) {
      const [{ n }] = await q(
        `with recursive presas(p) as (
           select a.pid from pg_stat_activity a where $1 = any(pg_blocking_pids(a.pid))
           union
           select a.pid from pg_stat_activity a join presas on presas.p = any(pg_blocking_pids(a.pid))
         )
         select count(*)::int as n from presas`,
        [pid],
      );
      if (n >= quantas) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };
  /** Segura `trava` (um SELECT … FOR UPDATE) enquanto `chamadas` começam; solta quando as duas estão presas atrás dela. */
  const comTravaSegurada = async <R>(trava: string, params: any[], chamadas: () => Promise<R>[]) => {
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(trava, params);
      const ps = chamadas();
      ps.forEach((p) => p.catch(() => undefined));
      expect(await esperarPresas(pid, ps.length)).toBe(true);
      await c.query('commit');
      return await Promise.all(ps);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  };

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste estoque revisao')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [T]);
  });
  afterAll(async () => {
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('EST-B-01: dois ajustes ao mesmo tempo para o mesmo saldo contado — o saldo fica no contado e o segundo não lança nada', async () => {
    const item = await novoInsumo('Farinha B01');
    await entrada(item, 10);
    const r: any[] = await comTravaSegurada(`select id from item_estoque where id = $1 for update`, [item], () =>
      [1, 2].map(() => estoque.createMovimento(T, { itemId: item, tipo: 'ajuste', saldoContado: 8, motivo: 'contei' } as any, loja)),
    );
    expect(await saldo(item)).toBe(8);
    expect(r.filter((x) => x?.semMudanca)).toHaveLength(1);
  });

  it('EST-B-02: a saída à mão e o ajuste para menos baixam também o lote', async () => {
    const item = await novoInsumo('Queijo B02');
    await entrada(item, 10);
    const lote = await novoLote(item, 10, 10);
    await estoque.createMovimento(T, { itemId: item, tipo: 'saida', quantidade: 4, motivo: 'consumo' } as any, loja);
    expect(await saldo(item)).toBe(6);
    expect(await saldoDoLote(lote)).toBe(6);
    await estoque.createMovimento(T, { itemId: item, tipo: 'ajuste', saldoContado: 5 } as any, loja);
    expect(await saldoDoLote(lote)).toBe(5);
  });

  const novaLista = async (nome: string, itens: string[]) => {
    const [{ id }] = await q(`insert into contagem_lista (tenant_id, unidade_id, nome) values ($1, $2, $3) returning id`, [T, loja, nome]);
    for (const it of itens) await q(`insert into contagem_lista_item (tenant_id, lista_id, item_id) values ($1, $2, $3)`, [T, id, it]);
    return id as string;
  };

  it('EST-E-01: dois aparelhos que apertam "Contar" na mesma lista no mesmo dia ficam com a MESMA contagem', async () => {
    const item = await novoInsumo('Tomate E01a');
    const lista = await novaLista('Lista E01a', [item]);
    const [a, b] = await Promise.all([1, 2].map(() => contagem.iniciarExecucao(T, lista, null as any, loja)));
    const c = await contagem.iniciarExecucao(T, lista, null as any, loja);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
  });

  it('EST-E-01: duas contagens do mesmo item (listas que se sobrepõem) não lançam a mesma diferença duas vezes', async () => {
    const item = await novoInsumo('Cebola E01b');
    await entrada(item, 10);
    const e1 = await contagem.iniciarExecucao(T, await novaLista('Lista E01b-1', [item]), null as any, loja);
    const e2 = await contagem.iniciarExecucao(T, await novaLista('Lista E01b-2', [item]), null as any, loja);
    const contadoEm = new Date().toISOString(); // as duas contaram 9 no mesmo instante, antes de qualquer ajuste
    const salvar = (exec: string) => contagem.salvarContagem(T, exec, null as any, { aplicarAjuste: true, itens: [{ itemId: item, contado: 9, contadoEm }] } as any);
    await salvar(e1.id);
    await salvar(e2.id);
    expect(await saldo(item)).toBe(9);
  });

  it('EST-D-01: duas notas do mesmo insumo confirmadas juntas — o custo médio pondera as duas (700 ÷ 30)', async () => {
    // SEIS rodadas, cada uma com um insumo: o gatilho do marcador de sync (mig 264) sorteia um de 4 baldes por gravação, e
    // duas entradas que caem no MESMO balde ficam em fila por acaso (aí o código antigo acertava). Em seis rodadas o código
    // sem a trava erra em 99,98% das vezes; o código com a trava acerta sempre.
    const custos: number[] = [];
    for (let rodada = 1; rodada <= 6; rodada++) {
      const item = await novoInsumo(`Óleo D01 ${rodada}`, 'litro', { custo: 10 });
      await entrada(item, 10, 10);
      const nota = async (custo: number) => {
        const [{ id }] = await q(`insert into recebimento (tenant_id, unidade_id, data, status) values ($1, $2, $3, 'rascunho') returning id`, [T, loja, hojeISO()]);
        await q(`insert into recebimento_item (tenant_id, recebimento_id, item_id, qtd_esperada, qtd_recebida, custo_unitario) values ($1, $2, $3, 10, 10, $4)`, [T, id, item, custo]);
        return id as string;
      };
      const notas = [await nota(20), await nota(40)];
      // `for no key update` no teste: sem a trava do código, as duas notas gravam a entrada e LEEM saldo e custo antes de
      // parar (a gravação do custo é que espera) — a corrida do achado; com a trava, as duas param antes de ler.
      await comTravaSegurada(`select id from item_estoque where id = $1 for no key update`, [item], () =>
        notas.map((n) => recebimentos.confirmar(T, null as any, 'gerente', n, loja, { semConta: true })),
      );
      expect(await saldo(item)).toBe(30);
      custos.push((await q(`select custo_medio::float8 as c from item_estoque where id = $1`, [item]))[0].c);
    }
    for (const c of custos) expect(c).toBeCloseTo(700 / 30, 2);
  });

  it('EST-D-02: o lote criado pela nota fica na loja da nota (a mesma do movimento)', async () => {
    const item = await novoInsumo('Leite D02', 'litro');
    const [{ id: nota }] = await q(`insert into recebimento (tenant_id, unidade_id, data, status) values ($1, $2, $3, 'rascunho') returning id`, [T, loja, hojeISO()]);
    await q(
      `insert into recebimento_item (tenant_id, recebimento_id, item_id, qtd_esperada, qtd_recebida, custo_unitario, validade) values ($1, $2, $3, 5, 5, 4, $4)`,
      [T, nota, item, somarDias(hojeISO(), 15)],
    );
    await recebimentos.confirmar(T, null as any, 'gerente', nota, loja, { semConta: true });
    const [l] = await q(`select unidade_id from lote where recebimento_id = $1`, [nota]);
    const [m] = await q(`select unidade_id from movimento_estoque where item_id = $1`, [item]);
    expect(m.unidade_id).toBe(loja);
    expect(l.unidade_id).toBe(loja);
  });

  it('EST-C-01: a edição que falha ao gravar os ingredientes deixa a receita anterior; a criação que falha não deixa ficha', async () => {
    const item = await novoInsumo('Carne C01');
    const f: any = await fichas.create(T, { nome: 'Hambúrguer C01', rendimento: 1, ingredientes: [{ itemId: item, insumoNome: 'Carne', quantidade: 0.15, unidade: 'kg' }] } as any, null);
    // Fator de correção 5.000 não cabe na coluna (numeric 6,3): a gravação das linhas novas falha NO BANCO, depois de conferidas.
    await expect(fichas.update(T, f.id, { nome: 'Hambúrguer C01 novo', ingredientes: [{ itemId: item, insumoNome: 'Carne', quantidade: 0.2, unidade: 'kg', fatorCorrecao: 5000 }] } as any, null)).rejects.toBeDefined();
    expect(await q(`select quantidade::float8 as q from ficha_ingrediente where ficha_id = $1 and deleted_at is null`, [f.id])).toEqual([{ q: 0.15 }]);
    expect((await q(`select nome from ficha_tecnica where id = $1`, [f.id]))[0].nome).toBe('Hambúrguer C01');
    await expect(fichas.create(T, { nome: 'Ficha C01 que falha', ingredientes: [{ itemId: item, insumoNome: 'Carne', quantidade: 0.2, unidade: 'kg', fatorCorrecao: 5000 }] } as any, null)).rejects.toBeDefined();
    expect(await q(`select id from ficha_tecnica where tenant_id = $1 and nome = 'Ficha C01 que falha'`, [T])).toEqual([]);
  });

  it('EST-C-03: rendimento zero, negativo ou que vira zero nas 3 casas é recusado e a ficha fica como estava', async () => {
    const f: any = await fichas.create(T, { nome: 'Molho C03', rendimento: 1 } as any, null);
    for (const r of [0, -1, 0.0001]) await expect(fichas.update(T, f.id, { rendimento: r } as any, null)).rejects.toMatchObject({ status: 400 });
    await expect(fichas.create(T, { nome: 'Molho C03 negativo', rendimento: -2 } as any, null)).rejects.toMatchObject({ status: 400 });
    expect(Number((await q(`select rendimento from ficha_tecnica where id = $1`, [f.id]))[0].rendimento)).toBe(1);
    await fichas.update(T, f.id, { rendimento: 2.5 } as any, null);
    expect(Number((await q(`select rendimento from ficha_tecnica where id = $1`, [f.id]))[0].rendimento)).toBe(2.5);
  });

  it('EST-F-03: a etiqueta que já nasce aberta ("Usado"), de um lote ou de um insumo, vence pelos dias de aberto', async () => {
    const item = await novoInsumo('Creme F03', 'litro', { diasAberto: 2 });
    await q(`update item_estoque set validade = $2 where id = $1`, [item, somarDias(hojeISO(), 30)]);
    const lote = await novoLote(item, 5, 30);
    const doLote: any = await etiquetas.criar(T, null, { loteId: lote, tipoUso: 'usado' }, loja);
    expect(String(doLote.etiquetas[0].validade).slice(0, 10)).toBe(somarDias(hojeISO(), 2));
    const doInsumo: any = await etiquetas.criar(T, null, { itemId: item, tipoUso: 'usado' }, loja);
    expect(String(doInsumo.etiquetas[0].validade).slice(0, 10)).toBe(somarDias(hojeISO(), 2));
    // Fechada continua com a validade do lote.
    const fechada: any = await etiquetas.criar(T, null, { loteId: lote, tipoUso: 'novo' }, loja);
    expect(String(fechada.etiquetas[0].validade).slice(0, 10)).toBe(somarDias(hojeISO(), 30));
  });

  const etiquetaFechada = async (item: string, lote: string | null, codigo: string) =>
    (
      await q(
        `insert into etiqueta_validade (tenant_id, unidade_id, item_id, lote_id, descricao, tipo, status, validade, codigo)
         values ($1, $2, $3, $4, 'Pote', 'novo', 'fechado', $5, $6) returning id`,
        [T, loja, item, lote, somarDias(hojeISO(), 30), codigo],
      )
    )[0].id as string;

  it('EST-F-04: duas aberturas juntas do mesmo pote criam UMA substituta, e ela leva o lote (EST-F-02)', async () => {
    const item = await novoInsumo('Maionese F04', 'kg', { diasAberto: 2 });
    const lote = await novoLote(item, 3, 30);
    const et = await etiquetaFechada(item, lote, '900000000041');
    const r: any[] = await comTravaSegurada(`select id from etiqueta_validade where id = $1 for update`, [et], () =>
      [1, 2].map(() => etiquetas.abrir(T, null, et)),
    );
    const emUso = await q(`select id, lote_id from etiqueta_validade where item_id = $1 and status = 'em_uso'`, [item]);
    expect(emUso).toHaveLength(1);
    expect(emUso[0].lote_id).toBe(lote);
    expect(r.filter((x) => x.reimpresso)).toHaveLength(1);
  });

  it('EST-F-02: a perda da etiqueta do lote B baixa o lote B, mesmo com o lote A vencendo antes', async () => {
    const item = await novoInsumo('Presunto F02');
    await entrada(item, 20);
    const loteA = await novoLote(item, 10, 5);
    const loteB = await novoLote(item, 10, 20);
    const et = await etiquetaFechada(item, loteB, '900000000042');
    await etiquetas.perda(T, null, et, loja, 1);
    expect(await saldoDoLote(loteB)).toBe(9);
    expect(await saldoDoLote(loteA)).toBe(10);
  });
});
