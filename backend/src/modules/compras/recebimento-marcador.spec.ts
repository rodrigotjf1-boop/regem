import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from '../estoque/estoque.service';
import { acharMarca } from '../estoque/produto-nome';
import { ComprasService } from './compras.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COMPRAS: marcador de recebimento, falta informada, 2ª opção de marca e a lista do que faltou —
// pedidos do dono em 09/10/2026:
//   "em recebimento um marcador confirmando o recebimento … caso não seja marcado é porque não veio
//    o item"; "tem momentos que o item vem só uma parte, ex.: pedido 10 barras, só chegou 5 — a
//    quantidade faltante estar informada"; "na hora de realizar o pedido, ter a opção de adicionar
//    opção B do produto: marca [A] (segunda opção caso não tenha: marca [B])".
// Decisão dele sobre a falta: fica informada e a tela oferece gerar uma lista nova só com ela.

describe('marca do cadastro que corresponde ao texto informado', () => {
  it('acha sem diferenciar maiúscula e acento, devolve a grafia do cadastro; o que não existe é null', () => {
    const marcas = ['Marca Alfa', 'Marca Épsilon'];
    expect(acharMarca(marcas, ' marca alfa ')).toBe('Marca Alfa');
    expect(acharMarca(marcas, 'MARCA EPSILON')).toBe('Marca Épsilon');
    expect(acharMarca(marcas, 'Marca Gama')).toBeNull();
    expect(acharMarca(marcas, '')).toBeNull();
    expect(acharMarca(marcas, undefined)).toBeNull();
    expect(acharMarca([], 'Marca Alfa')).toBeNull();
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('recebimento-marcador.spec: sem TEST_PG_URL — parte com banco PULADA');
jest.setTimeout(120_000);

descrever('compras: marcador de recebimento, falta, 2ª opção de marca e lista do que faltou (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const compras = () => new (ComprasService as any)(db, { emit: () => true }, auditoria) as ComprasService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['titulo_financeiro', 'lote', 'movimento_estoque', 'compra_item', 'compra_lista', 'item_estoque_unidade', 'item_conversao', 'item_fornecedor', 'item_estoque', 'fornecedor', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Uma loja com fornecedor e três produtos: duas marcas, uma marca e nenhuma.
  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Recebe teste ${t.slice(0, 6)}`]);
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const f = (await q(`insert into fornecedor (tenant_id, nome) values ($1, 'Fornecedor de teste') returning id`, [t]))[0].id as string;
    const s = estoque();
    const queijo: any = await s.createItem(t, { nome: 'Fatia de queijo de teste', nomeComercial: 'Barra de queijo de teste', marcas: ['Marca Alfa', 'Marca Beta', 'Marca Gama'], unidadeMedida: 'unidade' } as any, null, ator);
    const carne: any = await s.createItem(t, { nome: 'Carne de teste', marcas: ['Marca Delta'], unidadeMedida: 'unidade' } as any, null, ator);
    const sal: any = await s.createItem(t, { nome: 'Sal de teste', unidadeMedida: 'kg' } as any, null, ator);
    return { t, u, f, queijo, carne, sal, c: compras() };
  }
  const saldo = async (itemId: string) =>
    Number((await q(`select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end), 0)::float8 as s from movimento_estoque where item_id = $1`, [itemId]))[0].s);
  const linhas = async (listaId: string) =>
    q(`select i.nome, ci.id, ci.quantidade::float8 as pedido, ci.qtd_recebida::float8 as recebido, ci.divergencia, ci.marca, ci.marca_alternativa as segunda, ci.marca_recebida as veio,
              ci.validade::text as validade, ci.validade_indefinida as indefinida, ci.custo_unitario::float8 as custo
         from compra_item ci join item_estoque i on i.id = ci.item_id where ci.lista_id = $1 order by i.nome`, [listaId]);
  // Lista de 10 de cada produto; devolve o id da lista e o id de cada linha, pelo nome do produto.
  async function listaDeDez(x: Awaited<ReturnType<typeof cenario>>, nome = 'Compra de teste') {
    const l: any = await x.c.createLista(x.t, {
      nome, fornecedorId: x.f,
      itens: [
        { itemId: x.queijo.id, quantidade: 10, custoUnitario: 4, marca: 'Marca Alfa', marcaAlternativa: 'marca beta' },
        { itemId: x.carne.id, quantidade: 10, custoUnitario: 2 },
        { itemId: x.sal.id, quantidade: 10 },
      ],
    } as any, x.u);
    const por = Object.fromEntries((await linhas(l.id)).map((r: any) => [r.nome, r.id as string]));
    return { id: l.id as string, queijo: por['Fatia de queijo de teste'], carne: por['Carne de teste'], sal: por['Sal de teste'] };
  }

  it('2ª opção de marca: outra marca do mesmo produto, opcional; igual à 1ª ou fora do cadastro é recusada', async () => {
    const x = await cenario();
    const nova = (itens: any[]) => x.c.createLista(x.t, { nome: 'Compra de teste', itens } as any, x.u) as Promise<any>;
    await expect(nova([{ itemId: x.queijo.id, quantidade: 1, marca: 'Marca Alfa', marcaAlternativa: 'marca alfa' }])).rejects.toThrow(/A 2ª opção de "Barra de queijo de teste" tem de ser uma marca diferente da 1ª \(Marca Alfa\)/);
    await expect(nova([{ itemId: x.queijo.id, quantidade: 1, marca: 'Marca Alfa', marcaAlternativa: 'Marca Delta' }])).rejects.toThrow(/"Marca Delta" não é marca cadastrada de "Barra de queijo de teste"/);
    await expect(nova([{ itemId: x.queijo.id, quantidade: 1, marca: 'Marca Alfa', marcaAlternativa: 'Marca Delta' }])).rejects.toThrow(BadRequestException);
    expect(await q(`select 1 from compra_lista where tenant_id = $1`, [x.t])).toHaveLength(0);

    const l = await nova([
      { itemId: x.queijo.id, quantidade: 2, marca: 'marca alfa', marcaAlternativa: 'MARCA BETA' }, // vale a grafia do cadastro
      { itemId: x.carne.id, quantidade: 1, marcaAlternativa: 'Marca Delta' }, // uma marca só: não há 2ª opção
      { itemId: x.sal.id, quantidade: 1, marcaAlternativa: 'Qualquer' }, // sem marca: nada
    ]);
    expect((await linhas(l.id)).map((r: any) => [r.nome, r.marca, r.segunda])).toEqual([
      ['Carne de teste', 'Marca Delta', null],
      ['Fatia de queijo de teste', 'Marca Alfa', 'Marca Beta'],
      ['Sal de teste', null, null],
    ]);
    const sem = await nova([{ itemId: x.queijo.id, quantidade: 2, marca: 'Marca Gama' }]); // a 2ª opção é opcional
    expect((await linhas(sem.id))[0]).toMatchObject({ marca: 'Marca Gama', segunda: null });
    // quem abre a lista recebe a 2ª opção e as marcas do cadastro (para dizer qual veio)
    const aberta: any = await x.c.getLista(x.t, l.id, x.u);
    expect(aberta.itens.find((i: any) => i.itemId === x.queijo.id)).toMatchObject({ marca: 'Marca Alfa', marcaAlternativa: 'Marca Beta', marcaRecebida: null, marcas: ['Marca Alfa', 'Marca Beta', 'Marca Gama'] });
  });

  it('nenhum item marcado: a compra não é recebida e a lista continua aguardando', async () => {
    const x = await cenario();
    const l = await listaDeDez(x);
    await expect(x.c.receber(x.t, l.id, null, { itens: [l.queijo, l.carne, l.sal].map((id) => ({ compraItemId: id, qtdRecebida: 0 })) } as any, x.u))
      .rejects.toThrow(/Nenhum item foi marcado como recebido/);
    expect((await q(`select status from compra_lista where id = $1`, [l.id]))[0].status).toBe('aberta');
    expect(await q(`select 1 from movimento_estoque where tenant_id = $1`, [x.t])).toHaveLength(0);
    expect((await linhas(l.id)).every((r: any) => r.recebido === null)).toBe(true); // nada ficou gravado pela metade
  });

  it('receber: não marcado = não veio (sem pedir validade); veio uma parte = entra só o que chegou e a falta fica contada', async () => {
    const x = await cenario();
    const l = await listaDeDez(x);
    const r: any = await x.c.receber(x.t, l.id, null, {
      itens: [
        { compraItemId: l.queijo, qtdRecebida: 5, validade: '2027-01-31', loteCodigo: 'L-01' }, // pediu 10, vieram 5
        { compraItemId: l.carne, qtdRecebida: 0 }, // não marcado: sem validade, sem lote
        { compraItemId: l.sal, qtdRecebida: 10, validadeIndefinida: true }, // veio tudo
      ],
    } as any, x.u);
    expect(r).toEqual({ ok: true, itensComFalta: 2 });
    expect(await linhas(l.id)).toEqual([
      expect.objectContaining({ nome: 'Carne de teste', pedido: 10, recebido: 0, divergencia: 'nao_veio', validade: null, indefinida: false, veio: null }),
      expect.objectContaining({ nome: 'Fatia de queijo de teste', pedido: 10, recebido: 5, divergencia: 'parcial', validade: '2027-01-31', veio: 'Marca Alfa' }), // em branco: vale a pedida
      expect.objectContaining({ nome: 'Sal de teste', pedido: 10, recebido: 10, divergencia: 'ok', indefinida: true, veio: null }), // produto sem marca
    ]);
    // estoque: só o que chegou — e UM saldo por produto
    expect([await saldo(x.queijo.id), await saldo(x.carne.id), await saldo(x.sal.id)]).toEqual([5, 0, 10]);
    // a conta a pagar é pelo que chegou: 5 × 4 (o sal não tem custo, a carne não veio)
    expect(await q(`select valor::float8 as valor, origem from titulo_financeiro where tenant_id = $1`, [x.t])).toEqual([{ valor: 20, origem: 'compra' }]);
    expect((await q(`select status from compra_lista where id = $1`, [l.id]))[0].status).toBe('recebida');

    // a lista de compras mostra quantos itens ficaram com falta
    const listas: any[] = await x.c.listListas(x.t, x.u);
    expect(listas.find((i) => i.id === l.id)).toMatchObject({ status: 'recebida', itens: 3, itensComFalta: 2, temListaDoQueFaltou: false });
    // a memória de validade não aprende com o que não veio
    const outra = await listaDeDez(x, 'Segunda compra de teste');
    const aberta: any = await x.c.getLista(x.t, outra.id, x.u);
    expect(aberta.itens.find((i: any) => i.itemId === x.carne.id).sugestao).toBeNull();
    expect(aberta.itens.find((i: any) => i.itemId === x.sal.id).sugestao).toEqual({ validadeIndefinida: true });
    // lista ainda não recebida não tem "falta"
    expect(((await x.c.listListas(x.t, x.u)) as any[]).find((i) => i.id === outra.id)).toMatchObject({ status: 'aberta', itensComFalta: 0 });
  });

  it('item marcado continua pedindo a validade; e a marca que veio tem de ser do cadastro do produto', async () => {
    const x = await cenario();
    const l = await listaDeDez(x);
    const base = [{ compraItemId: l.carne, qtdRecebida: 10, validadeIndefinida: true }, { compraItemId: l.sal, qtdRecebida: 0 }];
    await expect(x.c.receber(x.t, l.id, null, { itens: [{ compraItemId: l.queijo, qtdRecebida: 3 }, ...base] } as any, x.u))
      .rejects.toThrow(/Informe a validade de cada linha/);
    await expect(x.c.receber(x.t, l.id, null, { itens: [{ compraItemId: l.queijo, qtdRecebida: 3, validadeIndefinida: true, marcaRecebida: 'Marca Delta' }, ...base] } as any, x.u))
      .rejects.toThrow(/"Marca Delta" não é marca cadastrada de "Barra de queijo de teste"/);
    // as recusas desfizeram tudo: nada entrou, a lista continua aberta
    expect([await saldo(x.queijo.id), await saldo(x.carne.id)]).toEqual([0, 0]);
    expect((await q(`select status from compra_lista where id = $1`, [l.id]))[0].status).toBe('aberta');

    // veio a 2ª opção: fica registrada a marca que veio, ao lado da pedida — e o estoque é o do produto
    await x.c.receber(x.t, l.id, null, { itens: [{ compraItemId: l.queijo, qtdRecebida: 10, validadeIndefinida: true, marcaRecebida: 'marca beta' }, ...base] } as any, x.u);
    expect((await linhas(l.id)).find((r: any) => r.nome === 'Fatia de queijo de teste')).toMatchObject({ marca: 'Marca Alfa', segunda: 'Marca Beta', veio: 'Marca Beta', recebido: 10, divergencia: 'ok' });
    expect((await linhas(l.id)).find((r: any) => r.nome === 'Carne de teste')).toMatchObject({ veio: 'Marca Delta' }); // uma marca só
    expect(await saldo(x.queijo.id)).toBe(10);
    expect(await q(`select count(*)::int as n from item_estoque where tenant_id = $1 and deleted_at is null`, [x.t])).toEqual([{ n: 3 }]);
    const aberta: any = await x.c.getLista(x.t, l.id, x.u);
    expect(aberta.itens.find((i: any) => i.itemId === x.queijo.id)).toMatchObject({ marcaRecebida: 'Marca Beta' });
  });

  it('lista do que faltou: só as quantidades que não vieram, com o mesmo fornecedor e as mesmas marcas; uma só por lista', async () => {
    const x = await cenario();
    const l = await listaDeDez(x);
    // antes de receber não há falta
    await expect(x.c.gerarListaDoQueFaltou(x.t, l.id, undefined, x.u)).rejects.toThrow(/só existe depois de conferir e receber/);
    await x.c.receber(x.t, l.id, null, {
      itens: [
        { compraItemId: l.queijo, qtdRecebida: 9.7, validadeIndefinida: true }, // faltaram 0,3
        { compraItemId: l.carne, qtdRecebida: 0 }, // não veio: faltam 10
        { compraItemId: l.sal, qtdRecebida: 12, validadeIndefinida: true }, // veio a mais: não é falta
      ],
    } as any, x.u);

    // dois pedidos ao mesmo tempo (duplo clique): nasce UMA lista
    const [a, b]: any[] = await Promise.all([
      x.c.gerarListaDoQueFaltou(x.t, l.id, { dataRecebimento: '2026-10-20' }, x.u),
      x.c.gerarListaDoQueFaltou(x.t, l.id, { dataRecebimento: '2026-10-20' }, x.u),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.jaExistia, b.jaExistia].sort()).toEqual([false, true]);
    const nova = a.jaExistia ? b : a;
    expect(nova).toMatchObject({ nome: 'Faltou de: Compra de teste', itens: 2, semProduto: 0 });
    expect(await q(`select count(*)::int as n from compra_lista where tenant_id = $1 and origem_lista_id = $2`, [x.t, l.id])).toEqual([{ n: 1 }]);

    const [cab] = await q(`select nome, status, fornecedor_id, unidade_id, data_recebimento::text as data, origem_lista_id from compra_lista where id = $1`, [nova.id]);
    expect(cab).toEqual({ nome: 'Faltou de: Compra de teste', status: 'aberta', fornecedor_id: x.f, unidade_id: x.u, data: '2026-10-20', origem_lista_id: l.id });
    expect((await linhas(nova.id)).map((r: any) => [r.nome, r.pedido, r.recebido, r.marca, r.segunda, r.custo])).toEqual([
      ['Carne de teste', 10, null, 'Marca Delta', null, 2],
      ['Fatia de queijo de teste', 0.3, null, 'Marca Alfa', 'Marca Beta', 4], // 10 − 9,7 = 0,3 exato
    ]);

    // as duas listas se apontam
    const origem: any = await x.c.getLista(x.t, l.id, x.u);
    expect(origem.listaDoQueFaltou).toEqual({ id: nova.id, nome: 'Faltou de: Compra de teste' });
    const filha: any = await x.c.getLista(x.t, nova.id, x.u);
    expect(filha.origem).toEqual({ id: l.id, nome: 'Compra de teste' });
    expect(((await x.c.listListas(x.t, x.u)) as any[]).find((i) => i.id === l.id)).toMatchObject({ itensComFalta: 2, temListaDoQueFaltou: true });

    // excluída a lista nova, dá para gerar de novo; e a falta DELA não repete o prefixo no nome
    await x.c.removerLista(x.t, nova.id, x.u);
    const de_novo: any = await x.c.gerarListaDoQueFaltou(x.t, l.id, undefined, x.u);
    expect(de_novo).toMatchObject({ jaExistia: false, itens: 2 });
    const ids = Object.fromEntries((await linhas(de_novo.id)).map((r: any) => [r.nome, r.id]));
    await x.c.receber(x.t, de_novo.id, null, { itens: [{ compraItemId: ids['Carne de teste'], qtdRecebida: 4, validadeIndefinida: true }, { compraItemId: ids['Fatia de queijo de teste'], qtdRecebida: 0.3, validadeIndefinida: true }] } as any, x.u);
    const neta: any = await x.c.gerarListaDoQueFaltou(x.t, de_novo.id, undefined, x.u);
    expect(neta).toMatchObject({ nome: 'Faltou de: Compra de teste', itens: 1 });
    expect((await linhas(neta.id)).map((r: any) => [r.nome, r.pedido])).toEqual([['Carne de teste', 6]]);
    expect(await saldo(x.carne.id)).toBe(4);
  });

  it('lista do que faltou: recusa quando veio tudo e deixa de fora o produto que foi excluído', async () => {
    const x = await cenario();
    const tudo = await listaDeDez(x, 'Veio tudo de teste');
    await x.c.receber(x.t, tudo.id, null, { itens: [tudo.queijo, tudo.carne, tudo.sal].map((id) => ({ compraItemId: id, qtdRecebida: 10, validadeIndefinida: true })) } as any, x.u);
    await expect(x.c.gerarListaDoQueFaltou(x.t, tudo.id, undefined, x.u)).rejects.toThrow(/Não faltou nada nesta lista/);

    const l = await listaDeDez(x, 'Faltou de teste');
    await x.c.receber(x.t, l.id, null, { itens: [{ compraItemId: l.queijo, qtdRecebida: 4, validadeIndefinida: true }, { compraItemId: l.carne, qtdRecebida: 0 }, { compraItemId: l.sal, qtdRecebida: 10, validadeIndefinida: true }] } as any, x.u);
    await q(`update item_estoque set deleted_at = now() where id = $1`, [x.carne.id]); // excluído depois da compra
    const nova: any = await x.c.gerarListaDoQueFaltou(x.t, l.id, undefined, x.u);
    expect(nova).toMatchObject({ itens: 1, semProduto: 1, jaExistia: false });
    expect((await linhas(nova.id)).map((r: any) => [r.nome, r.pedido])).toEqual([['Fatia de queijo de teste', 6]]);
    // de outra loja não se gera nem se vê
    const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Outra loja de teste') returning id`, [x.t]))[0].id as string;
    await expect(x.c.gerarListaDoQueFaltou(x.t, tudo.id, undefined, outraLoja)).rejects.toThrow(/Lista não encontrada/);
  });
});
