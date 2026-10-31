import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { assinarConversa } from '../../common/conversa-do-robo';
import { FichasService } from '../fichas/fichas.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';
import { RoboPedidoService } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO PELO WHATSAPP DE PONTA A PONTA contra o Postgres real (Fase 5, F3/F4 — mig 344): a conversa monta o pedido no
// carrinho do Regem (item pelo nome, adicional, etapa obrigatória, bairro da lista, fora da área, referência, mínimo,
// pagamento do cardápio, troco), registra pelo MESMO caminho do cardápio online (`receberPedido`) e manda o resumo por
// escrito. A 344 é só da nuvem: o banco do CI é o de uma loja, então o teste aplica o arquivo (duas vezes: idempotente).
// A entrada do pedido (`DeliveryService.ingest`) é trocada por uma gravação simples — ela é a de sempre, não muda aqui.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-pedido-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATION = join(__dirname, '../../../../database/migrations/344_robo_carrinho.sql');
const SENHA = 'senha-do-robo-de-teste';
const CELULAR = '5521987654321';

descrever('pedido pelo WhatsApp (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fichas = new FichasService(db);
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  // A entrada do pedido de sempre, reduzida ao que o teste lê: grava a linha e o aceite muda a situação.
  const delivery = {
    ingest: async (tenantId: string, unidadeId: string | null, canal: string, n: any, x: any) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, endereco,
             endereco_rua, endereco_numero, endereco_referencia, endereco_bairro, itens, total, forma_pagamento, taxa_entrega, desconto,
             troco_para, valor_bruto, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,'novo') returning *`,
          [tenantId, unidadeId, canal, x.clientRef, n.displayId, n.cliente, n.clienteTelefone, n.tipo, n.endereco ?? null, x.enderecoRua ?? null,
            x.enderecoNumero ?? null, x.enderecoReferencia ?? null, x.enderecoBairro ?? null, JSON.stringify(n.itens), n.total, n.formaPagamento,
            x.taxaEntrega ?? 0, x.desconto ?? 0, x.trocoPara ?? null, n.valorBruto ?? null],
        )
      ).map((r: any) => ({ ...r, id: r.id, displayId: r.display_id, status: r.status, unidadeId: r.unidade_id }))[0],
    aceitar: async (_t: string, _u: any, id: string) => q(`update pedido_externo set status = 'confirmado' where id = $1`, [id]),
  } as any;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, {} as any, {} as any, eventos, {} as any);
  const enviados: { para: string; texto: string }[] = [];
  const whats = { enviar: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }) } as any;
  const robo = new RoboPedidoService(db, cardapio, whats, whats);
  const empresas: string[] = [];
  const antes = { segredo: process.env.BOT_RESOLVER_SECRET, edge: process.env.EDGE_MODE, cliente: process.env.CLIENTE_TOKEN_SECRET };

  async function aplicarMigration() {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(readFileSync(MIGRATION, 'utf8'));
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  beforeAll(async () => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    // O pedido do cardápio assina o token do cliente no fim (o CI não tem JWT_SECRET).
    if (!process.env.JWT_SECRET && !antes.cliente) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    delete process.env.EDGE_MODE; // como NUVEM
    await aplicarMigration();
    await aplicarMigration(); // idempotente
    // A nuvem pergunta se a loja tem servidor ligado (tabelas só da nuvem): sem linha, não tem.
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (antes.segredo === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes.segredo;
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (antes.cliente === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = antes.cliente;
    if (empresas.length) {
      for (const t of ['robo_carrinho', 'cliente_endereco', 'pedido_externo', 'cliente', 'cardapio_senha_seq', 'cardapio_bairro', 'cardapio_config',
        'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto_variacao', 'produto',
        'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  // ── a loja de teste: X-Bacon (R$ 25,90; adicional Bacon extra +R$ 4), Trio X-Bacon (R$ 34,90; refri obrigatório),
  //    Coca lata (R$ 6). Entrega por bairro (Centro R$ 5), retirada, mínimo R$ 20, Pix online e "pagar na entrega".
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pedido pelo whatsapp') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    const token = `tk-${randomUUID()}`;
    const instancia = `inst-${randomUUID().slice(0, 8)}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada, area_modo, pedido_minimo, pagamentos,
         evolution_instancia, tempo_entrega_min)
       values ($1,$2,$3,true,true,'retirada',true,true,'bairro',20,'["pix","entrega"]'::jsonb,$4,40)`,
      [t, u, token, instancia],
    );
    await q(`insert into cardapio_bairro (tenant_id, unidade_id, nome, taxa) values ($1,$2,'Centro',5)`, [t, u]);
    const produto = async (nome: string, preco: number) =>
      (await q(
        `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, disponivel_cardapio)
         values ($1,$2,$3,$4,false,false,true) returning id`,
        [t, nome, cat, preco],
      ))[0].id as string;
    const xbacon = await produto('X-Bacon', 25.9);
    const trio = await produto('Trio X-Bacon', 34.9);
    await produto('Coca lata', 6);
    const opcao = async (nome: string, codigoPdv: string | null = null) => ((await produtos.criarOpcaoCatalogo(t, { nome, codigoPdv })) as any).id as string;
    const adic: any = await produtos.criarComplemento(t, {
      nome: 'Adicionais', regra: 'varias_com_repeticao', max: 3, itens: [{ opcaoId: await opcao('Bacon extra', 'A1'), preco: 4 }],
    });
    await produtos.setProdutoComplementos(t, xbacon, [adic.id]);
    const refri: any = await produtos.criarComplemento(t, {
      nome: 'Escolha o refri', regra: 'uma', obrigatorio: true,
      itens: [{ opcaoId: await opcao('Coca-Cola', 'R1'), preco: 0 }, { opcaoId: await opcao('Guaraná', 'R2'), preco: 0 }],
    });
    await produtos.setProdutoComplementos(t, trio, [refri.id]);
    const conversa = (tel = CELULAR) => assinarConversa(t, tel)!;
    const ctx = (tel = CELULAR) => robo.contexto(SENHA, conversa(tel), instancia);
    return { t, u, token, instancia, ctx, conversa };
  }

  it('de ponta a ponta: monta, confere cada passo, registra pelo caminho do cardápio e manda o resumo', async () => {
    const l = await loja();
    const c = await l.ctx();
    const visto: any = await robo.ver(c);
    expect(visto.cliente).toMatchObject({ conhecido: false, nome: null });
    expect(visto.enderecosSalvos).toEqual([]);
    expect(visto.pedido.falta[0].campo).toBe('itens');

    // Itens pelo nome; adicional com o preço do cardápio; o trio pede o refri.
    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'xbacon', adicionais: ['bacon'] });
    expect(r.ok).toBe(true);
    expect(r.pedido.itens[0]).toMatchObject({ linha: 1, quantidade: 1, item: 'X-Bacon (Bacon extra)', total: 'R$ 29,90' });
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'trio x-bacon' });
    expect(r.pedido.itens[1].faltaEscolher[0]).toMatch(/^Escolha o refri \(Coca-Cola, Guaraná\)/);
    expect(r.pedido.podeRegistrar).toBe(false);
    r = await robo.mexerNosItens(c, { acao: 'alterar', linha: 2, adicionais: ['guaraná'] });
    expect(r.pedido.itens[1]).toMatchObject({ item: 'Trio X-Bacon (Guaraná)', total: 'R$ 34,90', faltaEscolher: [] });
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'pizza' });
    expect(r).toMatchObject({ ok: false, motivo: 'produto_nao_encontrado' });
    expect(r.pedido.itens).toHaveLength(2);

    // Bairro fora da lista: "não cobre a região" (e a retirada como saída); depois o Centro, com a taxa e a referência.
    r = await robo.definirEntrega(c, { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'Barra da Tijuca' });
    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_area', mensagem: 'Infelizmente nosso delivery não cobre a região.', alternativa: 'O cliente pode retirar na loja.' });
    r = await robo.definirEntrega(c, { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'centro' });
    expect(r.pedido.entrega).toMatchObject({ tipo: 'entrega', endereco: 'Rua A, 10 · Centro', taxa: 'R$ 5,00', foraDaArea: false });
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['referencia', 'nome', 'pagamento']);
    r = await robo.definirEntrega(c, { referencia: 'portão azul' });
    expect(r.pedido.entrega.endereco).toBe('Rua A, 10 · Centro · ref: portão azul');
    expect(r.pedido.total).toBe('R$ 69,80');

    // Pagamento: Pix online só pelo link; dinheiro pede o troco; troco menor que o total não vale.
    r = await robo.definirPagamento(c, { forma: 'pix' });
    expect(r).toMatchObject({ ok: false, motivo: 'so_pelo_link' });
    r = await robo.definirPagamento(c, { forma: 'dinheiro' });
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['nome', 'troco']);
    r = await robo.definirPagamento(c, { forma: 'dinheiro', troco: '50' });
    expect(r.pedido.avisos).toContain('O troco para R$ 50,00 não cobre o total de R$ 69,80: pergunte de novo.');
    expect(r.pedido.falta.map((f: any) => f.campo)).toContain('troco');
    r = await robo.definirPagamento(c, { forma: 'dinheiro', troco: 'R$ 100,00' });
    r = await robo.definirNome(c, { nome: 'Ana Maria' });
    expect(r.pedido).toMatchObject({ podeRegistrar: true, falta: [], nome: 'Ana Maria', pagamento: { troco: 'troco para R$ 100,00' } });

    // Registrar: só a versão do resumo; o pedido entra pelo caminho do cardápio, com o total do resumo.
    const versao = r.pedido.versao;
    expect((await robo.registrar(c, { versao: versao - 1 })) as any).toMatchObject({ ok: false, motivo: 'versao' });
    const reg: any = await robo.registrar(c, { versao });
    expect(reg).toMatchObject({ ok: true, aceito: true, resumoEnviado: true, resumo: null });
    const [ped] = await q(`select * from pedido_externo where tenant_id = $1`, [l.t]);
    expect(Number(ped.total)).toBeCloseTo(69.8, 2);
    expect(ped).toMatchObject({ tipo: 'entrega', canal: 'cardapio', forma_pagamento: 'entrega', endereco_rua: 'Rua A', endereco_bairro: 'Centro', endereco_referencia: 'portão azul', status: 'confirmado' });
    expect(Number(ped.troco_para)).toBe(100);
    expect(ped.client_ref).toMatch(/^robo-whatsapp-/);
    expect(reg.numero).toBe(ped.display_id);
    // O resumo saiu por escrito, para o telefone da conversa, com o número, os itens, o total, o pagamento e o troco.
    expect(enviados).toHaveLength(1);
    expect(enviados[0].para).toBe(CELULAR);
    for (const pedaco of [`*Pedido nº ${ped.display_id} registrado!*`, '*1x X-Bacon* — R$ 29,90', '   + Bacon extra', '   + Guaraná', '💰 *Total: R$ 69,80*', 'Ref.: portão azul', '*troco de R$ 30,20*', 'aceito e já está em produção'])
      expect(enviados[0].texto).toContain(pedaco);
    // O cliente ficou no cadastro com o número com o nono dígito, e o endereço novo foi guardado.
    const clientes = await q(`select id, nome, telefone from cliente where tenant_id = $1`, [l.t]);
    expect(clientes).toEqual([expect.objectContaining({ nome: 'Ana Maria', telefone: '21987654321' })]);
    expect(await q(`select logradouro, numero, bairro, referencia from cliente_endereco where tenant_id = $1`, [l.t])).toEqual([
      { logradouro: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'portão azul' },
    ]);
    expect((await q(`select status from robo_carrinho where tenant_id = $1`, [l.t])).map((x: any) => x.status)).toEqual(['registrado']);

    // Registrar de novo não cria outro pedido; a próxima conversa já acha o cliente e o endereço salvo.
    expect((await robo.registrar(c, { versao })) as any).toMatchObject({ ok: false, motivo: 'sem_pedido' });
    expect(await q(`select count(*)::int as n from pedido_externo where tenant_id = $1`, [l.t])).toEqual([{ n: 1 }]);
    const depois: any = await robo.ver(c);
    expect(depois.cliente).toEqual({ conhecido: true, nome: 'Ana Maria' });
    expect(depois.enderecosSalvos).toEqual([{ n: 1, endereco: 'Rua A, 10 · Centro · ref: portão azul' }]);
    // O WhatsApp sem o nono dígito é o MESMO cliente (ERR-134).
    const sem9: any = await robo.ver(await l.ctx('552187654321'));
    expect(sem9.cliente).toEqual({ conhecido: true, nome: 'Ana Maria' });
  });

  it('endereço salvo pelo número da lista; pedido mínimo; retirada sem endereço', async () => {
    const l = await loja();
    const c = await l.ctx();
    const [cli] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bruno','21987654321') returning id`, [l.t]);
    const bairro = (await q(`select id from cardapio_bairro where tenant_id = $1`, [l.t]))[0].id;
    await q(
      `insert into cliente_endereco (tenant_id, cliente_id, logradouro, numero, bairro, bairro_id, complemento, principal) values ($1,$2,'Rua B','20','Centro',$3,'apto 101',true)`,
      [l.t, cli.id, bairro],
    );
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata' });
    let r: any = await robo.definirEntrega(c, { tipo: 'entrega', endereco: 1 });
    expect(r.pedido.entrega).toMatchObject({ endereco: 'Rua B, 20 · Centro · ref: apto 101', taxa: 'R$ 5,00' });
    expect(r.pedido.nome).toBe('Bruno'); // do cadastro
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['minimo', 'pagamento']);
    expect(r.pedido.falta[0].pergunta).toBe('O pedido mínimo para entrega é R$ 20,00 em itens (faltam R$ 14,00).');
    r = await robo.definirEntrega(c, { tipo: 'retirada' });
    r = await robo.definirPagamento(c, { forma: 'cartão' });
    expect(r.pedido).toMatchObject({ entrega: { tipo: 'retirada' }, falta: [], podeRegistrar: true, pagamento: { troco: 'sem troco' } });
    expect((await robo.definirEntrega(c, { tipo: 'entrega', endereco: 7 })) as any).toMatchObject({ ok: false, motivo: 'endereco' });
  });

  it('duas mensagens ao mesmo tempo: um carrinho só, com os dois itens', async () => {
    const l = await loja();
    const c = await l.ctx();
    await Promise.all([
      robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata' }),
      robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon' }),
    ]);
    const carrinhos = await q(`select itens, versao from robo_carrinho where tenant_id = $1 and status = 'aberto'`, [l.t]);
    expect(carrinhos).toHaveLength(1);
    expect(carrinhos[0].itens.map((i: any) => i.linha).sort()).toEqual([1, 2]);
    expect(carrinhos[0].versao).toBe(2);
    // O mesmo item de novo soma na linha (como o carrinho do cardápio).
    const r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata', quantidade: 2 });
    expect(r.pedido.itens.find((i: any) => i.item === 'Coca lata')).toMatchObject({ quantidade: 3, total: 'R$ 18,00' });
  });

  it('carrinho parado há mais de 12 h vence; ficha de outra loja ou mexida não entra', async () => {
    const l = await loja();
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata' });
    await q(`update robo_carrinho set atualizado_em = now() - interval '13 hours' where tenant_id = $1`, [l.t]);
    const r: any = await robo.ver(c);
    expect(r.pedido.itens).toEqual([]);
    expect((await q(`select status from robo_carrinho where tenant_id = $1`, [l.t])).map((x: any) => x.status)).toEqual(['cancelado']);

    const outra = await loja();
    await expect(robo.contexto(SENHA, outra.conversa(), l.instancia)).rejects.toThrow('Conversa não reconhecida');
    await expect(robo.contexto(SENHA, `${l.conversa()}x`, l.instancia)).rejects.toThrow('Conversa não reconhecida');
    await expect(robo.contexto('senha-errada', l.conversa(), l.instancia)).rejects.toThrow('Não autorizado');
  });

  it('o cliente desiste: o pedido em montagem é cancelado e nada vai para a loja', async () => {
    const l = await loja();
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon' });
    expect(await robo.cancelar(c)).toEqual({ ok: true, feito: 'pedido em montagem cancelado' });
    expect((await robo.ver(c)).pedido.itens).toEqual([]);
    expect(await q(`select count(*)::int as n from pedido_externo where tenant_id = $1`, [l.t])).toEqual([{ n: 0 }]);
  });
});
