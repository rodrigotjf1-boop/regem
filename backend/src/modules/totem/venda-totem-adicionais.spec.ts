import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VENDA DO TOTEM COM ADICIONAL — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// O totem (GoGeM) manda cada opção COM código PDV como uma LINHA própria da venda, logo depois do
// produto dela, com a quantidade do item (`apps/kiosk/lib/domain/order/order_models.dart`). O
// Regem procurava todo código entre os PRODUTOS: o código da opção não é de produto, e a venda
// inteira era recusada ("Código(s) PDV não encontrado(s)") — no cartão/PIX, depois de o cliente
// pagar. Medido em produção (09/10/2026): 159 opções com código, nenhuma com produto de mesmo código.
//
// Agora a linha cujo código é de uma opção do produto ANTERIOR entra como adicional dele: soma
// no preço do item, é gravada na venda e baixa o estoque — nos três caminhos do totem (venda paga,
// pedido retido liberado pelo pagamento, pedido em dinheiro cobrado no balcão).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('venda-totem-adicionais.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const FATIA = 1 / 72;

descrever('venda do totem com adicional (Postgres real)', () => {
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
        'caixa_sessao', 'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto',
        'categoria_produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_conversao', 'item_estoque', 'equipamento', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // Lanche LT1 (R$ 20): ficha com 1 pão + 2 fatias de bacon (kg, 1 kg = 72).
  // Adicional AD1 "Bacon de teste" (R$ 3): ficha de 1 fatia. Adicional AD2 "Queijo de teste" (R$ 2), sem estoque.
  // Suco SU1 (R$ 8), com a opção GE1 "Gelo de teste" (R$ 0, com código).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste totem adicional') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    const totem = (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo) values ($1,$2,'totem','Totem de teste',$3,true) returning id`, [t, u, randomUUID()]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const item = async (nome: string, unidade: string, custo: number, saldo: number) => {
      const id = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,$3,$4) returning id`, [t, nome, unidade, custo]))[0].id as string;
      await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',$3,$4)`, [t, id, saldo, custo]);
      return id;
    };
    const bacon = await item('Bacon de teste', 'kg', 36, 10);
    await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1,$2,'kg',72,'unidade')`, [t, bacon]);
    const pao = await item('Pão de teste', 'unidade', 2, 100);
    const fichaLanche: any = await fichas.create(t, { nome: 'Lanche de teste', rendimento: 1, ingredientes: [
      { insumoNome: 'Pão de teste', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 2 },
      { insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 },
    ] } as any);
    const fichaFatia: any = await fichas.create(t, { nome: 'Fatia de teste', rendimento: 1, ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 1, unidade: 'unidade', custoUnitario: 0.5 }] } as any);
    const produto = async (codigo: string, nome: string, preco: number, fichaId: string | null) =>
      (await q(
        `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, ficha_id)
         values ($1,$2,$3,$4,$5,false,$6,$7) returning id`,
        [t, codigo, nome, categoria, preco, !!fichaId, fichaId],
      ))[0].id as string;
    const lanche = await produto('LT1', 'Lanche de teste', 20, fichaLanche.id);
    const suco = await produto('SU1', 'Suco de teste', 8, null);
    const opBacon: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon de teste', tipo: 'ficha', fichaId: fichaFatia.id, codigoPdv: 'AD1', controlaEstoque: true });
    const opQueijo: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Queijo de teste', codigoPdv: 'AD2' });
    const opGelo: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Gelo de teste', codigoPdv: 'GE1' });
    const extras: any = await produtos.criarComplemento(t, { nome: 'Adicionais de teste', regra: 'varias_com_repeticao', itens: [{ opcaoId: opBacon.id, preco: 3 }, { opcaoId: opQueijo.id, preco: 2 }] });
    await produtos.setProdutoComplementos(t, lanche, [extras.id]);
    const doSuco: any = await produtos.criarComplemento(t, { nome: 'Gelo de teste', regra: 'uma', itens: [{ opcaoId: opGelo.id, preco: 0 }] });
    await produtos.setProdutoComplementos(t, suco, [doSuco.id]);
    return { t, u, gestor, totem, bacon, pao, lanche, suco };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const ctx = (l: Loja) => ({ unidadeId: l.u, equipamentoId: l.totem });
  const vender = (l: Loja, itens: any[], valor: number) =>
    vendas.venderTotem(l.t, ctx(l), { idempotencyKey: randomUUID(), itens, pagamentos: [{ forma: 'credito', valor }], plataforma: 'GoGeM Totem' } as any) as Promise<any>;
  const itensDaVenda = (comandaId: string) =>
    // por nome: os itens de uma venda nascem na mesma transação (mesmo `created_at`) e o id é aleatório
    q(`select id, descricao, preco_unitario::float8 as preco, quantidade::float8 as quantidade from comanda_item where comanda_id = $1 order by descricao`, [comandaId]);
  const escolhasDoItem = (itemId: string) => q(`select nome, preco_delta::float8 as "precoDelta" from comanda_item_complemento where comanda_item_id = $1 order by nome`, [itemId]);
  async function saidas(l: Loja, comandaId: string) {
    const linhas = await q(`select item_id, quantidade::float8 as quantidade from movimento_estoque where tenant_id = $1 and ref_id = $2 and tipo = 'saida'`, [l.t, comandaId]);
    return new Map<string, number>(linhas.map((r: any) => [r.item_id, r.quantidade]));
  }

  // ── venda paga no totem ─────────────────────────────────────────────────────────────────────
  it('como o totem manda (produto e, em seguida, a linha do adicional): a venda entra, com o adicional no item', async () => {
    const l = await loja();
    // 2 lanches, cada um com 1 bacon: o totem manda a opção com a quantidade do ITEM
    const r = await vender(l, [{ codigoPdv: 'LT1', quantidade: 2 }, { codigoPdv: 'AD1', quantidade: 2 }], 46);
    expect(r.total).toBe(46); // 2 × (20 + 3)
    const itens = await itensDaVenda(r.comandaId);
    expect(itens).toHaveLength(1); // o adicional NÃO vira um item à parte
    expect(itens[0]).toMatchObject({ descricao: 'Lanche de teste', preco: 23, quantidade: 2 });
    expect(await escolhasDoItem(itens[0].id)).toEqual([{ nome: 'Bacon de teste', precoDelta: 3 }]);
    const s = await saidas(l, r.comandaId);
    expect(s.get(l.pao)).toBeCloseTo(2, 9);
    expect(s.get(l.bacon)).toBeCloseTo(2 * (2 + 1) * FATIA, 9); // 2 lanches × (2 da ficha + 1 do adicional)
    expect(((await vendas.getComanda(l.t, r.comandaId)) as any).itens[0].complementosTexto).toBe('+ Bacon de teste');
  });

  it('o mesmo adicional duas vezes e outro adicional no mesmo lanche; e um segundo produto com a opção dele', async () => {
    const l = await loja();
    const r = await vender(l, [
      { codigoPdv: 'LT1', quantidade: 1 },
      { codigoPdv: 'AD1', quantidade: 1 },
      { codigoPdv: 'AD1', quantidade: 1 },
      { codigoPdv: 'AD2', quantidade: 1 },
      { codigoPdv: 'SU1', quantidade: 3 },
      { codigoPdv: 'GE1', quantidade: 3 },
    ], 20 + 3 + 3 + 2 + 3 * 8);
    const itens = await itensDaVenda(r.comandaId);
    expect(itens.map((i: any) => [i.descricao, i.preco, i.quantidade])).toEqual([['Lanche de teste', 28, 1], ['Suco de teste', 8, 3]]);
    expect((await escolhasDoItem(itens[0].id)).map((e: any) => e.nome)).toEqual(['Bacon de teste', 'Bacon de teste', 'Queijo de teste']);
    expect((await escolhasDoItem(itens[1].id)).map((e: any) => e.nome)).toEqual(['Gelo de teste']);
    expect((await saidas(l, r.comandaId)).get(l.bacon)).toBeCloseTo(4 * FATIA, 9); // 2 da ficha + 2 do adicional
    expect(((await vendas.getComanda(l.t, r.comandaId)) as any).itens[0].complementosTexto).toBe('+ 2x Bacon de teste · + Queijo de teste');
  });

  it('venda sem adicional segue como sempre', async () => {
    const l = await loja();
    const r = await vender(l, [{ codigoPdv: 'LT1', quantidade: 1 }, { codigoPdv: 'SU1', quantidade: 1 }], 28);
    expect((await itensDaVenda(r.comandaId)).map((i: any) => [i.descricao, i.preco])).toEqual([['Lanche de teste', 20], ['Suco de teste', 8]]);
  });

  it('o pagamento tem de bater com o total COM os adicionais', async () => {
    const l = await loja();
    await expect(vender(l, [{ codigoPdv: 'LT1', quantidade: 1 }, { codigoPdv: 'AD1', quantidade: 1 }], 20)).rejects.toThrow('A soma dos pagamentos (20.00) não bate com o total (23.00).');
  });

  it('código que não é produto nem opção do produto anterior continua recusado, dizendo qual', async () => {
    const l = await loja();
    // código que não existe
    await expect(vender(l, [{ codigoPdv: 'LT1', quantidade: 1 }, { codigoPdv: 'ZZ9', quantidade: 1 }], 20)).rejects.toThrow('ZZ9');
    // opção de OUTRO produto (o gelo é do suco, não do lanche)
    await expect(vender(l, [{ codigoPdv: 'LT1', quantidade: 1 }, { codigoPdv: 'GE1', quantidade: 1 }], 20)).rejects.toThrow('GE1');
    // opção sem produto antes dela
    await expect(vender(l, [{ codigoPdv: 'AD1', quantidade: 1 }, { codigoPdv: 'LT1', quantidade: 1 }], 23)).rejects.toThrow('AD1');
  });

  // ── pedido retido (cartão/PIX aguardando, ou dinheiro a cobrar no balcão) ───────────────────
  it('pedido retido no cartão: nasce com o total dos adicionais e, aprovado o pagamento, vira a venda com eles', async () => {
    const l = await loja();
    const ped: any = await delivery.criarPedidoTotemRetido(l.t, { unidadeId: l.u }, {
      idempotencyKey: randomUUID(), formaPagamento: 'cartao',
      itens: [{ codigoPdv: 'LT1', quantidade: 2 }, { codigoPdv: 'AD1', quantidade: 2 }, { codigoPdv: 'AD1', quantidade: 2 }],
    });
    expect(Number(ped.total)).toBe(52); // 2 × (20 + 3 + 3)
    expect(ped.itens).toHaveLength(1);
    expect(ped.itens[0]).toMatchObject({ descricao: 'Lanche de teste', precoUnitario: 26, quantidade: 2 });

    const venda: any = await delivery.liberarPagamentoTotem(l.t, ctx(l), ped.id, [{ forma: 'credito', valor: 52, nsu: '1', autorizacao: 'A' }]);
    expect(venda.total).toBe(52);
    const itens = await itensDaVenda(venda.comandaId);
    expect(itens[0]).toMatchObject({ descricao: 'Lanche de teste', preco: 26, quantidade: 2 });
    expect(await escolhasDoItem(itens[0].id)).toHaveLength(2); // o bacon, duas vezes
    expect((await saidas(l, venda.comandaId)).get(l.bacon)).toBeCloseTo(2 * (2 + 2) * FATIA, 9);
  });

  it('pedido em dinheiro cobrado no balcão: o aceite grava os adicionais e a conclusão baixa o estoque', async () => {
    const l = await loja();
    const ped: any = await delivery.criarPedidoTotemRetido(l.t, { unidadeId: l.u }, {
      idempotencyKey: randomUUID(), formaPagamento: 'dinheiro',
      itens: [{ codigoPdv: 'LT1', quantidade: 1 }, { codigoPdv: 'AD1', quantidade: 1 }, { codigoPdv: 'AD1', quantidade: 1 }],
    });
    expect(Number(ped.total)).toBe(26);
    const [atual] = await q(`select status, comanda_id from pedido_externo where id = $1`, [ped.id]);
    const comandaId = atual.comanda_id ?? ((await delivery.aceitar(l.t, l.gestor, ped.id)) as any).comandaId;
    const itens = await itensDaVenda(comandaId);
    expect(itens[0]).toMatchObject({ descricao: 'Lanche de teste', preco: 26 });
    expect(await escolhasDoItem(itens[0].id)).toHaveLength(2);
    await vendas.baixarEstoqueExterno(l.t, comandaId);
    expect((await saidas(l, comandaId)).get(l.bacon)).toBeCloseTo(4 * FATIA, 9);
    expect(((await vendas.getComanda(l.t, comandaId)) as any).itens[0].complementosTexto).toBe('+ 2x Bacon de teste');
  });
});
