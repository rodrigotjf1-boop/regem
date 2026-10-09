import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';
import { ProdutoService } from '../produto/produto.service';
import { EstoqueController } from './estoque.controller';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { UNIDADES_ESTOQUE, apelidosDeUnidade, unidadeOuPadrao } from './unidades';

/* eslint-disable @typescript-eslint/no-explicit-any */

// UNIDADE DE MEDIDA SEMPRE DA LISTA — pedido do dono (09/10/2026): "no menu estoque, ou em qualquer
// lugar que devemos preencher a unidade de medida, não deixar um campo para preencher, dar uma lista
// para selecionar os padrões que já temos".
//
// O produto do estoque já escolhia na lista. Faltavam quatro campos em texto livre: ingrediente da
// ficha sem produto do estoque, rendimento da ficha, ordem de produção e produto do catálogo. A tela
// passa a usar a lista; aqui se confere o SERVIDOR: o que chega escrito de outro jeito vira a unidade
// da lista ("un" → unidade), o que não existe é recusado, e a rota da lista serve a quem não tem a
// permissão de estoque (quem edita ficha, ordem ou catálogo também escolhe dela).

describe('unidade de medida: regras da lista', () => {
  it('campo vazio usa o padrão; preenchido tem de ser da lista (apelido vira a unidade da lista)', () => {
    expect(unidadeOuPadrao(undefined, 'Unidade')).toBe('unidade');
    expect(unidadeOuPadrao(null, 'Unidade')).toBe('unidade');
    expect(unidadeOuPadrao('   ', 'Unidade')).toBe('unidade');
    expect(unidadeOuPadrao('', 'Unidade do rendimento', 'porção')).toBe('porção');
    expect(unidadeOuPadrao('un', 'Unidade')).toBe('unidade');
    expect(unidadeOuPadrao('Porções', 'Unidade')).toBe('porção');
    expect(unidadeOuPadrao('KG', 'Unidade')).toBe('kg');
    expect(() => unidadeOuPadrao('colher', 'Unidade de "Orégano"')).toThrow(BadRequestException);
    expect(() => unidadeOuPadrao('colher', 'Unidade de "Orégano"')).toThrow(/Unidade de "Orégano": unidade de medida "colher" não existe\. Escolha uma da lista\./);
  });

  it('a tela recebe os apelidos e todos apontam para uma unidade da lista', () => {
    const apelidos = apelidosDeUnidade();
    expect(apelidos.un).toBe('unidade');
    expect(apelidos.porcoes).toBe('porção');
    expect(apelidos.l).toBe('litro');
    for (const u of Object.values(apelidos)) expect(UNIDADES_ESTOQUE).toContain(u);
    for (const u of UNIDADES_ESTOQUE) expect(Object.values(apelidos)).toContain(u); // a própria forma também
  });

  it('a rota da lista não pede a permissão de estoque (as outras rotas do estoque pedem)', () => {
    expect(Reflect.getMetadata(REQUIRE_PERM, EstoqueController.prototype.listUnidades)).toBeUndefined();
    expect(Reflect.getMetadata(REQUIRE_PERM, EstoqueController.prototype.createItem)).toBeDefined();
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('unidade-por-lista.spec: sem TEST_PG_URL — parte com banco PULADA');
jest.setTimeout(120_000);

descrever('unidade de medida da lista em ficha, ordem de produção e produto do catálogo (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const fichas = new FichasService(db);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const ordens = new OrdemProducaoService(db, {} as any, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['ordem_producao', 'produto', 'categoria_produto', 'ficha_ingrediente', 'ficha_tecnica', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste unidade por lista') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Presidente','presidente') returning id`, [t]))[0].id as string;
    const ator = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Pessoa de teste',$2) returning id`, [t, funcao]))[0].id as string;
    return { t, u, ator };
  }
  const ingrediente = (nome: string, unidade?: string) => ({ insumoNome: nome, quantidade: 1, unidade, custoUnitario: 1 });

  it('ficha: ingrediente escrito à mão e rendimento gravam a unidade da lista; o que não existe é recusado sem gravar', async () => {
    const { t } = await empresa();
    const f: any = await fichas.create(t, {
      nome: 'Molho de teste', rendimento: 10, rendimentoUnidade: 'Porções',
      ingredientes: [ingrediente('Orégano de teste', 'g'), ingrediente('Sal de teste', 'un'), ingrediente('Água de teste')],
    } as any);
    const [ficha] = await q(`select rendimento_unidade from ficha_tecnica where id = $1`, [f.id]);
    expect(ficha.rendimento_unidade).toBe('porção');
    const ings = await q(`select insumo_nome, unidade from ficha_ingrediente where ficha_id = $1 and deleted_at is null order by ordem`, [f.id]);
    expect(ings.map((i: any) => i.unidade)).toEqual(['grama', 'unidade', 'unidade']); // "g", "un" e vazio

    await expect(fichas.create(t, { nome: 'Ficha recusada', rendimento: 1, ingredientes: [ingrediente('Orégano de teste', 'colher')] } as any)).rejects.toThrow(/Unidade de "Orégano de teste": unidade de medida "colher" não existe/);
    await expect(fichas.create(t, { nome: 'Ficha recusada', rendimento: 1, rendimentoUnidade: 'tigelas', ingredientes: [] } as any)).rejects.toThrow(/Unidade do rendimento: unidade de medida "tigelas" não existe/);
    expect(await q(`select 1 from ficha_tecnica where tenant_id = $1 and nome = 'Ficha recusada'`, [t])).toHaveLength(0);

    // alterar: mesma regra (a tela manda todas as linhas de novo)
    await fichas.update(t, f.id, { rendimentoUnidade: 'L', ingredientes: [ingrediente('Orégano de teste', 'KG')] } as any);
    expect((await q(`select rendimento_unidade from ficha_tecnica where id = $1`, [f.id]))[0].rendimento_unidade).toBe('litro');
    expect((await q(`select unidade from ficha_ingrediente where ficha_id = $1 and deleted_at is null`, [f.id])).map((i: any) => i.unidade)).toEqual(['kg']);
    await expect(fichas.update(t, f.id, { nome: 'Nome que não pode ficar', ingredientes: [ingrediente('Orégano de teste', 'pitada')] } as any)).rejects.toThrow(/"pitada" não existe/);
    // a recusa veio antes de gravar: o nome e os ingredientes de antes continuam lá
    expect((await q(`select nome from ficha_tecnica where id = $1`, [f.id]))[0].nome).toBe('Molho de teste');
    expect((await q(`select unidade from ficha_ingrediente where ficha_id = $1 and deleted_at is null`, [f.id])).map((i: any) => i.unidade)).toEqual(['kg']);
  });

  it('produto do catálogo: criar e alterar gravam a unidade da lista ("un" → unidade); texto inventado é recusado', async () => {
    const { t, ator } = await empresa();
    const categoriaId = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const criar = (dto: any) => (produtos as any).criar(t, ator, 'presidente', { categoriaId, precoVenda: 10, tipo: 'simples', ...dto });
    const semUnidade: any = await criar({ nome: 'Produto sem unidade' });
    const comApelido: any = await criar({ nome: 'Produto com apelido', unidadeMedida: 'un' });
    const porQuilo: any = await criar({ nome: 'Produto por quilo', unidadeMedida: 'Kg' });
    const lidos = await q(`select nome, unidade_medida from produto where tenant_id = $1 order by nome`, [t]);
    expect(lidos).toEqual([
      { nome: 'Produto com apelido', unidade_medida: 'unidade' },
      { nome: 'Produto por quilo', unidade_medida: 'kg' },
      { nome: 'Produto sem unidade', unidade_medida: 'unidade' },
    ]);
    await expect(criar({ nome: 'Produto recusado', unidadeMedida: 'tigela' })).rejects.toThrow(/Unidade do produto: unidade de medida "tigela" não existe/);
    expect(await q(`select 1 from produto where tenant_id = $1 and nome = 'Produto recusado'`, [t])).toHaveLength(0);

    await (produtos as any).atualizar(t, porQuilo.id, { unidadeMedida: 'pct' });
    expect((await q(`select unidade_medida from produto where id = $1`, [porQuilo.id]))[0].unidade_medida).toBe('pacote');
    await expect((produtos as any).atualizar(t, comApelido.id, { unidadeMedida: 'tigela' })).rejects.toThrow(BadRequestException);
    // alterar sem mandar a unidade não mexe nela
    await (produtos as any).atualizar(t, semUnidade.id, { nome: 'Produto sem unidade (renomeado)' });
    expect((await q(`select unidade_medida from produto where id = $1`, [semUnidade.id]))[0].unidade_medida).toBe('unidade');
  });

  it('ordem de produção: a unidade vem da lista (vazia = unidade) e a inventada é recusada sem criar a ordem', async () => {
    const { t, u, ator } = await empresa();
    const f: any = await fichas.create(t, { nome: 'Massa de teste', rendimento: 1, ingredientes: [] } as any);
    const criar = (unidade?: string) => ordens.criar(t, ator, { fichaId: f.id, quantidadePlanejada: 2, dataProducao: '2026-10-09', unidadeId: u, unidade }) as Promise<any>;
    const a = await criar(), b = await criar('porções'), c = await criar('kg');
    const lidas = await q(`select id, unidade from ordem_producao where tenant_id = $1`, [t]);
    const de = (id: string) => lidas.find((o: any) => o.id === id)?.unidade;
    expect([de(a.id), de(b.id), de(c.id)]).toEqual(['unidade', 'porção', 'kg']);
    await expect(criar('tabuleiro')).rejects.toThrow(/Unidade da ordem: unidade de medida "tabuleiro" não existe/);
    expect(lidas).toHaveLength(3);
    expect(await q(`select 1 from ordem_producao where tenant_id = $1`, [t])).toHaveLength(3);
  });
});
