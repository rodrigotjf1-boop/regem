import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from '../estoque/estoque.service';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LIGAÇÃO DIRETA AO PRODUTO DO ESTOQUE COM A UNIDADE ESCOLHIDA (mig 309) — contra Postgres
// (TEST_PG_URL), com os serviços de verdade.
//
// Pedido do dono (08/10/2026): "no caso da ligação de um produto que está como um fardo porém tem
// cadastro de conversão, na hora de ligar é só perguntar se vai calcular valor unitário ou do
// fardo". Dois lugares ligam direto, sem ficha: o produto de REVENDA do catálogo e o ADICIONAL do
// tipo insumo. Os dois baixavam sempre 1 unidade do ESTOQUE (a lata vendida baixava 1 fardo; a
// fatia de bacon, 1 kg).
//
// Cada teste confere o que ficou gravado, o que a tela recebe (custo) e o que a VENDA baixa.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('vinculo-estoque-unidade.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('ligação direta ao estoque com a unidade escolhida (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const estoque = new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(
          `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
        )
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'caixa_sessao',
        'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao',
        'produto_combo_item', 'produto', 'categoria_produto', 'item_conversao', 'item_estoque', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // Refrigerante em FARDO (1 fardo = 12 unidade), R$ 36 o fardo → R$ 3 a unidade.
  // Bacon em KG (1 kg = 72 unidade), R$ 36 o kg → R$ 0,50 a fatia.
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste vinculo estoque') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [t, u, ator]);
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const item = async (nome: string, unidade: string, custo: number, saldo: number, conv?: [string, number, string]) => {
      const id = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,$3,$4) returning id`, [t, nome, unidade, custo]))[0].id as string;
      await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',$3,$4)`, [t, id, saldo, custo]);
      if (conv) await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1,$2,$3,$4,$5)`, [t, id, ...conv]);
      return id;
    };
    const refri = await item('Refrigerante de teste', 'fardo', 36, 20, ['fardo', 12, 'unidade']);
    const bacon = await item('Bacon de teste', 'kg', 36, 10, ['kg', 72, 'unidade']);
    return { t, u, ator, categoria, refri, bacon };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const revenda = (l: Loja, extra: Record<string, any> = {}) =>
    produtos.criar(l.t, l.ator, 'presidente', {
      nome: 'Lata de teste', categoriaId: l.categoria, precoVenda: 6, controlaEstoque: true, itemId: l.refri, ...extra,
    } as any) as Promise<any>;
  const gravado = async (produtoId: string) =>
    (await q(`select item_id, item_unidade, item_fator::float8 as fator from produto where id = $1`, [produtoId]))[0];
  const vender = async (l: Loja, produtoId: string, quantidade: number, complementos: string[] = []) => {
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId, quantidade, complementos }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    const linhas = await q(
      `select item_id, quantidade::float8 as quantidade, custo_unitario::float8 as custo
         from movimento_estoque where tenant_id = $1 and ref_id = $2 and tipo = 'saida'`,
      [l.t, r.comandaId],
    );
    return new Map<string, { quantidade: number; custo: number }>(linhas.map((x: any) => [x.item_id, { quantidade: x.quantidade, custo: x.custo }]));
  };

  // ── produto de revenda ──────────────────────────────────────────────────────────────────────
  it('revenda ligada por UNIDADE a um item em fardo de 12: grava o fator 1/12, custa R$ 3 e 5 vendas baixam 5/12 de fardo', async () => {
    const l = await loja();
    const p = await revenda(l, { itemUnidade: 'unidade' });
    const g = await gravado(p.id);
    expect(g.item_unidade).toBe('unidade');
    expect(g.fator).toBeCloseTo(1 / 12, 12);

    const s = await vender(l, p.id, 5);
    expect(s.get(l.refri)!.quantidade).toBeCloseTo(5 / 12, 9);
    expect(s.get(l.refri)!.quantidade * s.get(l.refri)!.custo).toBeCloseTo(15, 6); // 5 × R$ 3

    const naLista = ((await produtos.listar(l.t, true)) as any[]).find((x) => x.id === p.id);
    expect(naLista).toMatchObject({ itemUnidade: 'unidade', itemUnidadeEstoque: 'fardo', custoFonte: 'estoque' });
    expect(naLista.custoEfetivo).toBeCloseTo(3, 9);
    expect((await produtos.custoEfetivoMapa(l.t))[p.id]).toBeCloseTo(3, 9);
    // quem não vê valores não recebe o custo
    expect(((await produtos.listar(l.t, false)) as any[]).find((x) => x.id === p.id).custoEfetivo).toBeNull();
  });

  it('revenda sem unidade escolhida (ou na do estoque) segue como sempre: 1 fardo por venda, ao custo do fardo', async () => {
    const l = await loja();
    for (const extra of [{}, { itemUnidade: 'fardo' }, { itemUnidade: '' }, { itemUnidade: null }]) {
      const p = await revenda(l, { nome: `Fardo de teste ${JSON.stringify(extra)}`, ...extra });
      expect(await gravado(p.id)).toMatchObject({ item_unidade: null, fator: 1 });
      expect((await vender(l, p.id, 2)).get(l.refri)!.quantidade).toBeCloseTo(2, 9);
      expect(((await produtos.listar(l.t, true)) as any[]).find((x) => x.id === p.id).custoEfetivo).toBeCloseTo(36, 9);
    }
  });

  it('unidade que o produto do estoque não tem é recusada, dizendo quais valem', async () => {
    const l = await loja();
    await expect(revenda(l, { itemUnidade: 'litro' })).rejects.toThrow('"litro" não é uma unidade deste produto do estoque. Escolha fardo ou unidade.');
    await expect(produtos.criarOpcaoCatalogo(l.t, { nome: 'Opção de teste', tipo: 'insumo', itemId: l.bacon, itemUnidade: 'fatia' }))
      .rejects.toThrow('"fatia" não é uma unidade deste produto do estoque. Escolha kg ou unidade.');
  });

  it('editar o produto: mudar a unidade refaz o fator; trocar o item sem dizer a unidade volta para a do estoque; desligar zera', async () => {
    const l = await loja();
    const p = await revenda(l, { itemUnidade: 'unidade' });
    await produtos.atualizar(l.t, p.id, { itemUnidade: 'fardo' } as any);
    expect(await gravado(p.id)).toMatchObject({ item_id: l.refri, item_unidade: null, fator: 1 });
    await produtos.atualizar(l.t, p.id, { itemUnidade: 'unidade' } as any);
    expect((await gravado(p.id)).fator).toBeCloseTo(1 / 12, 12);
    // edição que não fala do estoque (preço) não mexe na ligação
    await produtos.atualizar(l.t, p.id, { precoVenda: 7 } as any);
    expect(await gravado(p.id)).toMatchObject({ item_id: l.refri, item_unidade: 'unidade' });
    // troca o item: "unidade" do refrigerante não vale para o bacon sem a pessoa escolher de novo
    await produtos.atualizar(l.t, p.id, { itemId: l.bacon } as any);
    expect(await gravado(p.id)).toMatchObject({ item_id: l.bacon, item_unidade: null, fator: 1 });
    await produtos.atualizar(l.t, p.id, { itemId: l.refri, itemUnidade: 'unidade' } as any);
    expect((await gravado(p.id)).fator).toBeCloseTo(1 / 12, 12);
    // desliga do estoque
    await produtos.atualizar(l.t, p.id, { itemId: null } as any);
    expect(await gravado(p.id)).toMatchObject({ item_id: null, item_unidade: null, fator: 1 });
  });

  it('combo com componente de revenda: a lata do combo passa a sair do estoque, na unidade da ligação', async () => {
    const l = await loja();
    const lata = await revenda(l, { itemUnidade: 'unidade' });
    const combo: any = await produtos.criar(l.t, l.ator, 'presidente', {
      nome: 'Combo de teste', categoriaId: l.categoria, precoVenda: 30, controlaEstoque: true, tipo: 'combo',
    } as any);
    await q(`insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id, quantidade) values ($1,$2,$3,2)`, [l.t, combo.id, lata.id]);
    const s = await vender(l, combo.id, 3);
    expect(s.get(l.refri)!.quantidade).toBeCloseTo((3 * 2) / 12, 9); // 3 combos × 2 latas
  });

  // ── adicional ligado direto ao insumo ───────────────────────────────────────────────────────
  async function comAdicional(l: Loja, opcaoExtra: Record<string, any> = {}) {
    const lanche: any = await produtos.criar(l.t, l.ator, 'presidente', {
      nome: 'Lanche de teste', categoriaId: l.categoria, precoVenda: 20, controlaEstoque: false,
    } as any);
    const op: any = await produtos.criarOpcaoCatalogo(l.t, {
      nome: 'Bacon de teste', tipo: 'insumo', itemId: l.bacon, codigoPdv: 'AD1', controlaEstoque: true, ...opcaoExtra,
    });
    const etapa: any = await produtos.criarComplemento(l.t, {
      nome: 'Adicionais de teste', regra: 'varias_com_repeticao', itens: [{ opcaoId: op.id, preco: 3 }],
    });
    await produtos.setProdutoComplementos(l.t, lanche.id, [etapa.id]);
    const doProduto = async () =>
      (await q(
        `select co.id, co.quantidade::float8 as quantidade from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id
          where g.produto_id = $1 and co.origem_opcao_id = $2 and co.deleted_at is null`,
        [lanche.id, op.id],
      ))[0];
    return { lanche: lanche.id as string, op: op.id as string, doProduto };
  }

  it('adicional ligado por UNIDADE a um bacon em kg (1 kg = 72): cada escolha baixa 1/72 kg e custa R$ 0,50', async () => {
    const l = await loja();
    const a = await comAdicional(l, { itemUnidade: 'unidade' });
    const naTela = await a.doProduto();
    expect(naTela.quantidade).toBeCloseTo(1 / 72, 12); // o que a venda vai baixar por escolha

    const s = await vender(l, a.lanche, 2, [naTela.id, naTela.id, naTela.id]); // 2 lanches, 3 fatias cada
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(6 / 72, 9);
    expect(s.get(l.bacon)!.quantidade * s.get(l.bacon)!.custo).toBeCloseTo(3, 6); // 6 × R$ 0,50

    const comValores = ((await produtos.listarOpcoes(l.t, false, true)) as any[]).find((o) => o.id === a.op);
    expect(comValores).toMatchObject({ itemUnidade: 'unidade', itemUnidadeEstoque: 'kg', custoItem: 0.5 });
    expect(comValores.itemFator).toBeCloseTo(1 / 72, 12);
    expect(comValores).not.toHaveProperty('itemCustoMedio');
    const semValores = ((await produtos.listarOpcoes(l.t, false, false)) as any[]).find((o) => o.id === a.op);
    expect(semValores).toMatchObject({ itemUnidade: 'unidade', custoItem: null });
  });

  it('adicional sem unidade escolhida segue como sempre: 1 unidade do estoque (1 kg) por escolha', async () => {
    const l = await loja();
    const a = await comAdicional(l);
    const naTela = await a.doProduto();
    expect(naTela.quantidade).toBe(1);
    expect((await vender(l, a.lanche, 1, [naTela.id])).get(l.bacon)!.quantidade).toBeCloseTo(1, 9);
    expect(((await produtos.listarOpcoes(l.t, false, true)) as any[]).find((o) => o.id === a.op)).toMatchObject({ itemUnidade: null, itemFator: 1, custoItem: 36 });
  });

  it('canal externo (código PDV): baixa na unidade da ligação, só com "Controlar estoque" ligado, e pelo cadastro de agora', async () => {
    const l = await loja();
    const a = await comAdicional(l, { itemUnidade: 'unidade' });
    const pedidoDoCanal = async () => {
      const venda: any = await vendas.venderExterno(l.t, null, {
        unidadeId: l.u, cliente: 'Cliente de teste', forma: 'online', origem: 'delivery', plataforma: 'iFood',
        itens: [{ produtoId: a.lanche, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: 26, complementosCanal: [{ nome: 'Bacon', codigo: 'AD1', quantidade: 2 }] }],
      } as any);
      const comandaId = (venda.comandaId ?? venda.comanda?.id ?? venda.id) as string;
      await vendas.baixarEstoqueExterno(l.t, comandaId);
      return q(
        `select quantidade::float8 as quantidade from movimento_estoque where tenant_id = $1 and ref_id = $2 and item_id = $3 and tipo = 'saida'`,
        [l.t, comandaId, l.bacon],
      );
    };
    expect((await pedidoDoCanal())[0].quantidade).toBeCloseTo(2 / 72, 9); // 2 fatias
    // O controle de estoque da opção é desligado: o catálogo recria a opção do produto (a antiga
    // fica apagada, com o mesmo código) e o próximo pedido do canal não baixa mais.
    await produtos.atualizarOpcao(l.t, a.op, { nome: 'Bacon de teste', tipo: 'insumo', itemId: l.bacon, codigoPdv: 'AD1', controlaEstoque: false });
    expect(await pedidoDoCanal()).toHaveLength(0);
  });

  it('salvar a opção sem falar da unidade (pausar, repor) mantém a ligação; trocar o insumo volta para a unidade do estoque', async () => {
    const l = await loja();
    const a = await comAdicional(l, { itemUnidade: 'unidade' });
    const base = { nome: 'Bacon de teste', tipo: 'insumo', codigoPdv: 'AD1', controlaEstoque: true };
    await produtos.atualizarOpcao(l.t, a.op, { ...base, itemId: l.bacon, esgotado: true });
    expect((await q(`select item_unidade from opcao where id = $1`, [a.op]))[0].item_unidade).toBe('unidade');
    expect((await a.doProduto()).quantidade).toBeCloseTo(1 / 72, 12);
    await produtos.atualizarOpcao(l.t, a.op, { ...base, itemId: l.refri });
    expect((await q(`select item_unidade from opcao where id = $1`, [a.op]))[0].item_unidade).toBeNull();
    expect((await a.doProduto()).quantidade).toBe(1);
  });

  // ── a conversão do produto do estoque muda ──────────────────────────────────────────────────
  it('mudar a conversão no cadastro do estoque refaz o fator das ligações; tirar a conversão volta para a unidade do estoque', async () => {
    const l = await loja();
    const lata = await revenda(l, { itemUnidade: 'unidade' });
    const a = await comAdicional(l, { itemUnidade: 'unidade' });

    const r1: any = await estoque.updateItem(l.t, l.refri, { conversoes: [{ unidadeDe: 'fardo', fator: 6, unidadePara: 'unidade' }] } as any);
    expect(r1.vinculosAjustados).toBe(1);
    expect((await gravado(lata.id)).fator).toBeCloseTo(1 / 6, 12);
    expect((await vender(l, lata.id, 6)).get(l.refri)!.quantidade).toBeCloseTo(1, 9); // 6 latas = 1 fardo

    const r2: any = await estoque.updateItem(l.t, l.bacon, { conversoes: [{ unidadeDe: 'kg', fator: 60, unidadePara: 'unidade' }] } as any);
    expect(r2.vinculosAjustados).toBe(1);
    expect((await a.doProduto()).quantidade).toBeCloseTo(1 / 60, 12);

    // salvar de novo a mesma conversão, ou mexer em outro campo, não muda nada
    expect(((await estoque.updateItem(l.t, l.bacon, { conversoes: [{ unidadeDe: 'kg', fator: 60, unidadePara: 'unidade' }] } as any)) as any).vinculosAjustados).toBe(0);
    expect(((await estoque.updateItem(l.t, l.bacon, { estoqueMinimo: 2 } as any)) as any).vinculosAjustados).toBe(0);

    // sem a conversão, "unidade" deixa de existir: as ligações voltam para a unidade do estoque
    expect(((await estoque.updateItem(l.t, l.refri, { conversoes: [] } as any)) as any).vinculosAjustados).toBe(1);
    expect(await gravado(lata.id)).toMatchObject({ item_unidade: null, fator: 1 });
    expect(((await estoque.updateItem(l.t, l.bacon, { conversoes: [] } as any)) as any).vinculosAjustados).toBe(1);
    expect((await q(`select item_unidade from opcao where id = $1`, [a.op]))[0].item_unidade).toBeNull();
    expect((await a.doProduto()).quantidade).toBe(1);
  });
});
