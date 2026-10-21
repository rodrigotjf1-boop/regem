import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OPÇÃO DO COMPLEMENTO NA TELA DO PRODUTO (Cadastros › Cardápio › produto › Complementos) — contra o Postgres real.
//
// O dono (21/10/2026): "no cadastro e opções dos complementos não tem como cadastrar o código PDV … como vamos associar
// um adicional de bacon ao PDV e dar baixa quando vendido?". A venda do canal acha o adicional PELO CÓDIGO PDV da opção
// (dentro do produto) e, sem código, a opção é só observação (mig 126): não cobra nem baixa. A tela do produto criava a
// opção sem código — e deixava criar e apagar opção nos grupos que vêm de uma etapa do catálogo, o que a próxima
// montagem desfazia.
//  · grupo PRÓPRIO: a opção nova leva o código PDV e "Controlar estoque" (só com código); um código, uma opção do produto;
//  · grupo de ETAPA do catálogo ainda ligada: criar/apagar opção e apagar o grupo dão 409 (edita-se no catálogo);
//  · grupo e produto de OUTRA empresa: 404, nada gravado.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('opcao-do-produto.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('opção do complemento na tela do produto', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const fichas = new FichasService(db);
  const produtos = new ProdutoService(db, { registrar: async () => undefined } as any, undefined as any, fichas);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'item_estoque', 'produto'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    }
    await pool.end();
  }, 120_000);

  // Uma empresa com um X-burger que usa a etapa "Adicionais" do catálogo (Bacon, código B1, controla estoque) e tem um
  // grupo próprio "Extras da casa". Outra empresa, com um produto e um grupo dela.
  async function cenario() {
    const t = await um(`insert into empresa (nome) values ('teste opção do produto') returning id`);
    const outra = await um(`insert into empresa (nome) values ('teste opção — outra empresa') returning id`);
    empresas.push(t, outra);
    const bacon = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Bacon', 'unidade') returning id`, [t]);
    const cheddar = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Cheddar', 'unidade') returning id`, [t]);
    const opBacon = await um(
      `insert into opcao (tenant_id, nome, tipo, item_id, codigo_pdv, controla_estoque) values ($1, 'Bacon', 'insumo', $2, 'B1', true) returning id`,
      [t, bacon],
    );
    const etapa = await um(`insert into complemento (tenant_id, nome, min, max) values ($1, 'Adicionais', 0, 3) returning id`, [t]);
    await q(`insert into complemento_item (tenant_id, complemento_id, opcao_id, preco, ordem) values ($1, $2, $3, 4, 0)`, [t, etapa, opBacon]);
    const xBurger = await um(`insert into produto (tenant_id, nome) values ($1, 'X-burger') returning id`, [t]);
    await q(`insert into produto_complemento (tenant_id, produto_id, complemento_id, ordem) values ($1, $2, $3, 0)`, [t, xBurger, etapa]);
    await produtos.materializarProduto(t, xBurger);
    const grupoEtapa = (await q(`select id from complemento_grupo where produto_id = $1 and origem_complemento_id is not null and deleted_at is null`, [xBurger]))[0].id;
    const opcaoEtapa = (await q(`select id from complemento_opcao where grupo_id = $1 and deleted_at is null`, [grupoEtapa]))[0].id;
    const proprio = (await produtos.criarGrupo(t, xBurger, { nome: 'Extras da casa', tipo: 'adicionar' })).id;
    const produtoOutra = await um(`insert into produto (tenant_id, nome) values ($1, 'Lanche da outra') returning id`, [outra]);
    const grupoOutra = (await produtos.criarGrupo(outra, produtoOutra, { nome: 'Da outra', tipo: 'adicionar' })).id;
    return { t, outra, xBurger, etapa, grupoEtapa, opcaoEtapa, proprio, grupoOutra, produtoOutra, cheddar };
  }

  const opcoesVivas = (grupoId: string) =>
    q(`select nome, codigo_pdv, controla_estoque, item_id::text as item from complemento_opcao where grupo_id = $1 and deleted_at is null order by created_at`, [grupoId]);

  it('grupo próprio: a opção leva o código PDV e "Controlar estoque" — sem código ela nasce informativa e sem controle', async () => {
    const c = await cenario();
    const o = await produtos.criarOpcao(c.t, c.proprio, { nome: 'Cheddar extra', precoDelta: 3, itemId: c.cheddar, quantidade: 1, codigoPdv: '  C9 ', controlaEstoque: true });
    expect(o.codigoPdv).toBe('C9');
    expect(o.controlaEstoque).toBe(true);
    // Sem código, "Controlar estoque" não vale (opção informativa nunca baixa).
    await produtos.criarOpcao(c.t, c.proprio, { nome: 'Sem cebola roxa', codigoPdv: '   ', controlaEstoque: true });
    // Com código e sem pedir controle: fica sem.
    await produtos.criarOpcao(c.t, c.proprio, { nome: 'Molho da casa', precoDelta: 2, codigoPdv: 'M7' });
    expect(await opcoesVivas(c.proprio)).toEqual([
      { nome: 'Cheddar extra', codigo_pdv: 'C9', controla_estoque: true, item: c.cheddar },
      { nome: 'Sem cebola roxa', codigo_pdv: null, controla_estoque: false, item: null },
      { nome: 'Molho da casa', codigo_pdv: 'M7', controla_estoque: false, item: null },
    ]);
  });

  it('um código, uma opção do produto: repetir o código (até o da etapa do catálogo) dá 409 e não grava', async () => {
    const c = await cenario();
    await produtos.criarOpcao(c.t, c.proprio, { nome: 'Cheddar extra', codigoPdv: 'C9' });
    await expect(produtos.criarOpcao(c.t, c.proprio, { nome: 'Cheddar duplo', codigoPdv: 'C9' })).rejects.toThrow(/C9 já está na opção "Cheddar extra"/);
    // O B1 é do Bacon da etapa do catálogo, no mesmo produto.
    const erro = await produtos.criarOpcao(c.t, c.proprio, { nome: 'Bacon da casa', codigoPdv: 'B1' }).catch((e) => e);
    expect(erro).toBeInstanceOf(ConflictException);
    expect(String(erro.message)).toContain('"Bacon"');
    expect((await opcoesVivas(c.proprio)).map((o: any) => o.nome)).toEqual(['Cheddar extra']);
  });

  it('código PDV inválido ou "Controlar estoque" que não é ligado/desligado: 400', async () => {
    const c = await cenario();
    await expect(produtos.criarOpcao(c.t, c.proprio, { nome: 'Longo', codigoPdv: 'x'.repeat(61) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(produtos.criarOpcao(c.t, c.proprio, { nome: 'Número', codigoPdv: 12 as any })).rejects.toBeInstanceOf(BadRequestException);
    await expect(produtos.criarOpcao(c.t, c.proprio, { nome: 'Texto', codigoPdv: 'T1', controlaEstoque: 'sim' as any })).rejects.toBeInstanceOf(BadRequestException);
    expect(await opcoesVivas(c.proprio)).toEqual([]);
  });

  it('grupo de etapa do catálogo ainda ligada: criar opção, apagar opção e apagar o grupo dão 409 — e nada muda', async () => {
    const c = await cenario();
    const criar = await produtos.criarOpcao(c.t, c.grupoEtapa, { nome: 'Morango', codigoPdv: 'V1' }).catch((e) => e);
    expect(criar).toBeInstanceOf(ConflictException);
    expect(String(criar.message)).toContain('Cadastros › Cardápio › Opções');
    expect(String(criar.message)).toContain('"Adicionais"');
    await expect(produtos.removerOpcao(c.t, c.opcaoEtapa)).rejects.toBeInstanceOf(ConflictException);
    await expect(produtos.removerGrupo(c.t, c.grupoEtapa)).rejects.toThrow(/desmarque a etapa/);
    expect(await opcoesVivas(c.grupoEtapa)).toEqual([{ nome: 'Bacon', codigo_pdv: 'B1', controla_estoque: true, item: expect.any(String) }]);
    expect((await q(`select deleted_at from complemento_grupo where id = $1`, [c.grupoEtapa]))[0].deleted_at).toBeNull();
  });

  it('grupo que sobrou de uma etapa que o produto não usa mais conta como do produto: dá para apagar', async () => {
    const c = await cenario();
    await q(`update produto_complemento set deleted_at = now() where produto_id = $1 and complemento_id = $2`, [c.xBurger, c.etapa]);
    await produtos.removerOpcao(c.t, c.opcaoEtapa);
    await produtos.removerGrupo(c.t, c.grupoEtapa);
    expect(await opcoesVivas(c.grupoEtapa)).toEqual([]);
    expect((await q(`select deleted_at from complemento_grupo where id = $1`, [c.grupoEtapa]))[0].deleted_at).not.toBeNull();
  });

  it('grupo próprio: apagar a opção e o grupo continua funcionando', async () => {
    const c = await cenario();
    const o = await produtos.criarOpcao(c.t, c.proprio, { nome: 'Cheddar extra', codigoPdv: 'C9' });
    await produtos.removerOpcao(c.t, o.id);
    expect(await opcoesVivas(c.proprio)).toEqual([]);
    await produtos.removerGrupo(c.t, c.proprio);
    expect((await q(`select deleted_at from complemento_grupo where id = $1`, [c.proprio]))[0].deleted_at).not.toBeNull();
  });

  it('grupo ou produto de OUTRA empresa: 404 e nada gravado', async () => {
    const c = await cenario();
    await expect(produtos.criarOpcao(c.t, c.grupoOutra, { nome: 'Intrusa', codigoPdv: 'Z1' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(produtos.criarGrupo(c.t, c.produtoOutra, { nome: 'Intruso', tipo: 'adicionar' })).rejects.toBeInstanceOf(NotFoundException);
    expect(await opcoesVivas(c.grupoOutra)).toEqual([]);
    expect(await q(`select id from complemento_grupo where produto_id = $1 and tenant_id = $2`, [c.produtoOutra, c.t])).toEqual([]);
  });
});
