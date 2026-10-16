import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { complemento, complementoGrupo, complementoItem, complementoOpcao, opcao, produtoComplemento } from '../../db/schema';
import { arredondarEstoque, fatorParaEstoque } from '../../common/conversao-unidade';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SALVAR UMA OPÇÃO NÃO PODE LEVAR 40 s (ERR-245) — contra o Postgres real (TEST_PG_URL).
//
// O dono (16/10/2026): "ao associar um complemento ao insumo de um estoque está demorando quase
// 40 segundos para salvar". Salvar a opção regera os grupos/opções materializados de cada produto
// que a usa — um produto por vez e uma linha por vez. A "Carne 120 gr" está em 9 produtos (19
// etapas, 108 linhas): ~250 idas ao banco, a ~115-150 ms cada (banco em Oregon).
//
// `materializarProdutos` faz a mesma regeração para todos de uma vez, numa transação. Esta spec
// prova que o resultado é O MESMO do algoritmo antigo (copiado abaixo, como estava na main), que o
// número de consultas não cresce com os produtos e que duas gravações juntas não duplicam grupos.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('materializar-em-lote.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

// ── o algoritmo ANTIGO (main 209bdf63), só para comparar o resultado ──
async function materializarAntigo(db: any, fichas: FichasService, tenantId: string, produtoId: string) {
  const agora = new Date();
  const antigos = await db
    .select({ id: complementoGrupo.id })
    .from(complementoGrupo)
    .where(and(eq(complementoGrupo.tenantId, tenantId), eq(complementoGrupo.produtoId, produtoId), isNotNull(complementoGrupo.origemComplementoId), isNull(complementoGrupo.deletedAt)));
  for (const g of antigos) {
    await db.update(complementoOpcao).set({ deletedAt: agora, updatedAt: agora }).where(eq(complementoOpcao.grupoId, g.id));
    await db.update(complementoGrupo).set({ deletedAt: agora, updatedAt: agora }).where(eq(complementoGrupo.id, g.id));
  }
  const ligados = await db
    .select({ complementoId: produtoComplemento.complementoId, ordem: produtoComplemento.ordem })
    .from(produtoComplemento)
    .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId), isNull(produtoComplemento.deletedAt)))
    .orderBy(produtoComplemento.ordem);
  for (const [i, lig] of ligados.entries()) {
    const [comp] = await db.select().from(complemento).where(and(eq(complemento.id, lig.complementoId), eq(complemento.tenantId, tenantId), isNull(complemento.deletedAt)));
    if (!comp || comp.ativo === false) continue;
    const [g] = await db
      .insert(complementoGrupo)
      .values({ tenantId, produtoId, nome: comp.nome, tipo: 'adicionar', min: comp.min ?? 0, max: comp.max ?? null, obrigatorio: comp.obrigatorio ?? false, ordem: i, origemComplementoId: comp.id })
      .returning();
    const itens = await db
      .select({
        preco: complementoItem.preco, ordem: complementoItem.ordem, padraoItem: complementoItem.padraoMarcada, opcaoId: opcao.id, nome: opcao.nome, tipo: opcao.tipo,
        itemId: opcao.itemId, itemUnidade: opcao.itemUnidade, produtoRefId: opcao.produtoRefId, codigoPdv: opcao.codigoPdv, controlaEstoque: opcao.controlaEstoque, padraoOpcao: opcao.padraoMarcada,
      })
      .from(complementoItem)
      .innerJoin(opcao, eq(opcao.id, complementoItem.opcaoId))
      .where(and(eq(complementoItem.complementoId, comp.id), isNull(complementoItem.deletedAt), isNull(opcao.deletedAt)))
      .orderBy(complementoItem.ordem);
    const unidades = await fichas.unidadesDosItens(tenantId, itens.map((it: any) => (it.tipo === 'insumo' ? it.itemId : null)));
    for (const [j, it] of itens.entries()) {
      const informativa = !(it.codigoPdv ?? '').trim();
      const u = it.tipo === 'insumo' && it.itemId && it.itemUnidade ? unidades.get(it.itemId) : undefined;
      const fator = u ? fatorParaEstoque(it.itemUnidade, u.unidade, u.conversoes) : null;
      await db.insert(complementoOpcao).values({
        tenantId, grupoId: g.id, nome: it.nome,
        precoDelta: informativa ? '0' : it.preco != null ? String(it.preco) : '0',
        itemId: informativa ? null : it.tipo === 'insumo' ? it.itemId ?? null : null,
        produtoRefId: informativa ? null : it.tipo !== 'insumo' ? it.produtoRefId ?? null : null,
        quantidade: String(fator == null ? 1 : arredondarEstoque(fator)),
        codigoPdv: informativa ? null : it.codigoPdv,
        controlaEstoque: informativa ? false : !!it.controlaEstoque,
        padraoMarcada: !!(it.padraoItem || it.padraoOpcao),
        ordem: j, origemOpcaoId: it.opcaoId,
      });
    }
  }
}

