import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';
import { lerTrocasDeCodigo, MAX_CODIGO_PDV, MAX_TROCAS_DE_CODIGO } from './codigos-pdv';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CÓDIGO PDV NA LISTA (Cadastros › Cardápio): vários produtos e opções em um pedido, tudo ou nada. O que se prova contra o
// Postgres: grava e audita de → para; a cópia que a venda lê acompanha; a recusa não grava NADA; a troca cruzada de produtos
// é recusada (o sync a descartaria); duas opções do mesmo produto não ficam com o mesmo código; outra empresa não entra.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('codigos-pdv-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';

describe('o pedido de troca de códigos (sem banco)', () => {
  it('limpa espaços, tira o que não mudou e trata vazio como sem código', () => {
    const r = lerTrocasDeCodigo({
      trocas: [
        { tipo: 'produto', id: ID_A, de: '10', para: ' 20 ' },
        { tipo: 'opcao', id: ID_B, de: ' 7 ', para: '7' },
        { tipo: 'opcao', id: ID_A, de: 'X', para: '   ' },
      ],
    });
    expect(r.recusas).toEqual([]);
    expect(r.trocas).toEqual([
      { tipo: 'produto', id: ID_A, de: '10', para: '20' },
      { tipo: 'opcao', id: ID_A, de: 'X', para: null },
    ]);
  });
  it('formato errado recusa o pedido inteiro', () => {
    expect(() => lerTrocasDeCodigo({})).toThrow(/Informe os códigos/);
    expect(() => lerTrocasDeCodigo({ trocas: [{ tipo: 'x', id: ID_A, para: '1' }] })).toThrow(/inválido/);
    expect(() => lerTrocasDeCodigo({ trocas: [{ tipo: 'produto', id: '1 or 1=1', para: '1' }] })).toThrow(/inválido/);
    expect(() => lerTrocasDeCodigo({ trocas: [{ tipo: 'produto', id: ID_A, de: null, para: 5 }] })).toThrow(/inválido/);
    expect(() => lerTrocasDeCodigo({ trocas: [{ tipo: 'produto', id: ID_A, para: '1' }, { tipo: 'produto', id: ID_A, para: '2' }] })).toThrow(/duas vezes/);
    const muitas = Array.from({ length: MAX_TROCAS_DE_CODIGO + 1 }, () => ({ tipo: 'produto', id: ID_A, para: '1' }));
    expect(() => lerTrocasDeCodigo({ trocas: muitas })).toThrow(/até 500/);
  });
  it('código longo e o mesmo código em dois produtos voltam por linha; em duas opções pode', () => {
    const longo = lerTrocasDeCodigo({ trocas: [{ tipo: 'opcao', id: ID_A, de: null, para: 'x'.repeat(MAX_CODIGO_PDV + 1) }] });
    expect(longo.recusas).toEqual([expect.objectContaining({ id: ID_A, motivo: expect.stringMatching(/até 60/) })]);
    const dois = lerTrocasDeCodigo({ trocas: [{ tipo: 'produto', id: ID_A, de: '1', para: '9' }, { tipo: 'produto', id: ID_B, de: '2', para: '9' }] });
    expect(dois.recusas.map((x) => x.id).sort()).toEqual([ID_A, ID_B]);
    const opcoes = lerTrocasDeCodigo({ trocas: [{ tipo: 'opcao', id: ID_A, de: '1', para: '9' }, { tipo: 'opcao', id: ID_B, de: '2', para: '9' }] });
    expect(opcoes.recusas).toEqual([]);
  });
});

