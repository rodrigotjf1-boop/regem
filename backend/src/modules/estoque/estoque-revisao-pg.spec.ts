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
import { ProducaoService } from '../producao/producao.service';
import { ProdutoService } from '../produto/produto.service';

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

  // ── Lote E2 (unidades, produção, exclusão e indicadores) ─────────────────────────────────────────────────────────────

  /** Uma empresa só para o teste: o CMV e o fechamento somam a empresa inteira. */
  const empresaSo = async (lojas = 1) => {
    const t2 = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'teste estoque e2')`, [t2]);
    const ids: string[] = [];
    for (let i = 0; i < lojas; i++) ids.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t2, `Loja ${i + 1}`]))[0].id);
    return { t2, lojas: ids };
  };

  it('EST-A-01: a unidade principal não muda em produto com movimento; a mesma unidade em outra grafia e o produto sem histórico mudam', async () => {
    const comHist = await novoInsumo('Farinha A01');
    await entrada(comHist, 10, 20);
    await expect(estoque.updateItem(T, comHist, { unidadeMedida: 'grama' } as any, loja)).rejects.toMatchObject({ status: 409 });
    expect((await q(`select unidade_medida from item_estoque where id = $1`, [comHist]))[0].unidade_medida).toBe('kg');
    await estoque.updateItem(T, comHist, { unidadeMedida: 'KG' } as any, loja); // a mesma unidade, outra grafia
    const semHist = await novoInsumo('Açúcar A01');
    await estoque.updateItem(T, semHist, { unidadeMedida: 'grama' } as any, loja);
    expect((await q(`select unidade_medida from item_estoque where id = $1`, [semHist]))[0].unidade_medida).toBe('grama');
  });

  it('EST-F-01: a produção não dá entrada no produto contado em outra unidade que a do rendimento da ficha', async () => {
    const carne = await novoInsumo('Carne F01', 'kg', { custo: 20 });
    await entrada(carne, 5, 20);
    const emGrama = await novoInsumo('Molho pronto F01 g', 'grama');
    const emKg = await novoInsumo('Molho pronto F01 kg', 'kg');
    const ficha: any = await fichas.create(T, { nome: 'Molho F01', rendimento: 1, rendimentoUnidade: 'kg', ingredientes: [{ itemId: carne, insumoNome: 'Carne', quantidade: 1, unidade: 'kg' }] } as any, null);
    const producao = new ProducaoService(db, aud);
    await expect(producao.produzir(T, null as any, 'gerente', { fichaId: ficha.id, quantidade: 1, itemSaidaId: emGrama } as any, undefined, loja)).rejects.toMatchObject({ status: 400 });
    expect(await saldo(carne)).toBe(5); // nada baixou
    expect(await saldo(emGrama)).toBe(0);
    await producao.produzir(T, null as any, 'gerente', { fichaId: ficha.id, quantidade: 1, itemSaidaId: emKg } as any, undefined, loja);
    expect(await saldo(emKg)).toBe(1);
    expect(await saldo(carne)).toBe(4);
  });

  it('EST-D-03: produto num pedido de compra em aberto não é excluído', async () => {
    const item = await novoInsumo('Óleo D03');
    const [{ id: lista }] = await q(`insert into compra_lista (tenant_id, unidade_id, nome, status) values ($1, $2, 'Compra D03', 'aberta') returning id`, [T, loja]);
    await q(`insert into compra_item (tenant_id, lista_id, item_id, quantidade) values ($1, $2, $3, 5)`, [T, lista, item]);
    const exame: any = await estoque.exclusaoDoItem(T, item, null);
    expect(exame.pode).toBe(false);
    expect(exame.motivos.join(' ')).toMatch(/pedido de compra em aberto/);
    await expect(estoque.removerItem(T, item, null)).rejects.toMatchObject({ status: 409 });
    await q(`update compra_lista set status = 'cancelada' where id = $1`, [lista]);
    expect(((await estoque.exclusaoDoItem(T, item, null)) as any).pode).toBe(true);
  });

  it('EST-G-01: o fechamento final de R$ 0 é um fechamento — não vira o estoque de hoje', async () => {
    const { t2, lojas } = await empresaSo();
    const [{ id: item }] = await q(`insert into item_estoque (tenant_id, unidade_id, nome, unidade_medida, custo_medio) values ($1, $2, 'Queijo G01', 'kg', 10) returning id`, [t2, lojas[0]]);
    await q(
      `insert into estoque_snapshot (tenant_id, unidade_id, item_id, data, saldo, custo_medio) values ($1, $2, $3, '2026-09-30', 10, 10), ($1, $2, $3, '2026-10-31', 0, 10)`,
      [t2, lojas[0], item],
    );
    // Reposição DEPOIS do mês: hoje há R$ 60 em estoque.
    await q(`insert into movimento_estoque (tenant_id, unidade_id, item_id, tipo, quantidade, custo_unitario, motivo, data) values ($1, $2, $3, 'entrada', 6, 10, 'teste', $4)`, [t2, lojas[0], item, hojeISO()]);
    const r: any = await estoque.cmvReal(t2, '2026-10-01', '2026-10-31', null);
    expect(r).toMatchObject({ estoqueInicial: 100, estoqueFinal: 0, efFonte: 'snapshot', cmvReal: 100, semSnapshotInicial: false });
  });

  it('EST-G-02: a carne produzida e vendida conta o custo UMA vez no CMV teórico', async () => {
    const { t2, lojas } = await empresaSo();
    const [{ id: carne }] = await q(`insert into item_estoque (tenant_id, unidade_id, nome, unidade_medida, custo_medio) values ($1, $2, 'Carne G02', 'kg', 20) returning id`, [t2, lojas[0]]);
    const [{ id: pronto }] = await q(`insert into item_estoque (tenant_id, unidade_id, nome, unidade_medida, custo_medio) values ($1, $2, 'Hambúrguer G02', 'unidade', 20) returning id`, [t2, lojas[0]]);
    const ref = randomUUID();
    const mov = (item: string, tipo: string, motivo: string, refTipo: string | null, refId: string | null) =>
      q(`insert into movimento_estoque (tenant_id, unidade_id, item_id, tipo, quantidade, custo_unitario, motivo, ref_tipo, ref_id, data) values ($1, $2, $3, $4, 1, 20, $5, $6, $7, '2026-10-10')`, [
        t2, lojas[0], item, tipo, motivo, refTipo, refId,
      ]);
    await mov(carne, 'saida', 'producao', 'producao', ref);
    await mov(pronto, 'entrada', 'producao', 'producao', ref);
    await mov(pronto, 'saida', 'venda', 'venda_teste', randomUUID());
    const r: any = await estoque.cmvReal(t2, '2026-10-01', '2026-10-31', null);
    expect(r.cmvTeorico).toBe(20);
  });

  it('EST-G-04: o fechamento avulso de UMA loja não deixa a outra sem o fechamento do dia', async () => {
    const { t2, lojas } = await empresaSo(2);
    await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, 'Arroz G04', 'kg', 5)`, [t2]); // compartilhado
    const ontem = somarDias(hojeISO(), -1);
    await estoque.gerarSnapshot(t2, ontem, lojas[0]); // só a loja 1 (o botão do painel)
    expect(await estoque.fechamentoIncompleto(t2, ontem)).toBe(true);
    await estoque.gerarSnapshot(t2, ontem); // a rotina completa
    expect(await estoque.fechamentoIncompleto(t2, ontem)).toBe(false);
    const porLoja = await q(`select unidade_id, count(*)::int as n from estoque_snapshot where tenant_id = $1 and data = $2 group by unidade_id`, [t2, ontem]);
    expect(porLoja).toHaveLength(2);
    // Empresa sem produto: nada falta (a rotina não tenta a cada 15 min).
    const vazia = await empresaSo();
    expect(await estoque.fechamentoIncompleto(vazia.t2, ontem)).toBe(false);
  });

  it('EST-C-02: o custo da revenda na Curva ABC é o da loja escolhida (sem loja, o do cadastro)', async () => {
    const { t2, lojas } = await empresaSo(2);
    const [{ id: item }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, 'Refri C02', 'unidade', 3) returning id`, [t2]);
    for (const [l, c] of [[lojas[0], 7], [lojas[1], 11]] as const)
      await q(`insert into item_estoque_unidade (id, tenant_id, item_id, unidade_id, custo_medio) values ($1, $2, $3, $4, $5)`, [randomUUID(), t2, item, l, c]);
    const [{ id: prod }] = await q(`insert into produto (tenant_id, nome, preco_venda, item_id, item_fator) values ($1, 'Refri C02', 8, $2, 1) returning id`, [t2, item]);
    const produtos = new ProdutoService(db, aud, {} as any, { custoPorPorcao: async () => ({}) } as any);
    expect((await produtos.custoEfetivoMapa(t2, lojas[0]))[prod]).toBe(7);
    expect((await produtos.custoEfetivoMapa(t2, lojas[1]))[prod]).toBe(11);
    expect((await produtos.custoEfetivoMapa(t2, null))[prod]).toBe(3);
  });
});
