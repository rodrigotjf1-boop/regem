import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO LANÇADO PELO OPERADOR NO PAINEL DO DELIVERY (e o do nosso cardápio) — a VARIAÇÃO e os
// ADICIONAIS escolhidos — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// A tela "Novo pedido" (e "Alterar pedido") usa o mesmo seletor do balcão: o operador escolhe a
// variação e os adicionais e vê o preço somado. Mas o que ia para o servidor era só produto e
// quantidade: o pedido nascia com o preço-base e o nome do produto — sem a variação, sem os
// adicionais, na cozinha e no estoque. E no pedido do NOSSO cardápio a variação escolhida pelo
// cliente não chegava à venda: o Suco Grande baixava a ficha do pequeno.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-manual-escolhas.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const FATIA = 1 / 72;

descrever('pedido manual do delivery e do nosso cardápio: variação e adicionais (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const beneficio = () => new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(db, vendas, producao, beneficio(), beneficio(), eventos, { flashPedidos: () => undefined } as any);
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
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda',
        'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto_variacao', 'produto',
        'categoria_produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_conversao', 'item_estoque', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // Suco (R$ 8): ficha com 1 laranja. Variação Grande (R$ 12) baixa a ficha em dobro (fator 2).
  // Adicional "Bacon de teste" (R$ 3, pode repetir): ficha de 1 fatia de um bacon em kg (1 kg = 72).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pedido manual') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const item = async (nome: string, unidade: string, custo: number, saldo: number) => {
      const id = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,$3,$4) returning id`, [t, nome, unidade, custo]))[0].id as string;
      await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',$3,$4)`, [t, id, saldo, custo]);
      return id;
    };
    const laranja = await item('Laranja de teste', 'unidade', 1, 100);
    const bacon = await item('Bacon de teste', 'kg', 36, 10);
    await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1,$2,'kg',72,'unidade')`, [t, bacon]);
    const fichaSuco: any = await fichas.create(t, { nome: 'Suco de teste', rendimento: 1, ingredientes: [{ insumoNome: 'Laranja de teste', itemId: laranja, quantidade: 1, unidade: 'unidade', custoUnitario: 1 }] } as any);
    const fichaFatia: any = await fichas.create(t, { nome: 'Fatia de teste', rendimento: 1, ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 1, unidade: 'unidade', custoUnitario: 0.5 }] } as any);
    const suco = (await q(
      `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, ficha_id)
       values ($1,'SU1','Suco de teste',$2,'8.00',false,true,$3) returning id`,
      [t, categoria, fichaSuco.id],
    ))[0].id as string;
    const grande = (await q(`insert into produto_variacao (tenant_id, produto_id, nome, preco_venda, fator_ficha) values ($1,$2,'Grande','12.00',2) returning id`, [t, suco]))[0].id as string;
    const opc: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon de teste', tipo: 'ficha', fichaId: fichaFatia.id, codigoPdv: 'AD1', controlaEstoque: true });
    const etapa: any = await produtos.criarComplemento(t, { nome: 'Adicionais de teste', regra: 'varias_com_repeticao', itens: [{ opcaoId: opc.id, preco: 3 }] });
    await produtos.setProdutoComplementos(t, suco, [etapa.id]);
    const op = (await q(
      `select co.id from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id where g.produto_id = $1 and co.deleted_at is null`,
      [suco],
    ))[0].id as string;
    return { t, u, gestor, laranja, bacon, suco, grande, op };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const itensDaVenda = (comandaId: string) =>
    q(`select id, descricao, variacao_id, preco_unitario::float8 as preco, quantidade::float8 as quantidade from comanda_item where comanda_id = $1 order by created_at, id`, [comandaId]);
  const escolhasDoItem = (itemId: string) => q(`select nome from comanda_item_complemento where comanda_item_id = $1`, [itemId]);
  async function saidas(l: Loja, comandaId: string) {
    const linhas = await q(`select item_id, quantidade::float8 as quantidade from movimento_estoque where tenant_id = $1 and ref_id = $2 and tipo = 'saida'`, [l.t, comandaId]);
    return new Map<string, number>(linhas.map((r: any) => [r.item_id, r.quantidade]));
  }
  const manual = (l: Loja, item: Record<string, any>) =>
    delivery.criarManual(l.t, l.u, { tipo: 'retirada', clienteNome: 'Cliente de teste', itens: [{ produtoId: l.suco, quantidade: 1, ...item }] } as any) as Promise<any>;

  // ── pedido manual ───────────────────────────────────────────────────────────────────────────
  it('pedido manual sem escolhas: como sempre — preço e nome do produto', async () => {
    const l = await loja();
    const ped = await manual(l, {});
    expect(Number(ped.total)).toBe(8);
    expect(ped.itens[0]).toMatchObject({ descricao: 'Suco de teste', precoUnitario: 8 });
  });

  it('pedido manual com variação e adicional repetido: o preço, a descrição, a venda e a baixa seguem o que o operador escolheu', async () => {
    const l = await loja();
    const ped = await manual(l, { variacaoId: l.grande, complementos: [l.op, l.op] });
    expect(Number(ped.total)).toBe(18); // 12 + 2 × 3 (antes: 8)
    expect(ped.itens[0]).toMatchObject({ descricao: 'Suco de teste · Grande (2x Bacon de teste)', precoUnitario: 18 });

    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    const [item] = await itensDaVenda(r.comandaId);
    expect(item).toMatchObject({ descricao: 'Suco de teste · Grande (2x Bacon de teste)', variacao_id: l.grande, preco: 18 });
    expect(await escolhasDoItem(item.id)).toHaveLength(2);

    await vendas.baixarEstoqueExterno(l.t, r.comandaId);
    const s = await saidas(l, r.comandaId);
    expect(s.get(l.laranja)).toBeCloseTo(2, 9); // a variação Grande baixa a ficha em dobro
    expect(s.get(l.bacon)).toBeCloseTo(2 * FATIA, 9); // o adicional, 2 vezes
    // o cupom não repete o que a descrição já diz
    expect(((await vendas.getComanda(l.t, r.comandaId)) as any).itens[0].complementosTexto).toBeNull();
  });

  it('pedido manual com variação de outro produto é recusado', async () => {
    const a = await loja();
    const b = await loja();
    await expect(manual(a, { variacaoId: b.grande })).rejects.toThrow('Variação inválida para este produto.');
  });

  // ── nosso cardápio ──────────────────────────────────────────────────────────────────────────
  it('pedido do nosso cardápio com variação: a variação chega à venda e a baixa usa o fator dela', async () => {
    const l = await loja();
    const ped: any = await delivery.ingest(l.t, l.u, 'cardapio', {
      cliente: 'Cliente de teste', tipo: 'retirada', formaPagamento: 'pix', total: 12,
      // o que o cardápio manda (cardapio.service › itensOut)
      itens: [{ produtoId: l.suco, variacaoId: l.grande, descricao: 'Suco de teste · Grande', quantidade: 1, precoUnitario: 12, opcaoIds: [] }],
    }, { clientRef: randomUUID() } as any);
    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    expect((await itensDaVenda(r.comandaId))[0]).toMatchObject({ variacao_id: l.grande, preco: 12 });
    await vendas.baixarEstoqueExterno(l.t, r.comandaId);
    expect((await saidas(l, r.comandaId)).get(l.laranja)).toBeCloseTo(2, 9); // antes: 1 (a ficha do pequeno)
  });

  // ── alterar um pedido aceito ────────────────────────────────────────────────────────────────
  it('acrescentar item a um pedido aceito: entra com a variação e os adicionais escolhidos', async () => {
    const l = await loja();
    const ped = await manual(l, {});
    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    const depois: any = await delivery.alterar(l.t, l.gestor, ped.id, {
      adicionar: [{ produtoId: l.suco, variacaoId: l.grande, complementos: [l.op], quantidade: 1 }],
    } as any);
    expect(Number(depois.total)).toBe(23); // 8 + (12 + 3)
    const itens = await itensDaVenda(r.comandaId);
    const novo = itens.find((i: any) => i.variacao_id === l.grande)!;
    expect(novo).toMatchObject({ descricao: 'Suco de teste · Grande (Bacon de teste)', preco: 15 });
    expect(await escolhasDoItem(novo.id)).toHaveLength(1);
    await vendas.baixarEstoqueExterno(l.t, r.comandaId);
    const s = await saidas(l, r.comandaId);
    expect(s.get(l.laranja)).toBeCloseTo(3, 9); // 1 do pequeno + 2 do grande
    expect(s.get(l.bacon)).toBeCloseTo(FATIA, 9);
  });
});
