import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from './vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ADICIONAL LIGADO A UMA FICHA TÉCNICA — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// Pedido do dono (08/10/2026): o bacon é insumo (kg, 1 kg = 72 fatias) e também adicional de venda.
// "O ideal é … criar uma ficha técnica bacon, e no adicional o bacon é linkado à ficha técnica bacon
// para calcular baixas no estoque e CMV e controle"; "um produto com duas fatias de bacon tem +1
// fatia e repete +1 fatia"; "a ficha é o custo".
//
// O que se media antes: a opção do tipo "ficha" guardava o vínculo e a venda o ignorava (nada saía
// do estoque); a repetição era engolida no balcão/mesa; e o pedido do NOSSO cardápio não gravava
// escolha nenhuma — a conclusão baixava o produto sem o adicional e sem o "sem cebola".
//
// Cada teste confere o que SAIU do estoque (movimento da comanda), por todos os caminhos de venda.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('adicional-ficha.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const FATIA = 1 / 72; // kg de bacon por fatia

descrever('adicional ligado a ficha técnica: baixa de estoque, custo e repetição (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    // O banco do CI é o de uma loja: faltam as tabelas só-nuvem que o card da cozinha consulta ao
    // nascer. `create table if not exists` em paralelo com outra spec dá 23505/42P07 — é "já existe".
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
        'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto',
        'ficha_ingrediente', 'ficha_tecnica', 'item_conversao', 'item_estoque', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────
  // Bacon em kg (1 kg = 72 unidade, R$ 36 o kg → R$ 0,50 a fatia) e pão em unidade.
  // Lanche (R$ 20): ficha com 1 pão + 2 fatias de bacon.
  // Adicional "Bacon de teste" (R$ 3): opção do tipo ficha → ficha "Fatia de bacon" (1 fatia).
  type Opcoes = { regra?: string; max?: number | null; codigoPdv?: string | null; controlaEstoque?: boolean };
  async function loja(o: Opcoes = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste adicional ficha') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [t, u, ator]);

    const item = async (nome: string, unidade: string, custo: number, saldo: number) => {
      const id = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,$3,$4) returning id`, [t, nome, unidade, custo]))[0].id as string;
      await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',$3,$4)`, [t, id, saldo, custo]);
      return id;
    };
    const bacon = await item('Bacon de teste', 'kg', 36, 10);
    await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1,$2,'kg',72,'unidade')`, [t, bacon]);
    const pao = await item('Pão de teste', 'unidade', 2, 100);

    const fichaLanche: any = await fichas.create(t, {
      nome: 'Lanche de teste',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Pão de teste', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 2 },
        { insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 },
      ],
    } as any);
    const fichaFatia: any = await fichas.create(t, {
      nome: 'Fatia de bacon de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Bacon de teste', itemId: bacon, quantidade: 1, unidade: 'unidade', custoUnitario: 0.5 }],
    } as any);
    const lanche = (await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao, controla_estoque, ficha_id)
       values ($1,'LT1','Lanche de teste','20.00',false,true,$2) returning id`,
      [t, fichaLanche.id],
    ))[0].id as string;

    const opcaoCatalogo: any = await produtos.criarOpcaoCatalogo(t, {
      nome: 'Bacon de teste',
      tipo: 'ficha',
      fichaId: fichaFatia.id,
      codigoPdv: o.codigoPdv === undefined ? 'AD1' : o.codigoPdv,
      controlaEstoque: o.controlaEstoque ?? true,
    });
    const etapa: any = await produtos.criarComplemento(t, {
      nome: 'Adicionais de teste',
      regra: o.regra ?? 'varias_com_repeticao',
      max: o.max ?? null,
      itens: [{ opcaoId: opcaoCatalogo.id, preco: 3 }],
    });
    await produtos.setProdutoComplementos(t, lanche, [etapa.id]);
    return { t, u, ator, bacon, pao, lanche, fichaFatia: fichaFatia.id as string, opcaoCatalogo: opcaoCatalogo.id as string, etapa: etapa.id as string };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  /** A opção do PRODUTO (a que a tela manda), viva, nascida da opção do catálogo. */
  const opcaoDoProduto = async (l: Loja) =>
    (await q(
      `select co.id from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id
        where g.produto_id = $1 and co.origem_opcao_id = $2 and co.deleted_at is null`,
      [l.lanche, l.opcaoCatalogo],
    ))[0].id as string;
  /** O que a comanda tirou do estoque: item → { quantidade, custo unitário }. */
  async function saidas(l: Loja, comandaId: string) {
    const linhas = await q(
      `select item_id, quantidade::float8 as quantidade, custo_unitario::float8 as custo
         from movimento_estoque where tenant_id = $1 and ref_id = $2 and tipo = 'saida'`,
      [l.t, comandaId],
    );
    return new Map<string, { quantidade: number; custo: number }>(linhas.map((r: any) => [r.item_id, { quantidade: r.quantidade, custo: r.custo }]));
  }
  const escolhasGravadas = (comandaId: string) =>
    q(
      `select cic.nome, cic.tipo, cic.quantidade::float8 as quantidade, cic.preco_delta::float8 as "precoDelta"
         from comanda_item_complemento cic join comanda_item ci on ci.id = cic.comanda_item_id
        where ci.comanda_id = $1`,
      [comandaId],
    );
  /** Pedido que chega de fora (nosso cardápio ou canal): venda criada no aceite, baixa na conclusão. */
  async function pedidoDeFora(l: Loja, item: Record<string, any>) {
    const venda: any = await vendas.venderExterno(l.t, null, {
      unidadeId: l.u,
      cliente: 'Cliente de teste',
      forma: 'online',
      origem: 'delivery',
      plataforma: 'Cardápio',
      itens: [{ produtoId: l.lanche, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: 20, ...item }],
    } as any);
    const comandaId = (venda.comandaId ?? venda.comanda?.id ?? venda.id) as string;
    await vendas.baixarEstoqueExterno(l.t, comandaId);
    return comandaId;
  }

  // ── balcão ──────────────────────────────────────────────────────────────────────────────────
  it('balcão: o adicional escolhido 2 vezes cobra 2 vezes e baixa 2 porções da ficha (4 fatias no total), ao custo médio do bacon', async () => {
    const l = await loja();
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op, op] }],
      forma: 'dinheiro',
      unidadeId: l.u,
    } as any, null);

    const [cmd] = await q(`select total::float8 as total from comanda where id = $1`, [r.comandaId]);
    expect(cmd.total).toBe(26); // 20 + 2 × 3

    const gravadas = await escolhasGravadas(r.comandaId);
    expect(gravadas).toHaveLength(2); // uma linha por vez escolhida
    expect(gravadas.every((g: any) => g.nome === 'Bacon de teste' && g.precoDelta === 3)).toBe(true);

    const s = await saidas(l, r.comandaId);
    expect(s.get(l.pao)!.quantidade).toBeCloseTo(1, 9);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(4 * FATIA, 9); // 2 do lanche + 2 do adicional
    // "A ficha é o custo": a saída carrega o custo médio do insumo — R$ 0,50 por fatia.
    expect(s.get(l.bacon)!.custo).toBeCloseTo(36, 6);
    expect(s.get(l.bacon)!.quantidade * s.get(l.bacon)!.custo).toBeCloseTo(2, 6);

    const comanda: any = await vendas.getComanda(l.t, r.comandaId);
    expect(comanda.itens[0].complementosTexto).toBe('+ 2x Bacon de teste');
  });

  it('balcão, 3 lanches com 1 adicional cada: 3 porções do adicional', async () => {
    const l = await loja();
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 3, complementos: [op] }],
      forma: 'dinheiro',
      unidadeId: l.u,
    } as any, null);
    const s = await saidas(l, r.comandaId);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo((3 * 2 + 3 * 1) * FATIA, 9);
    expect(s.get(l.pao)!.quantidade).toBeCloseTo(3, 9);
  });

  // ── mesa / comanda ──────────────────────────────────────────────────────────────────────────
  it('comanda: lança com 3 adicionais, o catálogo é salvo de novo antes de fechar — e o fechamento baixa as 3 porções', async () => {
    const l = await loja();
    const op = await opcaoDoProduto(l);
    const c: any = await vendas.abrirComanda(l.t, l.ator, { cliente: 'Mesa de teste', unidadeId: l.u });
    await vendas.adicionarItem(l.t, l.ator, c.id, { produtoId: l.lanche, quantidade: 1, complementos: [op, op, op] });

    const [item] = await q(`select preco_unitario::float8 as preco from comanda_item where comanda_id = $1`, [c.id]);
    expect(item.preco).toBe(29); // 20 + 3 × 3

    // Salvar a opção no catálogo recria as opções do produto e apaga (deleted_at) as antigas:
    // a comanda aberta continua apontando para a linha antiga.
    await produtos.atualizarOpcao(l.t, l.opcaoCatalogo, {
      nome: 'Bacon de teste', tipo: 'ficha', fichaId: l.fichaFatia, codigoPdv: 'AD1', controlaEstoque: true,
    });
    expect(await opcaoDoProduto(l)).not.toBe(op);

    await vendas.fecharComanda(l.t, l.ator, 'presidente', c.id, { forma: 'dinheiro' }, null);
    const s = await saidas(l, c.id);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(5 * FATIA, 9); // 2 do lanche + 3 do adicional
  });

  // ── pedido de fora ──────────────────────────────────────────────────────────────────────────
  it('nosso cardápio: as escolhas (ids das opções) passam a ser gravadas e a conclusão baixa a ficha do adicional', async () => {
    const l = await loja();
    const op = await opcaoDoProduto(l);
    const comandaId = await pedidoDeFora(l, {
      descricao: 'Lanche de teste (2x Bacon de teste)', // como o cardápio escreve
      quantidade: 2,
      precoUnitario: 26,
      complementos: [op, op],
    });
    expect(await escolhasGravadas(comandaId)).toHaveLength(2);
    const s = await saidas(l, comandaId);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(2 * (2 + 2) * FATIA, 9); // 2 lanches × (2 + 2 fatias)
    expect(s.get(l.pao)!.quantidade).toBeCloseTo(2, 9);

    // O preço que o cardápio mandou não é mexido, e o cupom não repete o que a descrição já diz.
    const comanda: any = await vendas.getComanda(l.t, comandaId);
    expect(Number(comanda.itens[0].precoUnitario)).toBe(26);
    expect(comanda.itens[0].complementosTexto).toBeNull();
  });

  it('canal externo (código PDV do adicional, quantidade 2): baixa 2 porções da ficha', async () => {
    const l = await loja();
    const comandaId = await pedidoDeFora(l, {
      precoUnitario: 26,
      complementosCanal: [{ nome: 'Bacon extra', codigo: 'AD1', quantidade: 2 }],
    });
    const s = await saidas(l, comandaId);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(4 * FATIA, 9);
  });

  it('nosso cardápio, "sem pão" (opção de retirar ligada ao ingrediente): o ingrediente não sai do estoque', async () => {
    const l = await loja();
    const [linhaPao] = await q(
      `select fi.id from ficha_ingrediente fi join produto p on p.ficha_id = fi.ficha_id where p.id = $1 and fi.item_id = $2`,
      [l.lanche, l.pao],
    );
    const grupo = (await q(
      `insert into complemento_grupo (tenant_id, produto_id, nome, tipo) values ($1,$2,'Retirar','remover') returning id`,
      [l.t, l.lanche],
    ))[0].id as string;
    const semPao = (await q(
      `insert into complemento_opcao (tenant_id, grupo_id, nome, ficha_ingrediente_id) values ($1,$2,'Pão de teste',$3) returning id`,
      [l.t, grupo, linhaPao.id],
    ))[0].id as string;

    const comandaId = await pedidoDeFora(l, { complementos: [semPao] });
    const s = await saidas(l, comandaId);
    expect(s.has(l.pao)).toBe(false);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(2 * FATIA, 9);
  });

  // ── quando NÃO baixa ────────────────────────────────────────────────────────────────────────
  it('sem "Controlar estoque" na opção: cobra o adicional e baixa só o lanche', async () => {
    const l = await loja({ controlaEstoque: false });
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    expect((await q(`select total::float8 as total from comanda where id = $1`, [r.comandaId]))[0].total).toBe(23);
    expect((await saidas(l, r.comandaId)).get(l.bacon)!.quantidade).toBeCloseTo(2 * FATIA, 9);
  });

  it('sem código PDV a opção é informativa: não cobra nem baixa', async () => {
    const l = await loja({ codigoPdv: null });
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    expect((await q(`select total::float8 as total from comanda where id = $1`, [r.comandaId]))[0].total).toBe(20);
    expect((await saidas(l, r.comandaId)).get(l.bacon)!.quantidade).toBeCloseTo(2 * FATIA, 9);
  });

  it('ficha do adicional excluída: não baixa (a mesma regra da ficha do produto)', async () => {
    const l = await loja();
    const op = await opcaoDoProduto(l);
    await q(`update ficha_tecnica set deleted_at = now() where id = $1`, [l.fichaFatia]);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    expect((await saidas(l, r.comandaId)).get(l.bacon)!.quantidade).toBeCloseTo(2 * FATIA, 9);
  });

  // ── repetição ───────────────────────────────────────────────────────────────────────────────
  it('etapa que NÃO permite repetir: a opção repetida conta uma vez (preço e estoque)', async () => {
    const l = await loja({ regra: 'varias_sem_repeticao' });
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op, op, op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    expect((await q(`select total::float8 as total from comanda where id = $1`, [r.comandaId]))[0].total).toBe(23);
    expect(await escolhasGravadas(r.comandaId)).toHaveLength(1);
    expect((await saidas(l, r.comandaId)).get(l.bacon)!.quantidade).toBeCloseTo(3 * FATIA, 9);
  });

  it('etapa com máximo 2: a repetição não passa do máximo', async () => {
    const l = await loja({ max: 2 });
    const op = await opcaoDoProduto(l);
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 1, complementos: [op, op, op, op, op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    expect((await q(`select total::float8 as total from comanda where id = $1`, [r.comandaId]))[0].total).toBe(26);
    expect((await saidas(l, r.comandaId)).get(l.bacon)!.quantidade).toBeCloseTo(4 * FATIA, 9);
  });

  it('o produto devolve a regra de cada etapa — é por ela que o balcão e a mesa deixam repetir', async () => {
    const com = await loja({ max: 3 });
    const sem = await loja({ regra: 'varias_sem_repeticao' });
    const etapaDe = async (l: Loja) => ((await produtos.getOne(l.t, l.lanche)) as any).complementos[0];
    expect(await etapaDe(com)).toMatchObject({ regra: 'varias_com_repeticao', max: 3 });
    expect(await etapaDe(sem)).toMatchObject({ regra: 'varias_sem_repeticao' });
    // grupo criado à mão (sem complemento do catálogo por trás): não repete
    await q(`insert into complemento_grupo (tenant_id, produto_id, nome, tipo, max, ordem) values ($1,$2,'Manual de teste','adicionar',1,9), ($1,$2,'Manual livre de teste','adicionar',null,10)`, [com.t, com.lanche]);
    const todas: any[] = ((await produtos.getOne(com.t, com.lanche)) as any).complementos;
    expect(todas.find((g) => g.nome === 'Manual de teste')).toMatchObject({ regra: 'uma' });
    expect(todas.find((g) => g.nome === 'Manual livre de teste')).toMatchObject({ regra: 'varias_sem_repeticao' });
  });

  // ── o que não mudou ─────────────────────────────────────────────────────────────────────────
  it('adicional ligado direto ao insumo segue como era: 1 unidade do estoque por escolha', async () => {
    const l = await loja();
    const queijo = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,'Queijo de teste','unidade',1) returning id`, [l.t]))[0].id as string;
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',50,1)`, [l.t, queijo]);
    const opQueijo: any = await produtos.criarOpcaoCatalogo(l.t, { nome: 'Queijo de teste', tipo: 'insumo', itemId: queijo, codigoPdv: 'AD2', controlaEstoque: true });
    await produtos.atualizarComplemento(l.t, l.etapa, {
      nome: 'Adicionais de teste', regra: 'varias_com_repeticao',
      itens: [{ opcaoId: l.opcaoCatalogo, preco: 3 }, { opcaoId: opQueijo.id, preco: 2 }],
    });
    const [{ id: op }] = await q(
      `select co.id from complemento_opcao co join complemento_grupo g on g.id = co.grupo_id
        where g.produto_id = $1 and co.origem_opcao_id = $2 and co.deleted_at is null`,
      [l.lanche, opQueijo.id],
    );
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', {
      itens: [{ produtoId: l.lanche, quantidade: 2, complementos: [op] }], forma: 'dinheiro', unidadeId: l.u,
    } as any, null);
    const s = await saidas(l, r.comandaId);
    expect(s.get(queijo)!.quantidade).toBeCloseTo(2, 9);
    expect(s.get(l.bacon)!.quantidade).toBeCloseTo(4 * FATIA, 9); // só o dos 2 lanches
  });

  // ── o custo na tela de opções ───────────────────────────────────────────────────────────────
  it('lista de opções: o custo do adicional com ficha é o de UMA porção da ficha — só para quem vê custo de ficha', async () => {
    const l = await loja();
    const comCusto: any[] = await produtos.listarOpcoes(l.t, true);
    expect(comCusto.find((o) => o.id === l.opcaoCatalogo)).toMatchObject({ tipo: 'ficha', fichaNome: 'Fatia de bacon de teste', custoFicha: 0.5 });
    const semCusto: any[] = await produtos.listarOpcoes(l.t, false);
    expect(semCusto.find((o) => o.id === l.opcaoCatalogo)).toMatchObject({ fichaNome: 'Fatia de bacon de teste', custoFicha: null });

    // Ficha excluída não é vínculo: não baixa na venda, então a lista não a mostra.
    await q(`update ficha_tecnica set deleted_at = now() where id = $1`, [l.fichaFatia]);
    const depois: any[] = await produtos.listarOpcoes(l.t, true);
    expect(depois.find((o) => o.id === l.opcaoCatalogo)).toMatchObject({ fichaNome: null, custoFicha: null });
  });
});
