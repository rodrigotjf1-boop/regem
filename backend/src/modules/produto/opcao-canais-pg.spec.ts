import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { randomBytes } from 'crypto';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';
import { MODULO_IFOOD_PELO_ORZUNI } from '../../common/ifood-pelo-orzuni';
import { MODULO_PRECOS_NA_99 } from '../../common/precos-na-99';
import { opcaoForaDeVenda } from '../cardapio/opcao-fora-de-venda';
import { exigirCanalDePrecoDaOpcao, exigirIdDaOpcao, precoDaOpcaoNoApp, precoNoGrupoDoPedido } from './produto-canais';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GESTÃO DO CATÁLOGO › COMPLEMENTOS (R3 F3a) — o preço do complemento no grupo do Regem, o preço de cada app (um por
// código) e a pausa de cada canal (`opcao.canais_pausados`, mig 401). As regras sem banco; o resto contra o Postgres
// (TEST_PG_URL) com o serviço de verdade.
//
// O que se prova:
//   • a pausa por canal põe/tira SÓ aquele canal, com auditoria, SEM refazer os grupos dos produtos (os ids ficam);
//     a do Regem tira a opção da leitura de VENDA (balcão) e não da do Cadastros; iFood e 99 só com o direito; nada
//     com um servidor de loja abaixo da versão da mig 401;
//   • o preço no app (iFood/99): direito, auditoria, vazio limpa, zero vale;
//   • o preço no grupo: grava, refaz o preço materializado dos produtos do grupo, audita (de → para com 2 casas);
//   • a leitura da aba traz os grupos, as opções e os produtos; a lista das opções traz os campos novos (ERR-216);
//   • o cardápio (`opcaoForaDeVenda`) tira a opção pausada no Regem e não a pausada só num app.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('opcao-canais-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

describe('regras do complemento por canal (sem banco)', () => {
  it('id, canal do preço e o preço no app: zero vale (grátis lá), vazio limpa, ausente é erro', () => {
    expect(() => exigirIdDaOpcao('1 or 1=1')).toThrow(/Complemento inválido/);
    expect(() => exigirIdDaOpcao('x', 'Grupo de complementos inválido.')).toThrow(/Grupo/);
    expect(exigirCanalDePrecoDaOpcao('99food')).toBe('99food');
    expect(() => exigirCanalDePrecoDaOpcao('regem')).toThrow(/o do Regem é o de cada grupo/);
    expect(precoDaOpcaoNoApp('4,5', 'ifood')).toBe('4.50');
    expect(precoDaOpcaoNoApp(0, '99food')).toBe('0.00');
    expect(precoDaOpcaoNoApp('', 'ifood')).toBeNull();
    expect(() => precoDaOpcaoNoApp(undefined, '99food')).toThrow(/Informe o preço na 99/);
    expect(() => precoDaOpcaoNoApp(-1, 'ifood')).toThrow(/Preço no iFood inválido/);
  });
  it('o preço no grupo: obrigatório, de zero para cima, até 2 casas', () => {
    expect(precoNoGrupoDoPedido('6,5')).toBe('6.50');
    expect(precoNoGrupoDoPedido(0)).toBe('0.00');
    for (const v of ['', null, undefined, -1, 'abc', 1.234, 1_000_000]) expect(() => precoNoGrupoDoPedido(v)).toThrow(/Preço do complemento/);
  });
  it('o cardápio: pausado no Regem sai; pausado só no iFood ou na 99 fica', () => {
    expect(opcaoForaDeVenda({ ativo: true, esgotado: false, canaisPausados: ['regem'] })).toBe(true);
    expect(opcaoForaDeVenda({ ativo: true, esgotado: false, canaisPausados: ['ifood', '99food'] })).toBe(false);
    expect(opcaoForaDeVenda({ ativo: true, esgotado: false, canaisPausados: null })).toBe(false);
    expect(opcaoForaDeVenda({ ativo: true, esgotado: true })).toBe(true);
  });
});

descrever('complemento por canal (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditados.push(a) } as any;
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, new FichasService(db)) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const ator = { id: null, perfil: 'gerente' };

  beforeAll(async () => {
    // `edge_status` é só da nuvem; outras specs a criam com o mínimo — aqui ela ganha as colunas que a trava de versão lê.
    await pool
      .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid,
                unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    await pool.query(`alter table edge_status add column if not exists equipamento_id uuid, add column if not exists versao text`);
  });

  afterAll(async () => {
    if (empresas.length) {
      await pool.query(`delete from edge_status where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      for (const t of ['complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao',
        'produto', 'categoria_produto', 'entitlement', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Uma empresa com a opção "Bacon extra" (A01) no grupo "Adicionais" (R$ 5) de um produto, materializado.
  async function loja(direitos: string[] = []) {
    const t = (await q(`insert into empresa (nome) values ('teste complemento por canal') returning id`))[0].id as string;
    empresas.push(t);
    const un = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [t]))[0].id as string;
    for (const m of direitos)
      await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || $3)::uuid, $2, $3, true)`, [t, t, m]);
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    const p = (
      await q(`insert into produto (tenant_id, nome, codigo, categoria_id, preco_venda) values ($1, 'X-Bacon', '2051', $2, 39.9) returning id`, [t, cat])
    )[0].id as string;
    const op: any = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon extra', codigoPdv: 'A01', tipo: 'simples' });
    const grupo: any = await produtos.criarComplemento(t, { nome: 'Adicionais', regra: 'varias_sem_repeticao', itens: [{ opcaoId: op.id, preco: 5 }] });
    await produtos.setProdutoComplementos(t, p, [grupo.id]);
    return { t, un, p, op: op.id as string, grupo: grupo.id as string };
  }
  const idsMaterializados = async (p: string) =>
    (await q(`select o.id from complemento_opcao o join complemento_grupo g on g.id = o.grupo_id
               where g.produto_id = $1 and o.deleted_at is null and g.deleted_at is null order by o.id`, [p])).map((r: any) => r.id);
  const opcoesDeVenda = async (t: string, p: string) =>
    ((await produtos.getOne(t, p)) as any).complementos.flatMap((g: any) => g.opcoes.map((o: any) => o.nome));

  it('a leitura da aba: o grupo, a opção (preço no grupo, código, pausas, preços dos apps) e os produtos que o usam', async () => {
    const l = await loja();
    const r: any = await produtos.gestaoDosComplementos(l.t);
    expect(r.pausaBloqueada).toBeNull();
    expect(r.grupos).toHaveLength(1);
    const g = r.grupos[0];
    expect(g).toMatchObject({ id: l.grupo, nome: 'Adicionais', produtos: [{ id: l.p, nome: 'X-Bacon' }] });
    expect(g.opcoes).toEqual([
      expect.objectContaining({ opcaoId: l.op, nome: 'Bacon extra', codigoPdv: 'A01', esgotado: false, canaisPausados: [], precoIfood: null, preco99: null }),
    ]);
    expect(Number(g.opcoes[0].preco)).toBe(5);
    // A lista das opções (escrita à mão) traz os campos novos (ERR-216).
    expect((await produtos.listarOpcoes(l.t)).find((o: any) => o.id === l.op)).toMatchObject({ canaisPausados: [], preco99: null });
  });

  it('a pausa do Regem: só o "regem" na lista, auditada, sem refazer os grupos; sai da venda (balcão), fica no Cadastros', async () => {
    const l = await loja();
    const antes = await idsMaterializados(l.p);
    expect(await opcoesDeVenda(l.t, l.p)).toEqual(['Bacon extra']);
    auditados.length = 0;
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', true, ator)).toMatchObject({ mudou: true, canaisPausados: ['regem'], esgotado: false });
    expect(auditados).toEqual([expect.objectContaining({ acao: 'pausou_complemento_no_canal', entidadeTipo: 'opcao', entidadeId: l.op, detalhe: { nome: 'Bacon extra', canal: 'regem' } })]);
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', true, ator)).toMatchObject({ mudou: false });
    expect(auditados).toHaveLength(1);
    expect(await idsMaterializados(l.p)).toEqual(antes); // nada refeito: carrinho aberto não cai
    expect(await opcoesDeVenda(l.t, l.p)).toEqual([]);
    const cadastro = (await produtos.complementosDe(l.t, l.p)) as any[];
    expect(cadastro.flatMap((g) => g.opcoes.map((o: any) => o.nome))).toEqual(['Bacon extra']);
    // Reativar devolve à venda.
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', false, ator)).toMatchObject({ mudou: true, canaisPausados: [] });
    expect(await opcoesDeVenda(l.t, l.p)).toEqual(['Bacon extra']);
    await expect(produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'gogem', true, ator)).rejects.toThrow(/Canal inválido/);
    await expect(produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', 'sim', ator)).rejects.toThrow(/pausado/);
    await expect(produtos.pausaDaOpcaoNoCanal((await loja()).t, l.op, 'regem', true, ator)).rejects.toThrow(/não encontrado/);
  });

  it('iFood e 99: só com o direito; cada um põe só o seu canal (o "regem" e o outro app ficam)', async () => {
    const sem = await loja();
    await expect(produtos.pausaDaOpcaoNoCanal(sem.t, sem.op, 'ifood', true, ator)).rejects.toThrow(/iFood pelo Orzuni não está ligado/);
    await expect(produtos.pausaDaOpcaoNoCanal(sem.t, sem.op, '99food', true, ator)).rejects.toThrow(/99 não estão ligados/);
    const l = await loja([MODULO_IFOOD_PELO_ORZUNI, MODULO_PRECOS_NA_99]);
    await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', true, ator);
    await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'ifood', true, ator);
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, '99food', true, ator)).toMatchObject({ canaisPausados: ['regem', 'ifood', '99food'] });
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'ifood', false, ator)).toMatchObject({ canaisPausados: ['regem', '99food'] });
  });

  it('servidor de loja abaixo da versão da mig 401: a pausa não grava, com o motivo; na versão, grava', async () => {
    const l = await loja();
    const eq = (
      await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'servidor_local', 'Servidor da loja', $3) returning id`, [
        l.t,
        l.un,
        `teste-${randomBytes(12).toString('hex')}`,
      ])
    )[0].id;
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao) values ($1, $2, $3, '1.30.12')`, [eq, l.t, l.un]);
    await expect(produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', true, ator)).rejects.toThrow(/"Servidor da loja" \(versão 1\.30\.12\) precisa estar na 1\.30\.13/);
    expect(((await produtos.gestaoDosComplementos(l.t)) as any).pausaBloqueada).toMatch(/1\.30\.13/);
    expect((await q(`select canais_pausados from opcao where id = $1`, [l.op]))[0].canais_pausados).toEqual([]);
    await q(`update edge_status set versao = '1.30.13' where equipamento_id = $1`, [eq]);
    expect(await produtos.pausaDaOpcaoNoCanal(l.t, l.op, 'regem', true, ator)).toMatchObject({ mudou: true });
  });

  it('o preço no app: só com o direito; grava e audita; zero vale; vazio limpa', async () => {
    const sem = await loja();
    await expect(produtos.precoDaOpcaoNoCanal(sem.t, sem.op, 'ifood', 5, ator)).rejects.toThrow(/iFood pelo Orzuni não está ligado/);
    await expect(produtos.precoDaOpcaoNoCanal(sem.t, sem.op, '99food', 5, ator)).rejects.toThrow(/preço na 99 não está ligado/);
    const l = await loja([MODULO_IFOOD_PELO_ORZUNI, MODULO_PRECOS_NA_99]);
    auditados.length = 0;
    expect(await produtos.precoDaOpcaoNoCanal(l.t, l.op, 'ifood', '5,5', ator)).toEqual({ canal: 'ifood', valor: '5.50', mudou: true });
    expect(auditados[0]).toMatchObject({ acao: 'mudou_preco_do_complemento_no_canal', detalhe: { nome: 'Bacon extra', canal: 'ifood', de: null, para: '5.50' } });
    expect(await produtos.precoDaOpcaoNoCanal(l.t, l.op, 'ifood', 5.5, ator)).toMatchObject({ mudou: false });
    expect(await produtos.precoDaOpcaoNoCanal(l.t, l.op, '99food', 0, ator)).toMatchObject({ valor: '0.00', mudou: true });
    expect((await q(`select preco_ifood::text as ifood, preco_99::text as n99 from opcao where id = $1`, [l.op]))[0]).toEqual({ ifood: '5.50', n99: '0.00' });
    expect(await produtos.precoDaOpcaoNoCanal(l.t, l.op, 'ifood', '', ator)).toMatchObject({ valor: null, mudou: true });
    await expect(produtos.precoDaOpcaoNoCanal(l.t, l.op, 'regem', 5, ator)).rejects.toThrow(/o do Regem é o de cada grupo/);
  });

  it('o preço no grupo: grava, refaz o preço dos produtos do grupo, audita "de 5.00 para 6.50"; igual não grava', async () => {
    const l = await loja();
    auditados.length = 0;
    expect(await produtos.precoDaOpcaoNoGrupo(l.t, l.grupo, l.op, '6,5', ator)).toEqual({ valor: '6.50', mudou: true });
    expect(Number((await q(`select preco from complemento_item where complemento_id = $1 and opcao_id = $2`, [l.grupo, l.op]))[0].preco)).toBe(6.5);
    const delta = await q(
      `select o.preco_delta from complemento_opcao o join complemento_grupo g on g.id = o.grupo_id
        where g.produto_id = $1 and o.origem_opcao_id = $2 and o.deleted_at is null and g.deleted_at is null`,
      [l.p, l.op],
    );
    expect(delta.map((d: any) => Number(d.preco_delta))).toEqual([6.5]);
    expect(auditados).toEqual([
      expect.objectContaining({
        acao: 'mudou_preco_do_complemento_no_grupo',
        entidadeTipo: 'complemento',
        entidadeId: l.grupo,
        detalhe: { grupo: 'Adicionais', nome: 'Bacon extra', opcaoId: l.op, de: '5.00', para: '6.50' },
      }),
    ]);
    const ids = await idsMaterializados(l.p);
    expect(await produtos.precoDaOpcaoNoGrupo(l.t, l.grupo, l.op, 6.5, ator)).toEqual({ valor: '6.50', mudou: false });
    expect(await idsMaterializados(l.p)).toEqual(ids); // igual: não refaz
    expect(auditados).toHaveLength(1);
    await expect(produtos.precoDaOpcaoNoGrupo(l.t, l.grupo, (await loja()).op, 1, ator)).rejects.toThrow(/não encontrado neste grupo/);
    await expect(produtos.precoDaOpcaoNoGrupo(l.t, 'x', l.op, 1, ator)).rejects.toThrow(/Grupo de complementos inválido/);
    await expect(produtos.precoDaOpcaoNoGrupo(l.t, l.grupo, l.op, -1, ator)).rejects.toThrow(/Preço do complemento inválido/);
  });
});
