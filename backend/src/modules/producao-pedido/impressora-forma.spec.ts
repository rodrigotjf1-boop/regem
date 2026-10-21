import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { ProducaoPedidoService, TITULO_OUTROS_ITENS } from './producao-pedido.service';
import { EquipamentoService } from '../equipamento/equipamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COZINHA EM ESTAÇÕES, entrega 3 (dono, 21/10/2026): cada impressora de produção com a sua FORMA de imprimir (mig 335).
//  • 'itens' (o padrão, como sempre): só os itens desta impressora;
//  • 'completo': o pedido inteiro — os desta impressora em negrito, os outros em letra pequena com o destino entre
//    parênteses ("1x Refri (Despacho)"), depois de "TAMBEM NO PEDIDO";
//  • a forma se grava sem apagar o resto da impressora (ERR-174 / V16), e o valor torto é recusado;
//  • vale na venda da nuvem e no servidor da loja (a mesma rotina), com e sem estações, e na via com perfil da loja;
//  • de carona: o ticket da etapa do KDS sai com a origem da senha ("B-7"), não só "7".
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('impressora-forma.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('Cozinha em estações — a forma de cada impressora (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: ProducaoPedidoService;
  let equip: EquipamentoService;
  const auditado: any[] = [];
  const antes = process.env.EDGE_MODE;
  const T = randomUUID();
  const U = randomUUID();
  const COZ = randomUUID(); // setor
  const [CHAPA, DESP, ETAPA] = [randomUUID(), randomUUID(), randomUUID()];
  let impCoz = '';
  let impBar = '';
  const ATOR = { id: randomUUID(), perfil: 'gerente' };
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const p: Record<string, any> = {};

  const produto = async (nome: string, setor: string | null) => {
    const id = randomUUID();
    await q(`insert into produto (id, tenant_id, nome, vai_para_producao, setor_producao_id) values ($1,$2,$3,true,$4)`, [id, T, nome, setor]);
    const [row] = await db.select().from(schema.produto).where(eq(schema.produto.id, id));
    return row;
  };
  const destino = (produtoId: string, equipamentoId: string) =>
    q(`insert into produto_destino_producao (tenant_id, produto_id, equipamento_id) values ($1,$2,$3)`, [T, produtoId, equipamentoId]);
  let senha = 40;
  const vender = async (itens: any[]) => {
    const s = ++senha;
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',$3,'B') returning id`, [T, U, s]))[0].id;
    await db.transaction((tx: any) =>
      svc.criarPedidos(
        tx,
        { tenantId: T, unidadeId: U, comandaId: cmd, origem: 'balcao', senha: s, senhaPrefixo: 'B' },
        itens.map((prod) => ({ produto: prod, descricao: prod.nome, quantidade: 1, opcaoIds: [] }) as any),
      ),
    );
    return { cmd, vias: await vias(cmd) };
  };
  // As vias de produção da venda, por impressora: as linhas de cada uma.
  const vias = async (cmd: string) => {
    const rows = await q(`select equipamento_id as eq, conteudo from impressao_job where comanda_id = $1 and via = 'producao'`, [cmd]);
    return new Map<string, string[]>(rows.map((r: any) => [r.eq, String(r.conteudo).split('\n')]));
  };

  beforeAll(async () => {
    process.env.EDGE_MODE = 'true'; // caminho do servidor local (edgeAtivo = false): as vias são gravadas aqui
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
    svc = new ProducaoPedidoService(db, auditoria, { emit: () => true } as any);
    equip = new EquipamentoService(db, auditoria);
    await q(`insert into empresa (id, nome) values ($1,'teste forma da via')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [U, T]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values ($1,$2,$3,'Cozinha')`, [COZ, T, U]);
    const kds = (id: string, nome: string, escopo = 'producao') =>
      q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, ativo, escopo) values ($1,$2,$3,$4,$5,'kds',true,$6)`, [id, T, U, nome, 'tok-' + id, escopo]);
    await kds(CHAPA, 'Chapa');
    await kds(DESP, 'Despacho', 'despacho');
    p.burger = await produto('Burger', COZ);
    p.suco = await produto('Suco', null);
    p.refri = await produto('Refri', null);
    p.sobremesa = await produto('Sobremesa', COZ);
  });

  afterAll(async () => {
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of ['impressao_job', 'producao_pedido_item', 'producao_pedido', 'comanda_item', 'comanda', 'produto_destino_producao', 'produto', 'equipamento', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('a forma se grava sem apagar o resto da impressora; ausente mantém; valor torto é recusado', async () => {
    const coz = await equip.salvarImpressora(T, {
      unidadeId: U, nome: 'Cozinha', papel: 'producao', conexao: 'rede', host: '10.0.0.9', porta: 9100,
      largura: 58, codepage: 'cp860', setoresAtendidos: [COZ], padrao: true,
    }, ATOR);
    impCoz = coz.id;
    expect(coz.formaProducao).toBe('itens'); // o padrão: como sempre foi
    const linha = async () =>
      (await q(`select nome, largura, codepage, setores_atendidos, padrao, faz_producao, forma_producao from equipamento where id = $1`, [impCoz]))[0];
    const antesDaForma = await linha();

    expect((await equip.salvarImpressora(T, { id: impCoz, formaProducao: 'completo' }, ATOR)).formaProducao).toBe('completo');
    expect(await linha()).toEqual({ ...antesDaForma, forma_producao: 'completo' }); // o resto ficou como estava (ERR-174)

    await equip.salvarImpressora(T, { id: impCoz, nome: 'Cozinha' }, ATOR); // outra tela salvando outro campo
    expect((await linha()).forma_producao).toBe('completo');

    await expect(equip.salvarImpressora(T, { id: impCoz, formaProducao: 'agrupado' }, ATOR)).rejects.toThrow(/Forma de impressão inválida/);
    expect((await linha()).forma_producao).toBe('completo');
    expect(auditado.filter((a) => a.acao === 'editou_impressora').map((a) => a.detalhe?.formaProducao)).toContain('completo');

    impBar = (await equip.salvarImpressora(T, { unidadeId: U, nome: 'Bar', papel: 'producao', conexao: 'rede', host: '10.0.0.8', porta: 9100 }, ATOR)).id;

    // O cadastro de impressora nova pela tela de Equipamentos também aceita a forma (e só as duas que existem).
    const nova: any = await equip.criar(T, ATOR.id, ATOR.perfil, {
      tipo: 'impressora', nome: 'Passagem', unidadeId: U, conexao: 'rede', host: '10.0.0.7', porta: 9100, fazProducao: true, formaProducao: 'completo',
    } as any);
    expect(nova.formaProducao).toBe('completo');
    await q(`delete from equipamento where id = $1`, [nova.id]);
  });

  it('sem estações: a impressora no "pedido completo" mostra os itens das outras com o destino; a de "só os itens", só os dela', async () => {
    await destino(p.burger.id, impCoz);
    await destino(p.suco.id, impBar);
    const v = await vender([p.burger, p.suco]);
    expect(v.vias.get(impCoz)).toEqual(expect.arrayContaining(['@B 1x Burger', `@S ${TITULO_OUTROS_ITENS}`, '@S 1x Suco (Bar)']));
    const bar = v.vias.get(impBar)!;
    expect(bar).toContain('1x Suco');
    expect(bar.join('\n')).not.toMatch(/Burger|TAMBEM|@B|@S/); // só os itens dela, como sempre
  });

  it('em estações: os outros itens dizem a estação (KDS) ou a impressora para onde vão', async () => {
    await q(`delete from produto_destino_producao where tenant_id = $1 and produto_id = $2 and equipamento_id = $3`, [T, p.burger.id, impCoz]);
    await svc.setProdutosDoKds(T, CHAPA, [p.burger.id]);
    await svc.setProdutosDoKds(T, DESP, [p.refri.id]); // a bebida vai direto ao despacho
    const v = await vender([p.burger, p.refri, p.suco, p.sobremesa]);
    const coz = v.vias.get(impCoz)!; // a reserva da cozinha (padrão) leva a sobremesa, que nenhum KDS marcou
    expect(coz).toEqual(
      expect.arrayContaining(['@B 1x Sobremesa', `@S ${TITULO_OUTROS_ITENS}`, '@S 1x Burger (Chapa)', '@S 1x Refri (Despacho)', '@S 1x Suco (Bar)']),
    );
    // Os de outro lugar vêm depois dos desta impressora, na ordem da venda.
    const i = (l: string) => coz.indexOf(l);
    expect(i('@B 1x Sobremesa')).toBeLessThan(i(`@S ${TITULO_OUTROS_ITENS}`));
    expect(i('@S 1x Burger (Chapa)')).toBeLessThan(i('@S 1x Refri (Despacho)'));
    expect(v.vias.get(impBar)).toContain('1x Suco');
    expect(v.vias.get(impBar)!.join('\n')).not.toMatch(/TAMBEM/);
  });

  it('o servidor da loja imprime a venda da nuvem com a mesma forma', async () => {
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',77,'D') returning id`, [T, U]))[0].id;
    for (const prod of [p.burger, p.refri, p.sobremesa])
      await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1,$2,$3,$4,1,10)`, [T, cmd, prod.id, prod.nome]);
    await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_equipamento_id, destino_tipo, origem, status, senha, senha_prefixo)
             values ($1,$2,$3,$4,'kds','delivery','recebido',77,'D')`, [T, U, cmd, CHAPA]);
    expect(await svc.materializarProducaoLocal(T, cmd)).toBe(1);
    expect((await vias(cmd)).get(impCoz)).toEqual(expect.arrayContaining(['@B 1x Sobremesa', '@S 1x Burger (Chapa)', '@S 1x Refri (Despacho)']));
  });

  it('na via com perfil da loja: os desta impressora em negrito, os outros pequenos (o alinhamento do perfil vale)', () => {
    const perfil = { campos: [
      { key: 'senha', visivel: true, negrito: true, alinhamento: 'centro' },
      { key: 'itens', visivel: true, negrito: false, alinhamento: 'esquerda' },
    ] };
    const render = (outros?: any[]) =>
      ((svc as any).renderTicket({ senha: 7, senhaPrefixo: 'B' }, [{ descricao: 'Lanche', quantidade: 2 }], 3, { perfil }, outros) as string).split('\n');
    const completo = render([{ quantidade: 1, descricao: 'Refri', destino: 'Despacho' }]);
    expect(completo).toEqual(expect.arrayContaining(['@B 2x Lanche', `@S ${TITULO_OUTROS_ITENS}`, '@S 1x Refri (Despacho)']));
    const soItens = render();
    expect(soItens).toContain('2x Lanche');
    expect(soItens.join('\n')).not.toMatch(/TAMBEM|@B 2x/);
  });

  it('o ticket da etapa do KDS sai com a origem da senha (B-7)', async () => {
    await q(`insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, ativo, imprime_ao_avancar, imprime_no_status, impressora_destino_id)
             values ($1,$2,$3,'Etapa',$4,'kds',true,true,'preparo',$5)`, [ETAPA, T, U, 'tok-' + ETAPA, impBar]);
    const cmd = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo) values ($1,$2,'fechada',7,'B') returning id`, [T, U]))[0].id;
    const card = (await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_equipamento_id, destino_tipo, origem, status, senha, senha_prefixo)
                           values ($1,$2,$3,$4,'kds','balcao','recebido',7,'B') returning id`, [T, U, cmd, ETAPA]))[0].id;
    await q(`insert into producao_pedido_item (tenant_id, pedido_id, descricao, quantidade) values ($1,$2,'Lanche da etapa',1)`, [T, card]);
    await svc.avancar(T, ATOR.id, card, 'entrega', ETAPA); // recebido → preparo: o KDS imprime nesta etapa
    const [job] = await q(`select conteudo from impressao_job where pedido_id = $1 and equipamento_id = $2`, [card, impBar]);
    expect(String(job?.conteudo)).toContain('SENHA B-7');
  });
});
