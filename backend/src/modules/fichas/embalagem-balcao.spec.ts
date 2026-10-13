import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from '../cardapio/cardapio.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoService } from '../producao/producao.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { FichasService } from './fichas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EMBALAGEM DO BALCÃO NA FICHA TÉCNICA — contra Postgres (TEST_PG_URL), com os serviços de verdade.
//
// Pedido do dono (12/10/2026): a ficha já tinha o "custo do delivery" (embalagem só do pedido
// externo); faltava a embalagem do BALCÃO, para a loja que embala diferente nos dois. E uma chave,
// da loja inteira, para quem usa a MESMA embalagem: fica só o cadastro do delivery, valendo para as
// duas vendas. Resposta dele: "quando venda no balcão interpretar os custos do balcão, quando venda
// do delivery considerar custos do delivery, se o cliente usar os dois cadastros".
//
// Cada teste confere o CUSTO que a ficha mostra e o que SAIU do estoque (o movimento da comanda),
// pelos quatro caminhos de venda: balcão, comanda/mesa, totem e pedido que chega de fora.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('embalagem-balcao.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('embalagem do balcão e do delivery na ficha técnica (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db, auditoria);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
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
        'produto', 'categoria_produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_estoque', 'entitlement', 'equipamento',
        'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste (valores inventados) ──────────────────────────────────────────────────────
  // Lanche LT1 (R$ 20): 1 pão (R$ 2,00) + papel do BALCÃO (R$ 0,30) + caixa do DELIVERY (R$ 1,50).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste embalagem balcao') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, aberta_por_id) values ($1,$2,'aberta','pdv',$3)`, [t, u, ator]);
    const totem = (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo) values ($1,$2,'totem','Totem de teste',$3,true) returning id`, [t, u, randomUUID()]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const item = async (nome: string, custo: number, saldo: number) => {
      const id = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,'unidade',$3) returning id`, [t, nome, custo]))[0].id as string;
      if (saldo > 0) await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'entrada',$3,$4)`, [t, id, saldo, custo]);
      return id;
    };
    const pao = await item('Pão de teste', 2, 100);
    const papel = await item('Papel do balcão de teste', 0.3, 50);
    const caixa = await item('Caixa do delivery de teste', 1.5, 50);
    const ficha: any = await fichas.create(t, {
      nome: 'Lanche de teste',
      rendimento: 1,
      precoVenda: 20,
      ingredientes: [
        { insumoNome: 'Pão de teste', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 2 },
        { insumoNome: 'Papel do balcão de teste', itemId: papel, quantidade: 1, unidade: 'unidade', custoUnitario: 0.3, somenteBalcao: true },
        { insumoNome: 'Caixa do delivery de teste', itemId: caixa, quantidade: 1, unidade: 'unidade', custoUnitario: 1.5, somenteDelivery: true },
      ],
    } as any);
    const lanche = (await q(
      `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, ficha_id)
       values ($1,'LT1','Lanche de teste',$2,'20.00',false,true,$3) returning id`,
      [t, categoria, ficha.id],
    ))[0].id as string;
    return { t, u, ator, totem, pao, papel, caixa, ficha: ficha.id as string, lanche };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  /** O que a comanda tirou do estoque, pelo nome do que saiu. */
  async function saiu(l: Loja, comandaId: string) {
    const linhas = await q(
      `select item_id, quantidade::float8 as quantidade from movimento_estoque where tenant_id = $1 and ref_id = $2 and tipo = 'saida'`,
      [l.t, comandaId],
    );
    const nome: Record<string, string> = { [l.pao]: 'pão', [l.papel]: 'papel do balcão', [l.caixa]: 'caixa do delivery' };
    return Object.fromEntries(linhas.map((r: any) => [nome[r.item_id] ?? r.item_id, r.quantidade]).sort());
  }
  const noBalcao = async (l: Loja) => {
    const r: any = await vendas.vendaBalcao(l.t, l.ator, 'presidente', { itens: [{ produtoId: l.lanche, quantidade: 1 }], forma: 'dinheiro', unidadeId: l.u } as any, null);
    return saiu(l, r.comandaId);
  };
  const naComanda = async (l: Loja) => {
    const c: any = await vendas.abrirComanda(l.t, l.ator, { cliente: 'Mesa de teste', unidadeId: l.u });
    await vendas.adicionarItem(l.t, l.ator, c.id, { produtoId: l.lanche, quantidade: 1 });
    await vendas.fecharComanda(l.t, l.ator, 'presidente', c.id, { forma: 'dinheiro' }, null);
    return saiu(l, c.id);
  };
  const noTotem = async (l: Loja) => {
    const r: any = await vendas.venderTotem(l.t, { unidadeId: l.u, equipamentoId: l.totem }, {
      idempotencyKey: randomUUID(), itens: [{ codigoPdv: 'LT1', quantidade: 1 }], pagamentos: [{ forma: 'credito', valor: 20 }], plataforma: 'GoGeM Totem',
    } as any);
    return saiu(l, r.comandaId);
  };
  /** Pedido que chega de fora (nosso cardápio ou canal): venda criada no aceite, baixa na conclusão. */
  const deFora = async (l: Loja, comEmbalagem = true) => {
    const venda: any = await vendas.venderExterno(l.t, null, {
      unidadeId: l.u, cliente: 'Cliente de teste', forma: 'online', origem: 'delivery', plataforma: 'Cardápio',
      itens: [{ produtoId: l.lanche, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: 20 }],
    } as any);
    const comandaId = (venda.comandaId ?? venda.comanda?.id ?? venda.id) as string;
    await vendas.baixarEstoqueExterno(l.t, comandaId, comEmbalagem);
    return saiu(l, comandaId);
  };

  // ── cadastro ──────────────────────────────────────────────────────────────────────────────────
  it('a ficha guarda de que venda é cada linha, e recusa a que vem como balcão E delivery', async () => {
    const l = await loja();
    expect(await q(`select insumo_nome, somente_balcao, somente_delivery from ficha_ingrediente where ficha_id = $1 and deleted_at is null order by ordem`, [l.ficha])).toEqual([
      { insumo_nome: 'Pão de teste', somente_balcao: false, somente_delivery: false },
      { insumo_nome: 'Papel do balcão de teste', somente_balcao: true, somente_delivery: false },
      { insumo_nome: 'Caixa do delivery de teste', somente_balcao: false, somente_delivery: true },
    ]);
    // a tela recebe a marca de volta (é por ela que a linha aparece no bloco certo)
    const f: any = await fichas.getOne(l.t, l.ficha);
    expect(f.ingredientes.map((i: any) => [i.somenteBalcao, i.somenteDelivery])).toEqual([[false, false], [true, false], [false, true]]);

    const dosDois = { insumoNome: 'Sacola de teste', quantidade: 1, unidade: 'unidade', custoUnitario: 1, somenteBalcao: true, somenteDelivery: true };
    await expect(fichas.update(l.t, l.ficha, { ingredientes: [dosDois] } as any)).rejects.toThrow(BadRequestException);
    await expect(fichas.update(l.t, l.ficha, { ingredientes: [dosDois] } as any)).rejects.toThrow('"Sacola de teste" está como embalagem do balcão e do delivery ao mesmo tempo. Escolha um dos dois.');
    await expect(fichas.create(l.t, { nome: 'Ficha recusada de teste', rendimento: 1, ingredientes: [dosDois] } as any)).rejects.toThrow(/ao mesmo tempo/);
    await expect(fichas.addIngrediente(l.t, l.ficha, dosDois as any)).rejects.toThrow(/ao mesmo tempo/);
    // a recusa veio antes de gravar: as três linhas de antes continuam lá e a ficha recusada não nasceu
    expect((await q(`select count(*)::int as n from ficha_ingrediente where ficha_id = $1 and deleted_at is null`, [l.ficha]))[0].n).toBe(3);
    expect(await q(`select 1 from ficha_tecnica where tenant_id = $1 and nome = 'Ficha recusada de teste'`, [l.t])).toHaveLength(0);
    // o banco também não aceita (guarda dos outros caminhos)
    await expect(
      q(`insert into ficha_ingrediente (tenant_id, ficha_id, insumo_nome, somente_balcao, somente_delivery) values ($1,$2,'Direto no banco',true,true)`, [l.t, l.ficha]),
    ).rejects.toMatchObject({ code: '23514' });
  });

  // ── custo ─────────────────────────────────────────────────────────────────────────────────────
  it('dois cadastros (o padrão): o custo do balcão soma o papel, o do delivery soma a caixa; a chave troca a conta e fica na auditoria', async () => {
    const l = await loja();
    let f: any = await fichas.getOne(l.t, l.ficha);
    expect(f).toMatchObject({ custoTotal: 2.3, custoPorcao: 2.3, cmv: 11.5, custoTotalDelivery: 3.5, custoPorcaoDelivery: 3.5, cmvDelivery: 17.5, temCustoDelivery: true });
    expect(((await fichas.list(l.t)) as any[]).find((x) => x.id === l.ficha)).toMatchObject({ custoPorcao: 2.3, custoPorcaoDelivery: 3.5 });
    expect((await fichas.custoPorPorcao(l.t))[l.ficha]).toEqual({ balcao: 2.3, delivery: 3.5 });
    expect(await fichas.embalagemConfig(l.t)).toEqual({ mesmaEmbalagem: false, fichasComEmbalagemDoDelivery: 1, fichasComEmbalagemDoBalcao: 1 });

    // liga a chave: fica um cadastro só, o do delivery, valendo para as duas vendas
    registros.length = 0;
    expect(await fichas.setEmbalagemConfig(l.t, true, { colaboradorId: l.ator, categoria: 'presidente' })).toEqual({
      mesmaEmbalagem: true, fichasComEmbalagemDoDelivery: 1, fichasComEmbalagemDoBalcao: 1,
    });
    expect(registros).toHaveLength(1);
    expect(registros[0]).toMatchObject({ tenantId: l.t, atorId: l.ator, atorPerfil: 'presidente', acao: 'ficha_mesma_embalagem', detalhe: { de: false, para: true } });
    f = await fichas.getOne(l.t, l.ficha);
    expect(f).toMatchObject({ custoTotal: 3.5, custoPorcao: 3.5, custoTotalDelivery: 3.5, custoPorcaoDelivery: 3.5, temCustoDelivery: false });
    expect((await fichas.custoPorPorcao(l.t))[l.ficha]).toEqual({ balcao: 3.5, delivery: 3.5 });
    // a linha do balcão continua guardada (volta se a chave for desligada)
    expect(f.ingredientes.filter((i: any) => i.somenteBalcao)).toHaveLength(1);

    // ligar de novo o que já está ligado não escreve outra linha de auditoria
    await fichas.setEmbalagemConfig(l.t, true, { colaboradorId: l.ator, categoria: 'presidente' });
    expect(registros).toHaveLength(1);
    await fichas.setEmbalagemConfig(l.t, false, { colaboradorId: l.ator, categoria: 'presidente' });
    expect(registros).toHaveLength(2);
    expect((await fichas.getOne(l.t, l.ficha)) as any).toMatchObject({ custoTotal: 2.3, custoTotalDelivery: 3.5 });
  });

  it('a chave é da empresa: ligar numa não mexe na outra', async () => {
    const a = await loja();
    const b = await loja();
    await fichas.setEmbalagemConfig(a.t, true);
    expect((await fichas.embalagemConfig(a.t)).mesmaEmbalagem).toBe(true);
    expect((await fichas.embalagemConfig(b.t)).mesmaEmbalagem).toBe(false);
    expect(await noBalcao(b)).toEqual({ 'papel do balcão': 1, pão: 1 });
  });

  // ── baixa de estoque ──────────────────────────────────────────────────────────────────────────
  it('dois cadastros: balcão, comanda e totem baixam o papel do balcão; o pedido de fora baixa a caixa do delivery', async () => {
    const l = await loja();
    expect(await noBalcao(l)).toEqual({ 'papel do balcão': 1, pão: 1 });
    expect(await naComanda(l)).toEqual({ 'papel do balcão': 1, pão: 1 });
    expect(await noTotem(l)).toEqual({ 'papel do balcão': 1, pão: 1 });
    expect(await deFora(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    // cancelado como perda ainda na cozinha: o pão se perdeu, a embalagem nem chegou a ser usada
    expect(await deFora(l, false)).toEqual({ pão: 1 });
  });

  it('mesma embalagem: as quatro vendas baixam a caixa (o cadastro do delivery) e ninguém baixa o papel', async () => {
    const l = await loja();
    await fichas.setEmbalagemConfig(l.t, true);
    expect(await noBalcao(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    expect(await naComanda(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    expect(await noTotem(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    expect(await deFora(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    expect(await deFora(l, false)).toEqual({ pão: 1 });
  });

  it('loja que não cadastra embalagem de balcão segue como sempre: o balcão baixa só os ingredientes', async () => {
    const l = await loja();
    await q(`update ficha_ingrediente set deleted_at = now() where ficha_id = $1 and somente_balcao`, [l.ficha]);
    expect(await noBalcao(l)).toEqual({ pão: 1 });
    expect(await deFora(l)).toEqual({ 'caixa do delivery': 1, pão: 1 });
    expect((await fichas.getOne(l.t, l.ficha)) as any).toMatchObject({ custoTotal: 2, custoTotalDelivery: 3.5 });
  });

  // ── quem NÃO usa embalagem ────────────────────────────────────────────────────────────────────
  it('produção interna e "quantos dá para vender" olham só os ingredientes; o cardápio online não esgota pela embalagem do balcão', async () => {
    const l = await loja();
    const consumo = new Map<string, number>();
    const custo = await (ProducaoService.prototype as any).explodir.call(ProducaoService.prototype, db, l.t, l.ficha, 1, consumo, new Set(), { unidadeId: null, refId: randomUUID() });
    expect(Object.fromEntries(consumo)).toEqual({ [l.pao]: 1 });
    expect(custo).toBeCloseTo(2, 9);

    // o papel do balcão acabou: ainda dá para vender 100 (o pão), e o cardápio online não marca "Esgotado"
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'saida',50,0.3)`, [l.t, l.papel]);
    expect(await vendas.disponibilidadeProduto(l.t, l.lanche)).toEqual({ disponivel: 100, podeEncomendar: true });
    const u = undefined as any;
    const esgotados = async () => {
      const cardapio = new CardapioService(db, u, u, u, u, u, u, u);
      const produtos = await q(`select id, tipo, ficha_id as "fichaId", item_id as "itemId", controla_estoque as "controlaEstoque" from produto where id = $1`, [l.lanche]);
      return [...(await (cardapio as any).computeEsgotados(l.t, produtos))];
    };
    expect(await esgotados()).toEqual([]);
    // a caixa do delivery acabou: aí sim o cardápio online esgota (é a embalagem dele) — como já era
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, custo_unitario) values ($1,$2,'saida',50,1.5)`, [l.t, l.caixa]);
    expect(await esgotados()).toEqual([l.lanche]);
  });
});
