import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO DO CLIENTE PELA MESA (QR) E A VARIAÇÃO DO PRODUTO — contra Postgres (TEST_PG_URL), pela
// porta de verdade (`CardapioService.receberPedido`).
//
// O pedido de entrega/retirada confere no SERVIDOR as escolhas do cliente (a opção é deste produto?
// a etapa obrigatória foi escolhida? passou do máximo?). O pedido da MESA ia direto para a comanda
// sem essa conferência: quem chama a rota sem a tela entrava com etapa obrigatória em branco e
// acima do máximo. E a VARIAÇÃO era lida só pelo id, nas duas portas e no balcão: a variação de
// OUTRO produto (mais barata) era aceita, com o preço dela.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-pela-mesa.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('pedido do cliente pela mesa (QR) e variação do produto (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const cardapio = new CardapioService(db, vendas, {} as any, {} as any, {} as any, {} as any, eventos, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  let mesaSeq = 100;

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
      for (const t of ['impressao_job', 'producao_pedido', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'mesa', 'caixa_sessao',
        'cardapio_config', 'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao',
        'produto_variacao', 'produto', 'categoria_produto', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // Lanche (R$ 20) com duas etapas: "Ponto" (obrigatória, uma) e "Adicionais" (até 2).
  // Suco (R$ 8) com as variações Pequeno (R$ 8) e Grande (R$ 12). Brinde (R$ 1) com a variação Mini (R$ 1).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pedido pela mesa') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    // Um cardápio por loja (índice único): o da mesa fica na loja, o de retirada numa segunda loja.
    const u2 = (await q(`insert into unidade (tenant_id, nome) values ($1,'Segunda loja de teste') returning id`, [t]))[0].id as string;
    const cfg = async (modo: string) => {
      const token = `tk-${randomUUID()}`;
      await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo) values ($1,$2,$3,true,$4)`, [t, modo === 'mesa' ? u : u2, token, modo]);
      return token;
    };
    const produto = async (nome: string, preco: number) =>
      (await q(
        `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,$2,$3,$4,false,false) returning id`,
        [t, nome, categoria, preco],
      ))[0].id as string;
    const variacao = async (produtoId: string, nome: string, preco: number) =>
      (await q(`insert into produto_variacao (tenant_id, produto_id, nome, preco_venda) values ($1,$2,$3,$4) returning id`, [t, produtoId, nome, preco]))[0].id as string;
    const lanche = await produto('Lanche de teste', 20);
    const suco = await produto('Suco de teste', 8);
    const brinde = await produto('Brinde de teste', 1);
    const grande = await variacao(suco, 'Grande', 12);
    const mini = await variacao(brinde, 'Mini', 1);

    const opcao = async (nome: string, codigoPdv: string | null = null) =>
      ((await produtos.criarOpcaoCatalogo(t, { nome, codigoPdv })) as any).id as string;
    const [mal, bem, bacon, queijo, ovo] = [await opcao('Mal passado de teste'), await opcao('Bem passado de teste'), await opcao('Bacon de teste', 'A1'), await opcao('Queijo de teste', 'A2'), await opcao('Ovo de teste', 'A3')];
    const ponto: any = await produtos.criarComplemento(t, { nome: 'Ponto de teste', regra: 'uma', obrigatorio: true, itens: [{ opcaoId: mal, preco: 0 }, { opcaoId: bem, preco: 0 }] });
    const extras: any = await produtos.criarComplemento(t, {
      nome: 'Adicionais de teste', regra: 'varias_sem_repeticao', max: 2,
      itens: [{ opcaoId: bacon, preco: 3 }, { opcaoId: queijo, preco: 2 }, { opcaoId: ovo, preco: 1 }],
    });
    await produtos.setProdutoComplementos(t, lanche, [ponto.id, extras.id]);
    // uma etapa em OUTRO produto, para a "opção de outro produto"
    const doSuco: any = await produtos.criarComplemento(t, { nome: 'Gelo de teste', regra: 'uma', itens: [{ opcaoId: await opcao('Sem gelo de teste'), preco: 0 }] });
    await produtos.setProdutoComplementos(t, suco, [doSuco.id]);

    const doProduto = async (produtoId: string) => {
      const linhas = await q(
        `select co.id, co.nome from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id
          where g.produto_id = $1 and co.deleted_at is null and g.deleted_at is null`,
        [produtoId],
      );
      return Object.fromEntries(linhas.map((l: any) => [l.nome, l.id as string])) as Record<string, string>;
    };
    return { t, u, lanche, suco, brinde, grande, mini, mesa: await cfg('mesa'), retirada: await cfg('retirada'), op: await doProduto(lanche), opSuco: await doProduto(suco) };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const pedirNaMesa = (l: Loja, item: Record<string, any>) => {
    const mesa = String(++mesaSeq);
    return cardapio.receberPedido(l.mesa, { mesa, itens: [{ produtoId: l.lanche, quantidade: 1, ...item } as any] }).then(() => mesa);
  };
  const itensDaMesa = (l: Loja, mesa: string) =>
    q(
      `select ci.descricao, ci.preco_unitario::float8 as preco from comanda_item ci join comanda c on c.id = ci.comanda_id
         join mesa m on m.id = c.mesa_id where m.tenant_id = $1 and m.numero = $2`,
      [l.t, mesa],
    );

  // ── as escolhas ─────────────────────────────────────────────────────────────────────────────
  it('pedido válido pela mesa entra na comanda com o preço das escolhas', async () => {
    const l = await loja();
    const mesa = await pedirNaMesa(l, { complementos: [l.op['Mal passado de teste'], l.op['Bacon de teste'], l.op['Queijo de teste']] });
    expect(await itensDaMesa(l, mesa)).toEqual([{ descricao: 'Lanche de teste', preco: 25 }]); // 20 + 3 + 2
  });

  it('etapa obrigatória sem escolha: o pedido da mesa é recusado, como o de entrega', async () => {
    const l = await loja();
    await expect(pedirNaMesa(l, { complementos: [l.op['Bacon de teste']] })).rejects.toThrow('Escolha uma opção em "Ponto de teste".');
    await expect(pedirNaMesa(l, {})).rejects.toThrow('Escolha uma opção em "Ponto de teste".');
  });

  it('acima do máximo da etapa: recusado', async () => {
    const l = await loja();
    await expect(
      pedirNaMesa(l, { complementos: [l.op['Mal passado de teste'], l.op['Bacon de teste'], l.op['Queijo de teste'], l.op['Ovo de teste']] }),
    ).rejects.toThrow('Escolha no máximo 2 em "Adicionais de teste".');
  });

  it('opção de outro produto: recusada (antes era ignorada em silêncio)', async () => {
    const l = await loja();
    await expect(
      pedirNaMesa(l, { complementos: [l.op['Mal passado de teste'], l.opSuco['Sem gelo de teste']] }),
    ).rejects.toThrow('Opção inválida para este produto.');
  });

  it('pedido recusado não deixa item pela metade na comanda', async () => {
    const l = await loja();
    const mesa = String(++mesaSeq);
    await expect(
      cardapio.receberPedido(l.mesa, {
        mesa,
        itens: [
          { produtoId: l.suco, quantidade: 1 } as any, // válido
          { produtoId: l.lanche, quantidade: 1, complementos: [] } as any, // falta o ponto
        ],
      }),
    ).rejects.toThrow('Escolha uma opção em "Ponto de teste".');
    expect(await itensDaMesa(l, mesa)).toEqual([]); // o suco não entrou sozinho
  });

  // ── a variação ──────────────────────────────────────────────────────────────────────────────
  it('variação do próprio produto vale: Suco Grande a R$ 12 na mesa', async () => {
    const l = await loja();
    const mesa = String(++mesaSeq);
    await cardapio.receberPedido(l.mesa, { mesa, itens: [{ produtoId: l.suco, variacaoId: l.grande, quantidade: 1 } as any] });
    expect(await itensDaMesa(l, mesa)).toEqual([{ descricao: 'Suco de teste · Grande', preco: 12 }]);
  });

  it('variação de OUTRO produto é recusada na mesa, na retirada e no balcão (antes valia o preço dela)', async () => {
    const l = await loja();
    const item = { produtoId: l.suco, variacaoId: l.mini, quantidade: 1 } as any; // Suco com a "Mini" do Brinde (R$ 1)
    await expect(cardapio.receberPedido(l.mesa, { mesa: String(++mesaSeq), itens: [item] })).rejects.toThrow('Variação inválida para este produto.');
    await expect(cardapio.receberPedido(l.retirada, { tipo: 'retirada', cliente: 'Cliente de teste', telefone: '5500000000000', itens: [item] })).rejects.toThrow('Variação inválida para este produto.');
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [l.t]))[0].id;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [l.t, funcao]))[0].id as string;
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [l.t, l.u, ator]);
    await expect(
      vendas.vendaBalcao(l.t, ator, 'presidente', { itens: [item], forma: 'dinheiro', unidadeId: l.u } as any, null),
    ).rejects.toThrow('Variação inválida para este produto.');
  });

  it('variação de outra EMPRESA é recusada', async () => {
    const a = await loja();
    const b = await loja();
    await expect(
      cardapio.receberPedido(a.mesa, { mesa: String(++mesaSeq), itens: [{ produtoId: a.suco, variacaoId: b.grande, quantidade: 1 } as any] }),
    ).rejects.toThrow('Variação inválida para este produto.');
  });
});
