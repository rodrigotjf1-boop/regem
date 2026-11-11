import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ForbiddenException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';
import { ProdutoController } from './produto.controller';
import { MODULO_IFOOD_PELO_ORZUNI } from '../../common/ifood-pelo-orzuni';
import { exigirCanalDePausa, exigirCanalDePreco, exigirIdDoProduto, precoDeVendaDoPedido, precoIfoodDoCanal } from './produto-canais';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GESTÃO DO CATÁLOGO › PRODUTOS E PREÇOS (R3 F1) — o preço e a pausa de UM canal, com auditoria. As regras do valor sem
// banco; as gravações contra o Postgres (TEST_PG_URL) com o serviço de verdade.
//
// O que se prova:
//   • o preço do Regem (venda) e o do iFood: valor conferido, gravado, auditado (de → para); igual não grava; o do iFood
//     só com o direito ligado e nunca zero;
//   • a pausa: o Regem desliga balcão e cardápio digital juntos; iFood e 99 põem/tiram SÓ o seu canal da lista, sem
//     apagar o de outro (a pausa do totem fica); repetir não duplica; auditado;
//   • produto de outra empresa ou inexistente: 404; id e canal inválidos: 400;
//   • mudar preço pede "Ver valores em R$" (o presidente sempre).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('produto-canais-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

describe('regras do preço e da pausa por canal (sem banco)', () => {
  it('preço de venda: maior que zero, até 2 casas, aceita vírgula; o resto é recusado com o motivo', () => {
    expect(precoDeVendaDoPedido(39.9)).toBe('39.90');
    expect(precoDeVendaDoPedido('27,5')).toBe('27.50');
    for (const v of [0, -1, '', '  ', 'abc', 1.234, 1_000_000, null, undefined, true]) {
      expect(() => precoDeVendaDoPedido(v)).toThrow(/Preço de venda/);
    }
  });
  it('preço no iFood: vazio limpa; zero e ausente são recusados', () => {
    expect(precoIfoodDoCanal('45,5')).toBe('45.50');
    expect(precoIfoodDoCanal(null)).toBeNull();
    expect(precoIfoodDoCanal('')).toBeNull();
    expect(() => precoIfoodDoCanal(0)).toThrow(/preço zero/);
    expect(() => precoIfoodDoCanal(undefined)).toThrow(/Informe o preço/);
    expect(() => precoIfoodDoCanal(-3)).toThrow(/Preço no iFood/);
  });
  it('canal e id: só os conhecidos', () => {
    expect(exigirCanalDePreco('regem')).toBe('regem');
    expect(() => exigirCanalDePreco('99food')).toThrow(/regem.*ifood/);
    expect(exigirCanalDePausa('99food')).toBe('99food');
    expect(() => exigirCanalDePausa('gogem')).toThrow(/Canal inválido/);
    expect(() => exigirIdDoProduto('1 or 1=1')).toThrow(/Produto inválido/);
  });
});

describe('a rota do preço pede "Ver valores em R$"', () => {
  const chamadas: any[] = [];
  const service = { precoDoCanal: async (...a: any[]) => (chamadas.push(a), { ok: true }) } as any;
  const ctrl = new ProdutoController(service);
  const quem = (categoria: string, verFin: boolean) => ({ tenantId: 't', colaboradorId: 'c', categoria, permissoes: { ver_financeiro: verFin } }) as any;
  it('gerente sem a permissão: 403; com ela, passa; o presidente passa sempre', async () => {
    expect(() => ctrl.precoDoCanal(quem('gerente', false), 'id', { canal: 'regem', valor: 10 })).toThrow(ForbiddenException);
    await ctrl.precoDoCanal(quem('gerente', true), 'id', { canal: 'regem', valor: 10 });
    await ctrl.precoDoCanal({ ...quem('presidente', false), permissoes: {} }, 'id', { canal: 'ifood', valor: 12 });
    expect(chamadas.map((c) => c[2])).toEqual(['regem', 'ifood']);
  });
});

