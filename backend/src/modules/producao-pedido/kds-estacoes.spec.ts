import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COZINHA EM ESTAÇÕES, entrega 1 (dono, 21/10/2026): cada KDS escolhe os produtos que mostra ("Configurar este KDS").
//  • sem KDS com produtos, tudo como antes: um cartão por venda, sem destino, e as vias de sempre;
//  • em estações: um cartão por KDS com os itens dele; o item de KDS não sai em papel (só numa impressora escolhida para
//    ele); o item que nenhum KDS marcou vai num cartão de PAPEL (fora de qualquer KDS) e sai na impressora — sem
//    impressora, na PADRÃO (a reserva da cozinha), mesmo com setor;
//  • o pedido só fica pronto (canal) quando todos os cartões de KDS da venda ficam prontos;
//  • o servidor da loja imprime com a mesma regra (materializarProducaoLocal).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-estacoes.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('Cozinha em estações — produtos por KDS (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: ProducaoPedidoService;
  const auditado: any[] = [];
  const emitidos: { nome: string; dado: any }[] = [];
  const antes = process.env.EDGE_MODE;
  const T = randomUUID();
  const OUTRA = randomUUID();
  const U = randomUUID();
  const COZ = randomUUID();
  const CHAPA = randomUUID();
  const FRITA = randomUUID();
  const DESLIGADO = randomUUID();
  const IMP_COZ = randomUUID();
  const IMP_BAR = randomUUID();
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const p: Record<string, any> = {};

  const produto = async (nome: string, setor: string | null, tenant = T) => {
    const id = randomUUID();
    await q(`insert into produto (id, tenant_id, nome, vai_para_producao, setor_producao_id) values ($1,$2,$3,true,$4)`, [id, tenant, nome, setor]);
    const [row] = await db.select().from(schema.produto).where(eq(schema.produto.id, id));
    return row;
  };
  const destino = (produtoId: string, equipamentoId: string) =>
    q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [T, produtoId, equipamentoId]);
  const vender = async (itens: { prod: any; qtd?: number }[]) => {
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',7,'B') returning id`, [T, U]))[0].id;
    const payloads = await db.transaction((tx: any) =>
      svc.criarPedidos(
        tx,
        { tenantId: T, unidadeId: U, comandaId: cmd, origem: 'balcao', senha: 7, senhaPrefixo: 'B' },
        itens.map(({ prod, qtd }) => ({ produto: prod, descricao: prod.nome, quantidade: qtd ?? 1, opcaoIds: [] }) as any),
      ),
    );
    const cartoes = await q(
      `select pp.id, pp.destino_equipamento_id as destino, pp.destino_tipo as tipo, pp.numero,
              array(select i.descricao from producao_pedido_item i where i.pedido_id = pp.id order by i.descricao) as itens
         from producao_pedido pp where pp.comanda_id = $1 order by pp.destino_tipo, pp.destino_equipamento_id nulls last`,
      [cmd],
    );
    return { cmd, payloads, cartoes, vias: await vias(cmd) };
  };
  const vias = async (cmd: string) =>
    (await q(`select e.nome, j.conteudo from impressao_job j join equipamento e on e.id = j.equipamento_id
               where j.comanda_id = $1 and j.via = 'producao' order by e.nome`, [cmd])).map((v: any) => ({ nome: v.nome, conteudo: String(v.conteudo) }));
  const doCartao = (cartoes: any[], destino: string | null, tipo = 'kds') => cartoes.find((c) => c.destino === destino && c.tipo === tipo);

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true'; // caminho do servidor local (edgeAtivo = false): as vias são gravadas aqui
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    svc = new ProducaoPedidoService(
      db,
      { registrar: async (e: any) => void auditado.push(e) } as any,
      { emit: (nome: string, dado: any) => (emitidos.push({ nome, dado }), true) } as any,
    );
    await q(`insert into empresa (id, nome) values ($1,'teste estações'), ($2,'outra empresa')`, [T, OUTRA]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [U, T]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values ($1,$2,$3,'Cozinha')`, [COZ, T, U]);
    const kds = (id: string, nome: string, ativo = true) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, ativo) values ($1,$2,$3,$4,$5,'kds',$6)`, [id, T, U, nome, 'tok-' + id, ativo]);
    await kds(CHAPA, 'Chapa');
    await kds(FRITA, 'Fritadeira');
    await kds(DESLIGADO, 'Desligado', false);
    const imp = (id: string, nome: string, padrao: boolean) =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, conexao, host, faz_producao, padrao, ativo)
         values ($1,$2,$3,$4,$5,'impressora','rede','10.0.0.9',true,$6,true)`, [id, T, U, nome, 'tok-' + id, padrao]);
    await imp(IMP_COZ, 'Cozinha', true);
    await imp(IMP_BAR, 'Bar', false);
    p.burger = await produto('Burger', COZ);
    p.salada = await produto('X-Salada', COZ);
    p.batata = await produto('Batata', COZ);
    p.refri = await produto('Refri', null);
    p.sobremesa = await produto('Sobremesa', COZ);
    p.milk = await produto('Milkshake', COZ);
    p.daOutra = await produto('Da outra empresa', null, OUTRA);
  });

  afterAll(async () => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of ['impressao_job', 'producao_pedido_item', 'producao_pedido', 'comanda_item', 'comanda', 'produto_destino_producao', 'produto', 'equipamento', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await pool.end();
  });

  it('sem KDS com produtos: um cartão por venda, sem destino, e as vias de sempre', async () => {
    const v = await vender([{ prod: p.burger }, { prod: p.refri }]);
    expect(v.cartoes).toEqual([expect.objectContaining({ destino: null, tipo: 'kds', itens: ['Burger', 'Refri'] })]);
    // Como sempre: o item com setor e sem impressora para o setor não sai em papel; o sem setor sai na padrão.
    expect(v.vias.map((x) => x.nome)).toEqual(['Cozinha']);
    expect(v.vias[0].conteudo).toContain('Refri');
    expect(v.vias[0].conteudo).not.toContain('Burger');
    expect(v.payloads).toHaveLength(1);
  });

  it('"Configurar este KDS" grava a lista inteira (entra o marcado, sai o desmarcado), audita e recusa o que não serve', async () => {
    expect(await svc.setProdutosDoKds(T, CHAPA, [p.burger.id])).toMatchObject({ entraram: 1, sairam: 0 });
    expect(await svc.setProdutosDoKds(T, CHAPA, [p.burger.id, p.salada.id, p.salada.id])).toMatchObject({ entraram: 1, sairam: 0 });
    expect(await svc.setProdutosDoKds(T, CHAPA, [p.salada.id])).toMatchObject({ entraram: 0, sairam: 1 });
    expect(await svc.setProdutosDoKds(T, CHAPA, [p.salada.id])).toMatchObject({ entraram: 0, sairam: 0 });
    expect((await svc.produtosDoKds(T, CHAPA)).produtoIds).toEqual([p.salada.id]);
    expect(auditado.filter((a) => a.acao === 'configurou_produtos_kds')).toHaveLength(3); // a 4ª não mudou nada
    expect(auditado[0]).toMatchObject({ tenantId: T, entidadeTipo: 'kds', entidadeId: CHAPA, detalhe: expect.objectContaining({ kds: 'Chapa' }) });

    await expect(svc.setProdutosDoKds(T, CHAPA, [p.daOutra.id])).rejects.toThrow(/não é desta empresa/);
    await expect(svc.setProdutosDoKds(T, CHAPA, ['nao-e-uuid'])).rejects.toThrow(/não é produto/);
    await expect(svc.setProdutosDoKds(T, CHAPA, 'x' as any)).rejects.toThrow(/lista de produtos/);
    await expect(svc.setProdutosDoKds(T, DESLIGADO, [p.burger.id])).rejects.toThrow(/desligado/);
    await expect(svc.setProdutosDoKds(T, IMP_COZ, [p.burger.id])).rejects.toThrow(/KDS não encontrado/);
    await expect(svc.setProdutosDoKds(OUTRA, CHAPA, [])).rejects.toThrow(/KDS não encontrado/);

    // A lista das telas para o "Este KDS": só as ligadas.
    expect((await svc.telasDeKds(T, U)).map((k: any) => k.nome)).toEqual(['Chapa', 'Fritadeira']);
  });

  it('em estações: um cartão por KDS, o papel fora do KDS e a reserva da cozinha (mesmo com setor)', async () => {
    await svc.setProdutosDoKds(T, CHAPA, [p.burger.id]);
    await svc.setProdutosDoKds(T, FRITA, [p.batata.id]);
    await destino(p.refri.id, IMP_BAR); // o refri tem a impressora dele
    const v = await vender([{ prod: p.burger, qtd: 2 }, { prod: p.batata }, { prod: p.refri }, { prod: p.sobremesa }]);

    expect(v.cartoes).toHaveLength(3);
    expect(doCartao(v.cartoes, CHAPA)).toMatchObject({ itens: ['Burger'] });
    expect(doCartao(v.cartoes, FRITA)).toMatchObject({ itens: ['Batata'] });
    expect(doCartao(v.cartoes, null, 'impressora')).toMatchObject({ itens: ['Refri', 'Sobremesa'] });
    expect(new Set(v.cartoes.map((c: any) => c.numero)).size).toBe(1); // o mesmo número da venda
    expect(v.payloads.map((x: any) => x.destinoEquipamentoId).sort()).toEqual([CHAPA, FRITA, null].sort());

    // Papel: o refri na impressora dele; a sobremesa (com setor, sem KDS nem impressora) na padrão; nada do que tem KDS.
    expect(v.vias.map((x) => x.nome)).toEqual(['Bar', 'Cozinha']);
    expect(v.vias[0].conteudo).toContain('Refri');
    expect(v.vias[1].conteudo).toContain('Sobremesa');
    for (const via of v.vias) for (const nome of ['Burger', 'Batata']) expect(via.conteudo).not.toContain(nome);

    // Cada KDS vê só o cartão dele; a fila geral vê os dois de KDS e nunca o de papel.
    const fila = async (equipamentoId?: string) =>
      ((await svc.filaKds(T, { unidadeId: U, equipamentoId })) as any).pedidos.filter((c: any) => c.comandaId === v.cmd).map((c: any) => c.id).sort();
    expect(await fila(CHAPA)).toEqual([doCartao(v.cartoes, CHAPA).id]);
    expect(await fila(FRITA)).toEqual([doCartao(v.cartoes, FRITA).id]);
    expect(await fila()).toEqual([doCartao(v.cartoes, CHAPA).id, doCartao(v.cartoes, FRITA).id].sort());
  });

  it('o produto de KDS com impressora própria aparece no KDS e sai também nela', async () => {
    await svc.setProdutosDoKds(T, CHAPA, [p.burger.id, p.milk.id]);
    await destino(p.milk.id, IMP_BAR);
    const v = await vender([{ prod: p.milk }]);
    expect(v.cartoes).toEqual([expect.objectContaining({ destino: CHAPA, tipo: 'kds', itens: ['Milkshake'] })]);
    expect(v.vias.map((x) => x.nome)).toEqual(['Bar']);
  });

  it('o pedido só fica pronto quando TODOS os cartões de KDS ficam prontos; o de papel não segura e já conta como começado', async () => {
    const v = await vender([{ prod: p.burger }, { prod: p.batata }, { prod: p.sobremesa }]);
    expect(doCartao(v.cartoes, null, 'impressora')).toMatchObject({ itens: ['Sobremesa'] });
    const chapa = doCartao(v.cartoes, CHAPA).id;
    const frita = doCartao(v.cartoes, FRITA).id;
    // O papel começou no aceite (a "perda" do cancelamento tem o que baixar), mesmo com os KDS na fila.
    expect(await svc.producaoIniciada(T, v.cmd)).toBe(true);
    await svc.avancar(T, randomUUID(), chapa); // recebido → preparo
    await svc.avancar(T, randomUUID(), chapa); // preparo → pronto
    expect(await svc.comandaTodaPronta(T, v.cmd)).toBe(false); // a Fritadeira ainda está fazendo
    await svc.avancar(T, randomUUID(), frita);
    await svc.avancar(T, randomUUID(), frita);
    expect(await svc.comandaTodaPronta(T, v.cmd)).toBe(true); // o cartão de papel (recebido) não segura
    // O KDS avisa a cada cartão pronto; quem decide é o ouvinte (ERR-148), por `comandaTodaPronta`.
    expect(emitidos.filter((e) => e.nome === 'producao.pronto' && e.dado?.comandaId === v.cmd)).toHaveLength(2);
  });

  it('o servidor da loja imprime a venda da nuvem com a mesma regra (o KDS não sai em papel)', async () => {
    // A venda feita na nuvem desce com a comanda e os cartões; aqui sai só o papel.
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',9,'D') returning id`, [T, U]))[0].id;
    for (const prod of [p.burger, p.refri, p.sobremesa])
      await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1,$2,$3,$4,1,10)`, [T, cmd, prod.id, prod.nome]);
    await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_equipamento_id, destino_tipo, origem, status, senha, senha_prefixo)
             values ($1,$2,$3,$4,'kds','delivery','recebido',9,'D')`, [T, U, cmd, CHAPA]);
    expect(await svc.materializarProducaoLocal(T, cmd)).toBe(2);
    const v = await vias(cmd);
    expect(v.map((x) => x.nome)).toEqual(['Bar', 'Cozinha']);
    expect(v[0].conteudo).toContain('Refri');
    expect(v[1].conteudo).toContain('Sobremesa');
    for (const via of v) expect(via.conteudo).not.toContain('Burger');
  });
});
