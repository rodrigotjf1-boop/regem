import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { lerXlsx } from '../cliente/ler-xlsx';
import { ComprasService } from '../compras/compras.service';
import { EstoqueService } from './estoque.service';
import { limparMarcas, MARCAS_MAX } from './produto-nome';
import { ProdutosPlanilhaService } from './produtos-planilha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NOME COMERCIAL E MARCAS DO PRODUTO DO ESTOQUE — pedido do dono (09/10/2026):
//   "nome do produto: carne 56 g [esse nome entra nas fichas técnicas]; nome fantasia: Caixa de
//    hambúrguer [esse nome entra na lista de compras e pedidos]";
//   "cada produto pode ter mais de uma marca … quando fazemos uma lista de compras, se tiver mais de
//    uma marca cadastrada, o responsável por criar a lista escolhe a marca, porém faz um estoque só".
// Perguntado, ele decidiu: com duas ou mais marcas, escolher é OBRIGATÓRIO.

describe('marcas do produto: lista limpa', () => {
  it('tira vazia e repetida (sem diferenciar maiúscula e acento), mantém a 1ª grafia e a ordem', () => {
    expect(limparMarcas(['Marca Alfa', '  ', 'marca alfa', 'Marca Beta ', 'MARCA BETA', 'Marca Épsilon', 'Marca Epsilon'])).toEqual(['Marca Alfa', 'Marca Beta', 'Marca Épsilon']);
    expect(limparMarcas(undefined)).toEqual([]);
    expect(limparMarcas(null)).toEqual([]);
    expect(limparMarcas([1, {}, 'Marca Gama'])).toEqual(['Marca Gama']);
  });
  it('aceita a célula da planilha ("Marca Alfa; Marca Beta") e corta no limite', () => {
    expect(limparMarcas('Marca Alfa; Marca Beta , Marca Gama|Marca Delta')).toEqual(['Marca Alfa', 'Marca Beta', 'Marca Gama', 'Marca Delta']);
    expect(limparMarcas('')).toEqual([]);
    expect(limparMarcas(Array.from({ length: 40 }, (_, i) => `Marca ${i}`))).toHaveLength(MARCAS_MAX);
    expect(limparMarcas(['x'.repeat(200)])[0]).toHaveLength(60);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('nome-comercial-marcas.spec: sem TEST_PG_URL — parte com banco PULADA');
jest.setTimeout(120_000);

descrever('nome comercial e marcas: cadastro, lista de compras e planilha (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const planilha = () => new (ProdutosPlanilhaService as any)(db, estoque(), auditoria) as ProdutosPlanilhaService;
  const compras = () => new (ComprasService as any)(db, { emit: () => true }, auditoria) as ComprasService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['compra_item', 'compra_lista', 'movimento_estoque', 'item_conversao', 'item_fornecedor', 'item_estoque', 'categoria_item', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Marcas teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [id]))[0].id as string;
    return { t: id, u };
  }
  const gravado = async (id: string) => (await q(`select nome, nome_comercial, marcas from item_estoque where id = $1`, [id]))[0];

  it('cadastro: o nome do produto continua o da ficha; nome comercial e marcas entram ao lado dele', async () => {
    const { t } = await empresa();
    const s = estoque();
    const queijo: any = await s.createItem(t, { nome: 'Fatia de queijo cheddar de teste', nomeComercial: '  Barra de queijo  cheddar fatiado ', marcas: ['Marca Alfa', 'marca alfa', ' ', 'Marca Beta'], unidadeMedida: 'unidade' } as any, null, ator);
    expect(await gravado(queijo.id)).toEqual({ nome: 'Fatia de queijo cheddar de teste', nome_comercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'] });
    // sem os campos novos: nada muda no que já existia
    const sal: any = await s.createItem(t, { nome: 'Sal de teste', unidadeMedida: 'kg' } as any, null, ator);
    expect(await gravado(sal.id)).toEqual({ nome: 'Sal de teste', nome_comercial: null, marcas: [] });
    // a lista da tela devolve os dois
    const lista: any[] = await s.listItens(t, true, null);
    expect(lista.find((i) => i.id === queijo.id)).toMatchObject({ nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'] });
    // dois produtos podem ter o mesmo nome comercial (a trava de repetido é só do nome do produto)
    await expect(s.createItem(t, { nome: 'Queijo cheddar ralado de teste', nomeComercial: 'Barra de queijo cheddar fatiado', unidadeMedida: 'kg' } as any, null, ator)).resolves.toBeTruthy();
  });

  it('alterar: campo ausente mantém; vazio limpa; a lista de marcas enviada substitui a anterior', async () => {
    const { t } = await empresa();
    const s = estoque();
    const p: any = await s.createItem(t, { nome: 'Carne 56 g de teste', nomeComercial: 'Caixa de hambúrguer de teste', marcas: ['Marca Gama'], unidadeMedida: 'unidade' } as any, null, ator);
    await s.updateItem(t, p.id, { estoqueMinimo: 10 } as any, null, ator);
    expect(await gravado(p.id)).toMatchObject({ nome_comercial: 'Caixa de hambúrguer de teste', marcas: ['Marca Gama'] }); // ausente mantém
    await s.updateItem(t, p.id, { marcas: ['Marca Delta', 'Marca Gama', 'marca delta'] } as any, null, ator);
    expect(await gravado(p.id)).toMatchObject({ nome_comercial: 'Caixa de hambúrguer de teste', marcas: ['Marca Delta', 'Marca Gama'] });
    await s.updateItem(t, p.id, { nomeComercial: '   ', marcas: [] } as any, null, ator);
    expect(await gravado(p.id)).toEqual({ nome: 'Carne 56 g de teste', nome_comercial: null, marcas: [] });
  });

  it('lista de compras: com duas ou mais marcas a escolha é obrigatória; a marca fica gravada no item', async () => {
    const { t, u } = await empresa();
    const s = estoque();
    const c = compras();
    const queijo: any = await s.createItem(t, { nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'], unidadeMedida: 'unidade' } as any, null, ator);
    const carne: any = await s.createItem(t, { nome: 'Carne 56 g de teste', nomeComercial: 'Caixa de hambúrguer de teste', marcas: ['Marca Gama'], unidadeMedida: 'unidade' } as any, null, ator);
    const sal: any = await s.createItem(t, { nome: 'Sal de teste', unidadeMedida: 'kg' } as any, null, ator);
    const nova = (itens: any[]) => c.createLista(t, { nome: 'Compra de teste', itens } as any, u) as Promise<any>;

    // duas marcas e nenhuma escolhida: recusa, dizendo o produto (pelo nome comercial) e as marcas
    await expect(nova([{ itemId: queijo.id, quantidade: 2 }])).rejects.toThrow(BadRequestException);
    await expect(nova([{ itemId: queijo.id, quantidade: 2 }])).rejects.toThrow(/Escolha a marca de "Barra de queijo cheddar fatiado": Marca Alfa, Marca Beta\./);
    // marca que o produto não tem: recusa
    await expect(nova([{ itemId: queijo.id, quantidade: 2, marca: 'Marca Gama' }])).rejects.toThrow(/"Marca Gama" não é marca cadastrada de "Barra de queijo cheddar fatiado"/);
    // produto sem nome comercial fala pelo nome dele
    const leite: any = await s.createItem(t, { nome: 'Leite de teste', marcas: ['Marca A', 'Marca B'], unidadeMedida: 'litro' } as any, null, ator);
    await expect(nova([{ itemId: leite.id, quantidade: 1 }])).rejects.toThrow(/Escolha a marca de "Leite de teste"/);
    expect(await q(`select 1 from compra_lista where tenant_id = $1`, [t])).toHaveLength(0); // as recusas não deixaram lista

    const lista = await nova([
      { itemId: queijo.id, quantidade: 2, marca: 'marca beta' }, // escolhida (sem diferenciar maiúscula)
      { itemId: carne.id, quantidade: 5 }, // uma marca só: vale ela
      { itemId: sal.id, quantidade: 1, marca: 'Qualquer' }, // sem marca cadastrada: não grava marca
    ]);
    const itens = await q(`select ci.marca, i.nome from compra_item ci join item_estoque i on i.id = ci.item_id where ci.lista_id = $1 order by i.nome`, [lista.id]);
    expect(itens).toEqual([
      { marca: 'Marca Gama', nome: 'Carne 56 g de teste' },
      { marca: 'Marca Beta', nome: 'Fatia de queijo cheddar de teste' },
      { marca: null, nome: 'Sal de teste' },
    ]);

    // a tela de compras recebe o nome comercial e a marca; o estoque é UM só (uma linha por produto)
    const aberta: any = await c.getLista(t, lista.id, u);
    const doQueijo = aberta.itens.find((i: any) => i.itemId === queijo.id);
    expect(doQueijo).toMatchObject({ nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marca: 'Marca Beta' });
    expect(aberta.itens.find((i: any) => i.itemId === sal.id)).toMatchObject({ nomeComercial: null, marca: null });
    expect(await q(`select count(*)::int as n from item_estoque where tenant_id = $1 and nome like 'Fatia de queijo%'`, [t])).toEqual([{ n: 1 }]);

    // renomear ou tirar a marca do cadastro depois não muda o pedido já feito
    await s.updateItem(t, queijo.id, { marcas: ['Marca Alfa'] } as any, null, ator);
    expect((await q(`select marca from compra_item where lista_id = $1 and item_id = $2`, [lista.id, queijo.id]))[0].marca).toBe('Marca Beta');
  });

  it('sugestão de compra (abaixo do mínimo) já traz o nome comercial e as marcas', async () => {
    const { t, u } = await empresa();
    const s = estoque();
    await s.createItem(t, { nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'], unidadeMedida: 'unidade', estoqueMinimo: 10 } as any, null, ator);
    const sugestoes: any[] = await compras().sugerir(t, u);
    expect(sugestoes).toHaveLength(1);
    expect(sugestoes[0]).toMatchObject({ nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'], sugerido: 10 });
  });

  it('planilha: importa "Nome comercial" e "Marcas", exporta as duas colunas e o arquivo exportado entra de volta', async () => {
    const { t } = await empresa();
    const p = planilha();
    const csv = 'Produto;Nome fantasia;Marca;Unidade\r\nFatia de queijo cheddar de teste;Barra de queijo cheddar fatiado;Marca Alfa, Marca Beta;un\r\nSal de teste;;;kg\r\n';
    const previa: any = await p.previa(t, Buffer.from(csv), 'produtos.csv', null);
    expect(previa.colunas).toMatchObject({ nome: 'Produto', comercial: 'Nome fantasia', marcas: 'Marca', unidade: 'Unidade' });
    expect(previa.linhas[0]).toMatchObject({ nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'], unidade: 'unidade' });
    expect(previa.linhas[1]).toMatchObject({ nome: 'Sal de teste', nomeComercial: '', marcas: [] });

    const r: any = await p.importar(t, { itens: previa.linhas.map((l: any) => ({ nome: l.nome, nomeComercial: l.nomeComercial, marcas: l.marcas, unidadeMedida: l.unidade })) }, null, ator);
    expect(r.criados).toBe(2);
    const itens = await q(`select nome, nome_comercial, marcas from item_estoque where tenant_id = $1 order by nome`, [t]);
    expect(itens).toEqual([
      { nome: 'Fatia de queijo cheddar de teste', nome_comercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'] },
      { nome: 'Sal de teste', nome_comercial: null, marcas: [] },
    ]);

    const x: any = await p.exportar(t, false, null, 'xlsx');
    const tabela = lerXlsx(Buffer.from(x.base64, 'base64'));
    expect(tabela[0].slice(0, 5)).toEqual(['Produto', 'Nome comercial', 'Marcas', 'Categoria', 'Unidade']);
    expect(tabela[1].slice(0, 3)).toEqual(['Fatia de queijo cheddar de teste', 'Barra de queijo cheddar fatiado', 'Marca Alfa; Marca Beta']);
    expect(tabela[2].slice(0, 3)).toEqual(['Sal de teste', '', '']);
    // o exportado é lido de volta com as mesmas colunas (e reconhece os produtos como já existentes)
    const deVolta: any = await p.previa(t, Buffer.from(x.base64, 'base64'), 'exportado.xlsx', null);
    expect(deVolta.colunas).toMatchObject({ nome: 'Produto', comercial: 'Nome comercial', marcas: 'Marcas' });
    expect(deVolta.linhas[0]).toMatchObject({ situacao: 'igual', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'] });
  });
});