descrever('preço e pausa por canal (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditados.push(a) } as any;
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, new FichasService(db)) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const ator = { id: null, perfil: 'gerente' };

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['produto', 'categoria_produto', 'entitlement', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja(ifood: boolean) {
    const t = (await q(`insert into empresa (nome) values ('teste preço e pausa por canal') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja')`, [t]);
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    if (ifood)
      await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || $3)::uuid, $2, $3, true)`, [t, t, MODULO_IFOOD_PELO_ORZUNI]);
    const p = (
      await q(
        `insert into produto (tenant_id, nome, codigo, categoria_id, preco_venda, preco_ifood, no_ifood, canais_pausados)
         values ($1, 'X-Bacon', '2051', $2, 39.90, 50.00, true, '["gogem"]'::jsonb) returning id`,
        [t, cat],
      )
    )[0].id as string;
    return { t, p };
  }
  const gravado = async (id: string) =>
    (
      await q(
        `select preco_venda::text as venda, preco_ifood::text as ifood, disponivel_balcao as balcao, disponivel_cardapio as cardapio,
                canais_pausados as canais from produto where id = $1`,
        [id],
      )
    )[0];

  it('o preço do Regem: grava, audita de → para; igual não grava nem audita', async () => {
    const { t, p } = await loja(false);
    // `preco_venda` é numeric sem escala: gravado como 39.9, o "de" da auditoria sai "39.90" (como o "para").
    await q(`update produto set preco_venda = 39.9 where id = $1`, [p]);
    auditados.length = 0;
    expect(await produtos.precoDoCanal(t, p, 'regem', '42,9', ator)).toEqual({ canal: 'regem', valor: '42.90', mudou: true });
    expect((await gravado(p)).venda).toBe('42.90');
    expect(auditados).toEqual([
      expect.objectContaining({ tenantId: t, acao: 'mudou_preco_do_canal', entidadeId: p, detalhe: { nome: 'X-Bacon', canal: 'regem', de: '39.90', para: '42.90' } }),
    ]);
    expect(await produtos.precoDoCanal(t, p, 'regem', 42.9, ator)).toEqual({ canal: 'regem', valor: '42.90', mudou: false });
    expect(auditados).toHaveLength(1);
    await expect(produtos.precoDoCanal(t, p, 'regem', 0, ator)).rejects.toThrow(/Preço de venda/);
  });

  it('o preço do iFood: só com o direito; grava e audita; vazio limpa; zero é recusado', async () => {
    const sem = await loja(false);
    await expect(produtos.precoDoCanal(sem.t, sem.p, 'ifood', 45, ator)).rejects.toThrow(/não está ligado/);
    expect((await gravado(sem.p)).ifood).toBe('50.00');
    const { t, p } = await loja(true);
    auditados.length = 0;
    expect(await produtos.precoDoCanal(t, p, 'ifood', '45', ator)).toMatchObject({ valor: '45.00', mudou: true });
    expect(auditados[0].detalhe).toEqual({ nome: 'X-Bacon', canal: 'ifood', de: '50.00', para: '45.00' });
    expect(await produtos.precoDoCanal(t, p, 'ifood', '', ator)).toMatchObject({ valor: null, mudou: true });
    expect((await gravado(p)).ifood).toBeNull();
    await expect(produtos.precoDoCanal(t, p, 'ifood', 0, ator)).rejects.toThrow(/preço zero/);
  });

  it('a pausa do Regem: balcão e cardápio digital juntos; já pausado não grava nem audita', async () => {
    const { t, p } = await loja(false);
    auditados.length = 0;
    expect(await produtos.pausaDoCanal(t, p, 'regem', true, ator)).toMatchObject({ pausado: true, mudou: true, disponivelBalcao: false, disponivelCardapio: false });
    expect(await gravado(p)).toMatchObject({ balcao: false, cardapio: false, canais: ['gogem'] });
    expect(await produtos.pausaDoCanal(t, p, 'regem', true, ator)).toMatchObject({ mudou: false });
    expect(auditados.map((a) => [a.acao, a.detalhe.canal])).toEqual([['pausou_produto_no_canal', 'regem']]);
    await produtos.pausaDoCanal(t, p, 'regem', false, ator);
    expect(await gravado(p)).toMatchObject({ balcao: true, cardapio: true });
    // Pausar no Regem não mexe na lista dos canais de fora (o iFood não pausa por isso — mig 399).
    expect((await gravado(p)).canais).toEqual(['gogem']);
  });

  it('a pausa do iFood e da 99: põe e tira SÓ o seu canal; a pausa do totem fica; repetir não duplica', async () => {
    const { t, p } = await loja(true);
    auditados.length = 0;
    await produtos.pausaDoCanal(t, p, 'ifood', true, ator);
    await produtos.pausaDoCanal(t, p, 'ifood', true, ator); // de novo: nada muda
    await produtos.pausaDoCanal(t, p, '99food', true, ator);
    expect((await gravado(p)).canais).toEqual(['gogem', 'ifood', '99food']);
    // Enquanto isso, o totem mexe na lista dele (lê-mexe-regrava): a pausa do iFood não pode sumir na próxima gravação.
    await q(`update produto set canais_pausados = canais_pausados - 'gogem' where id = $1`, [p]);
    await produtos.pausaDoCanal(t, p, '99food', false, ator);
    expect((await gravado(p)).canais).toEqual(['ifood']);
    expect(await produtos.pausaDoCanal(t, p, 'ifood', false, ator)).toMatchObject({ mudou: true, canaisPausados: [] });
    expect(auditados.map((a) => [a.acao, a.detalhe.canal])).toEqual([
      ['pausou_produto_no_canal', 'ifood'],
      ['pausou_produto_no_canal', '99food'],
      ['reativou_produto_no_canal', '99food'],
      ['reativou_produto_no_canal', 'ifood'],
    ]);
    await expect(produtos.pausaDoCanal(t, p, 'ifood', 'sim', ator)).rejects.toThrow(/pausado/);
  });

  it('produto de outra empresa ou inexistente: 404; e nada muda no de lá', async () => {
    const a = await loja(true);
    const b = await loja(true);
    await expect(produtos.precoDoCanal(b.t, a.p, 'regem', 10, ator)).rejects.toThrow(/não encontrado/);
    await expect(produtos.pausaDoCanal(b.t, a.p, 'ifood', true, ator)).rejects.toThrow(/não encontrado/);
    await expect(produtos.pausaDoCanal(a.t, '00000000-0000-4000-8000-000000000000', 'regem', true, ator)).rejects.toThrow(/não encontrado/);
    expect(await gravado(a.p)).toMatchObject({ venda: '39.90', canais: ['gogem'], balcao: true });
  });
});