descrever('código PDV na lista (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditados.push(a) } as any;
  const flashes: string[][] = [];
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async (ids: string[]) => void flashes.push(ids) }, new FichasService(db)) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const ator = { id: null, perfil: 'gerente' };

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto_variacao', 'produto', 'categoria_produto'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Dois produtos; o X-Bacon com as opções Bacon (A01) e Queijo (A02) na mesma etapa, e a Batata com a opção Sal (S01).
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste codigos pdv') returning id`))[0].id as string;
    empresas.push(t);
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    const novoProduto = async (nome: string, codigo: string) =>
      (await q(`insert into produto (tenant_id, nome, codigo, categoria_id, preco_venda) values ($1, $2, $3, $4, 30) returning id`, [t, nome, codigo, cat]))[0].id as string;
    const xBacon = await novoProduto('X-Bacon', '10');
    const batata = await novoProduto('Batata', '20');
    const bacon: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon', codigoPdv: 'A01', tipo: 'simples' });
    const queijo: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Queijo', codigoPdv: 'A02', tipo: 'simples' });
    const sal: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Sal', codigoPdv: 'S01', tipo: 'simples' });
    const etapa: any = await produtos.criarComplemento(t, {
      nome: 'Adicionais',
      regra: 'varias_sem_repeticao',
      itens: [{ opcaoId: bacon.id, preco: 5 }, { opcaoId: queijo.id, preco: 3 }],
    });
    const etapaSal: any = await produtos.criarComplemento(t, { nome: 'Tempero', regra: 'uma', itens: [{ opcaoId: sal.id, preco: 1 }] });
    await produtos.setProdutoComplementos(t, xBacon, [etapa.id]);
    await produtos.setProdutoComplementos(t, batata, [etapaSal.id]);
    return { t, xBacon, batata, bacon: bacon.id as string, queijo: queijo.id as string, sal: sal.id as string };
  }
  const codigoDoProduto = async (id: string) => (await q(`select codigo from produto where id = $1`, [id]))[0].codigo;
  const codigoDaOpcao = async (id: string) => (await q(`select codigo_pdv as c from opcao where id = $1`, [id]))[0].c;
  // O que a VENDA lê: a cópia viva da opção no produto.
  const naVenda = async (produtoId: string) =>
    (await q(
      `select o.nome, o.codigo_pdv as codigo, o.preco_delta::numeric as preco from complemento_opcao o join complemento_grupo g on g.id = o.grupo_id
        where g.produto_id = $1 and o.deleted_at is null and g.deleted_at is null order by o.nome`,
      [produtoId],
    )).map((r: any) => ({ nome: r.nome, codigo: r.codigo, preco: Number(r.preco) }));
  const recusaDe = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e: any) {
      return { status: e.getStatus?.(), recusas: e.details?.recusas ?? [], mensagem: String(e.message) };
    }
    throw new Error('era para recusar');
  };

  it('grava produto e opção num pedido, audita de → para, avisa o sync e a venda já lê o código novo', async () => {
    const l = await loja();
    auditados.length = 0;
    flashes.length = 0;
    const r = await produtos.trocarCodigosPdv(l.t, {
      trocas: [
        { tipo: 'produto', id: l.xBacon, de: '10', para: '11' },
        { tipo: 'opcao', id: l.bacon, de: 'A01', para: 'B01' },
      ],
    }, ator);
    expect(r).toEqual({ ok: true, alterados: 2, produtos: 1, opcoes: 1 });
    expect(await codigoDoProduto(l.xBacon)).toBe('11');
    expect(await codigoDaOpcao(l.bacon)).toBe('B01');
    expect(await naVenda(l.xBacon)).toEqual([
      { nome: 'Bacon', codigo: 'B01', preco: 5 },
      { nome: 'Queijo', codigo: 'A02', preco: 3 },
    ]);
    expect(flashes).toEqual([[l.xBacon]]);
    expect(auditados).toEqual([
      expect.objectContaining({
        acao: 'trocou_codigo_pdv',
        detalhe: {
          origem: 'cadastros_cardapio',
          trocas: expect.arrayContaining([
            { tipo: 'produto', id: l.xBacon, de: '10', para: '11', nome: 'X-Bacon' },
            { tipo: 'opcao', id: l.bacon, de: 'A01', para: 'B01', nome: 'Bacon' },
          ]),
        },
      }),
    ]);
  });

  it('opção sem código vira observação na venda: não cobra', async () => {
    const l = await loja();
    await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'opcao', id: l.queijo, de: 'A02', para: '' }] }, ator);
    expect(await codigoDaOpcao(l.queijo)).toBeNull();
    expect((await naVenda(l.xBacon)).find((o: any) => o.nome === 'Queijo')).toEqual({ nome: 'Queijo', codigo: null, preco: 0 });
  });

  it('uma linha recusada não grava nenhuma, e a tela recebe qual foi', async () => {
    const l = await loja();
    auditados.length = 0;
    const e = await recusaDe(produtos.trocarCodigosPdv(l.t, {
      trocas: [
        { tipo: 'opcao', id: l.sal, de: 'S01', para: 'S02' },
        { tipo: 'produto', id: l.batata, de: '20', para: '10' },
      ],
    }, ator));
    expect(e.status).toBe(409);
    expect(e.recusas).toEqual([expect.objectContaining({ tipo: 'produto', id: l.batata, motivo: expect.stringMatching(/10 ainda está em "X-Bacon"/) })]);
    expect(await codigoDaOpcao(l.sal)).toBe('S01');
    expect(await codigoDoProduto(l.batata)).toBe('20');
    expect(auditados).toEqual([]);
  });

  it('a troca cruzada de produtos é recusada; em dois passos funciona', async () => {
    const l = await loja();
    const e = await recusaDe(produtos.trocarCodigosPdv(l.t, {
      trocas: [
        { tipo: 'produto', id: l.xBacon, de: '10', para: '20' },
        { tipo: 'produto', id: l.batata, de: '20', para: '10' },
      ],
    }, ator));
    expect(e.recusas.map((x: any) => x.id).sort()).toEqual([l.xBacon, l.batata].sort());
    expect(await codigoDoProduto(l.xBacon)).toBe('10');
    await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.xBacon, de: '10', para: '30' }] }, ator);
    await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.batata, de: '20', para: '10' }] }, ator);
    await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.xBacon, de: '30', para: '20' }] }, ator);
    expect([await codigoDoProduto(l.xBacon), await codigoDoProduto(l.batata)]).toEqual(['20', '10']);
  });

  it('o código que mudou depois de a tela ler é recusado', async () => {
    const l = await loja();
    await q(`update produto set codigo = '99' where id = $1`, [l.xBacon]);
    const e = await recusaDe(produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.xBacon, de: '10', para: '11' }] }, ator));
    expect(e.recusas[0].motivo).toMatch(/mudou enquanto você editava: o código agora é 99/);
    expect(await codigoDoProduto(l.xBacon)).toBe('99');
  });

  it('duas opções do mesmo produto não ficam com o mesmo código; em produtos diferentes pode; entre duas opções a troca vale', async () => {
    const l = await loja();
    const e = await recusaDe(produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'opcao', id: l.bacon, de: 'A01', para: 'A02' }] }, ator));
    expect(e.recusas).toEqual([expect.objectContaining({ id: l.bacon, motivo: expect.stringMatching(/A02 ficaria em mais de uma opção de "X-Bacon"/) })]);
    expect(await codigoDaOpcao(l.bacon)).toBe('A01');

    await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'opcao', id: l.sal, de: 'S01', para: 'A01' }] }, ator);
    expect(await codigoDaOpcao(l.sal)).toBe('A01');

    await produtos.trocarCodigosPdv(l.t, {
      trocas: [
        { tipo: 'opcao', id: l.bacon, de: 'A01', para: 'A02' },
        { tipo: 'opcao', id: l.queijo, de: 'A02', para: 'A01' },
      ],
    }, ator);
    expect((await naVenda(l.xBacon)).map((o: any) => o.codigo)).toEqual(['A02', 'A01']);
  });

  it('o código de produto não pode ser o de uma variação', async () => {
    const l = await loja();
    await q(`insert into produto_variacao (tenant_id, produto_id, nome, codigo, preco_venda) values ($1, $2, 'Grande', '77', 40)`, [l.t, l.xBacon]);
    const e = await recusaDe(produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.batata, de: '20', para: '77' }] }, ator));
    expect(e.recusas[0].motivo).toMatch(/variação "Grande" de "X-Bacon"/);
  });

  it('item de outra empresa não entra', async () => {
    const a = await loja();
    const b = await loja();
    const e = await recusaDe(produtos.trocarCodigosPdv(a.t, {
      trocas: [
        { tipo: 'produto', id: b.xBacon, de: '10', para: '55' },
        { tipo: 'opcao', id: b.bacon, de: 'A01', para: '55' },
      ],
    }, ator));
    expect(e.recusas).toHaveLength(2);
    expect(e.recusas[0].motivo).toMatch(/não existe mais/);
    expect(await codigoDoProduto(b.xBacon)).toBe('10');
    expect(await codigoDaOpcao(b.bacon)).toBe('A01');
  });

  it('pedido sem mudança não grava nem audita', async () => {
    const l = await loja();
    auditados.length = 0;
    expect(await produtos.trocarCodigosPdv(l.t, { trocas: [{ tipo: 'produto', id: l.xBacon, de: '10', para: ' 10 ' }] }, ator)).toMatchObject({ alterados: 0 });
    expect(auditados).toEqual([]);
  });
});