descrever('materialização em lote (salvar opção/etapa)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  let consultas = 0;
  const db = drizzle(pool, { logger: { logQuery: () => void consultas++ } }) as any;
  const fichas = new FichasService(db);
  const produtos = new ProdutoService(db, { registrar: async () => undefined } as any, undefined as any, fichas);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'item_conversao', 'item_estoque', 'produto'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  }, 120_000);

  // Uma empresa com o cardápio de teste: insumo com conversão, opção informativa, opção de
  // revenda, opção e item apagados, etapa desligada, etapa apagada, grupo manual e grupo antigo.
  async function cenario(extras = 0) {
    const t = await um(`insert into empresa (nome) values ('teste materializar') returning id`);
    empresas.push(t);
    const bacon = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Bacon', 'kg') returning id`, [t]);
    await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1, $2, 'kg', 72, 'unidade')`, [t, bacon]);
    const carne = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Carne 120gr', 'unidade') returning id`, [t]);
    const refri = await um(`insert into produto (tenant_id, nome) values ($1, 'Refri lata') returning id`, [t]);
    const op = async (nome: string, extra: string, valores: any[]) =>
      um(`insert into opcao (tenant_id, nome${extra ? ', ' + extra : ''}) values ($1, $2${valores.map((_, i) => `, $${i + 3}`).join('')}) returning id`, [t, nome, ...valores]);
    const o = {
      bacon: await op('Bacon', 'tipo, item_id, item_unidade, codigo_pdv, controla_estoque', ['insumo', bacon, 'unidade', 'B1', true]),
      carne: await op('Carne 120 gr', 'tipo, item_id, codigo_pdv, controla_estoque', ['insumo', carne, 'C1', true]),
      ponto: await op('Ao ponto', '', []),
      malPassado: await op('Mal passado', 'padrao_marcada', [true]),
      refri: await op('Refri', 'produto_ref_id, codigo_pdv', [refri, 'R1']),
      apagada: await op('Apagada', 'codigo_pdv, deleted_at', ['X1', new Date()]),
    };
    const comp = async (nome: string, extra = '', valores: any[] = []) =>
      um(`insert into complemento (tenant_id, nome${extra ? ', ' + extra : ''}) values ($1, $2${valores.map((_, i) => `, $${i + 3}`).join('')}) returning id`, [t, nome, ...valores]);
    const k = {
      adicionais: await comp('Adicionais', 'min, max', [0, 3]),
      pontoCarne: await comp('Ponto da carne', 'min, max, obrigatorio', [1, 1, true]),
      desligada: await comp('Desligada', 'ativo', [false]),
      apagada: await comp('Etapa apagada', 'deleted_at', [new Date()]),
    };
    const item = (c: string, o2: string, preco: string, ordem: number, extra = '', v: any[] = []) =>
      q(`insert into complemento_item (tenant_id, complemento_id, opcao_id, preco, ordem${extra ? ', ' + extra : ''}) values ($1, $2, $3, $4, $5${v.map((_, i) => `, $${i + 6}`).join('')})`, [t, c, o2, preco, ordem, ...v]);
    await item(k.adicionais, o.bacon, '4', 0);
    await item(k.adicionais, o.carne, '6.5', 1);
    await item(k.adicionais, o.refri, '5', 2);
    await item(k.adicionais, o.apagada, '1', 3);
    await item(k.adicionais, o.ponto, '9', 4, 'deleted_at', [new Date()]);
    await item(k.pontoCarne, o.ponto, '0', 0, 'padrao_marcada', [true]);
    await item(k.pontoCarne, o.malPassado, '0', 1);
    await item(k.desligada, o.bacon, '1', 0);
    const prod = (nome: string) => um(`insert into produto (tenant_id, nome) values ($1, $2) returning id`, [t, nome]);
    const p = { xBurger: await prod('X-burger'), xBacon: await prod('X-bacon'), simples: await prod('Simples'), soApagada: await prod('Só etapa apagada'), semEtapa: await prod('Sem etapa') };
    const liga = (pr: string, c: string, ordem: number) => q(`insert into produto_complemento (tenant_id, produto_id, complemento_id, ordem) values ($1, $2, $3, $4)`, [t, pr, c, ordem]);
    await liga(p.xBurger, k.adicionais, 0);
    await liga(p.xBurger, k.desligada, 1);
    await liga(p.xBurger, k.pontoCarne, 2);
    await liga(p.xBacon, k.pontoCarne, 0);
    await liga(p.xBacon, k.adicionais, 1);
    await liga(p.simples, k.pontoCarne, 0);
    await liga(p.soApagada, k.apagada, 0);
    const mais: string[] = [];
    for (let i = 0; i < extras; i++) {
      const pr = await prod(`Lanche ${i}`);
      await liga(pr, k.adicionais, 0);
      await liga(pr, k.pontoCarne, 1);
      mais.push(pr);
    }
    // Grupo MANUAL (editor antigo, sem origem) — não pode ser tocado.
    const manual = await um(`insert into complemento_grupo (tenant_id, produto_id, nome, tipo, ordem) values ($1, $2, 'Retirar', 'remover', 9) returning id`, [t, p.xBurger]);
    await q(`insert into complemento_opcao (tenant_id, grupo_id, nome) values ($1, $2, 'Sem cebola')`, [t, manual]);
    return { t, o, k, p, mais, manual, todos: [...Object.values(p), ...mais] };
  }

  // O que está VIVO em cada produto, sem ids nem datas (os ids são novos a cada regeração).
  async function retrato(t: string) {
    const linhas = await q(
      `select pr.nome as produto, g.nome as grupo, g.tipo, g.min, g.max, g.obrigatorio, g.ordem as g_ordem,
              (g.origem_complemento_id is not null) as materializado, oc.nome as origem_etapa,
              o.nome as opcao, o.preco_delta::text as preco, ie.nome as item, rp.nome as produto_ref,
              o.quantidade::text as quantidade, o.codigo_pdv, o.controla_estoque, o.padrao_marcada, o.ordem as o_ordem,
              op.nome as origem_opcao
         from complemento_grupo g
         join produto pr on pr.id = g.produto_id
         left join complemento oc on oc.id = g.origem_complemento_id
         left join complemento_opcao o on o.grupo_id = g.id and o.deleted_at is null
         left join item_estoque ie on ie.id = o.item_id
         left join produto rp on rp.id = o.produto_ref_id
         left join opcao op on op.id = o.origem_opcao_id
        where g.tenant_id = $1 and g.deleted_at is null
        order by pr.nome, g.ordem, o.ordem`,
      [t],
    );
    return linhas.map((l) => JSON.stringify(l));
  }
  const vivos = async (t: string) =>
    (await q(`select count(*)::int as n from complemento_grupo where tenant_id = $1 and deleted_at is null and origem_complemento_id is not null`, [t]))[0].n as number;

  it('o resultado é o MESMO do algoritmo antigo (grupos, ordem, preços, quantidade do insumo, informativa, revenda)', async () => {
    const antigo = await cenario();
    for (const id of antigo.todos) await materializarAntigo(db, fichas, antigo.t, id);
    for (const id of antigo.todos) await materializarAntigo(db, fichas, antigo.t, id); // uma segunda vez: troca os antigos
    const novo = await cenario();
    await produtos.materializarProdutos(novo.t, novo.todos);
    await produtos.materializarProdutos(novo.t, novo.todos);

    const a = await retrato(antigo.t);
    const n = await retrato(novo.t);
    expect(n).toEqual(a);
    // E o que o cenário pede, para não comparar dois erros iguais:
    const texto = n.join('\n');
    expect(n.filter((l) => l.includes('"produto":"X-burger"') && l.includes('"materializado":true')).length).toBe(5); // Adicionais (3) + Ponto (2)
    expect(texto).toContain('"grupo":"Ponto da carne","tipo":"adicionar","min":1,"max":1,"obrigatorio":true,"g_ordem":2'); // a etapa desligada conta na ordem
    expect(texto).toContain('"opcao":"Bacon","preco":"4","item":"Bacon","produto_ref":null,"quantidade":"0.01388'); // 1 unidade de um bacon em kg (1 kg = 72)
    expect(texto).toContain('"opcao":"Ao ponto","preco":"0","item":null,"produto_ref":null,"quantidade":"1","codigo_pdv":null,"controla_estoque":false,"padrao_marcada":true'); // informativa
    expect(texto).toContain('"opcao":"Refri","preco":"5","item":null,"produto_ref":"Refri lata"');
    expect(texto).not.toContain('"opcao":"Apagada"');
    expect(texto).not.toContain('Desligada');
    expect(texto).not.toContain('Etapa apagada');
    expect(texto).toContain('"grupo":"Retirar","tipo":"remover"'); // o manual continua
    expect(texto).toContain('"opcao":"Sem cebola"');
    // Os antigos foram trocados, não somados: 2 grupos no X-burger, 2 no X-bacon, 1 no Simples.
    expect(await vivos(novo.t)).toBe(5);
    const apagados = (await q(`select count(*)::int as n from complemento_grupo where tenant_id = $1 and deleted_at is not null`, [novo.t]))[0].n;
    expect(apagados).toBe(5);
  });

  it('salvar a opção regera só os produtos que a usam, cada um uma vez, com poucas consultas — com 3 ou com 33 produtos', async () => {
    // A mesma gravação da tela (a opção "Bacon" ligada ao insumo, 1 unidade) nos dois cenários.
    const salvarBacon = async (c: Awaited<ReturnType<typeof cenario>>) => {
      const [{ item_id }] = await q(`select item_id from opcao where id = $1`, [c.o.bacon]);
      consultas = 0;
      const inicio = Date.now();
      await produtos.atualizarOpcao(c.t, c.o.bacon, { nome: 'Bacon fatiado', tipo: 'insumo', itemId: item_id, itemUnidade: 'unidade', codigoPdv: 'B1', controlaEstoque: true });
      return { consultas, ms: Date.now() - inicio };
    };
    const pequeno = await cenario(0);
    await produtos.materializarProdutos(pequeno.t, pequeno.todos);
    const comPoucos = (await salvarBacon(pequeno)).consultas;

    const grande = await cenario(30);
    await produtos.materializarProdutos(grande.t, grande.todos);
    const simplesAntes = await q(`select id from complemento_grupo where tenant_id = $1 and produto_id = $2 and deleted_at is null`, [grande.t, grande.p.simples]);
    const { consultas: comMuitos, ms } = await salvarBacon(grande);

    // Antes: ~6 consultas por linha de cada produto (32 produtos × 5 linhas = centenas). Agora não cresce.
    expect(comMuitos).toBe(comPoucos);
    expect(comMuitos).toBeLessThanOrEqual(15);
    console.log(`  salvar a opção em 32 produtos: ${comMuitos} consultas, ${ms} ms (banco local)`);
    // O nome novo chegou aos produtos que usam a etapa "Adicionais" (X-burger, X-bacon e os 30)...
    const comNome = (await q(`select count(distinct g.produto_id)::int as n from complemento_opcao o join complemento_grupo g on g.id = o.grupo_id
                               where o.tenant_id = $1 and o.deleted_at is null and g.deleted_at is null and o.nome = 'Bacon fatiado'`, [grande.t]))[0].n;
    expect(comNome).toBe(32);
    // ...e o "Simples", que não usa a opção, ficou como estava (os mesmos grupos, não regerados).
    const simplesDepois = await q(`select id from complemento_grupo where tenant_id = $1 and produto_id = $2 and deleted_at is null`, [grande.t, grande.p.simples]);
    expect(simplesDepois).toEqual(simplesAntes);
    expect(await vivos(grande.t)).toBe(5 + 30 * 2);
  });

  it('duas gravações ao mesmo tempo no mesmo produto não duplicam os grupos', async () => {
    const c = await cenario(5);
    await Promise.all([
      produtos.materializarProdutos(c.t, c.todos),
      produtos.materializarProdutos(c.t, [c.p.xBurger, c.p.xBacon]),
      produtos.materializarProdutos(c.t, c.todos),
    ]);
    expect(await vivos(c.t)).toBe(5 + 5 * 2);
    const porProduto = await q(
      `select produto_id, ordem, count(*)::int as n from complemento_grupo where tenant_id = $1 and deleted_at is null and origem_complemento_id is not null group by 1, 2 having count(*) > 1`,
      [c.t],
    );
    expect(porProduto).toEqual([]);
  });

  it('a etapa: excluir tira os grupos dela de todos os produtos de uma vez; produto sem etapa não muda nada', async () => {
    const c = await cenario(3);
    await produtos.materializarProdutos(c.t, c.todos);
    await produtos.excluirComplemento(c.t, c.k.adicionais);
    const texto = (await retrato(c.t)).join('\n');
    expect(texto).not.toContain('"grupo":"Adicionais"');
    expect(await vivos(c.t)).toBe(3 + 3); // só "Ponto da carne": X-burger, X-bacon, Simples e os 3 lanches
    await produtos.materializarProdutos(c.t, [c.p.semEtapa, c.p.soApagada]);
    await produtos.materializarProdutos(c.t, []);
    expect(await vivos(c.t)).toBe(6);
  });
});
