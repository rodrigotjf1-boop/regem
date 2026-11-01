import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { assinarConversa } from '../../common/conversa-do-robo';
import { CashbackService } from '../cashback/cashback.service';
import { FichasService } from '../fichas/fichas.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';
import { RoboPedidoService } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO PELO WHATSAPP DE PONTA A PONTA contra o Postgres real (Fase 5, F3/F4 — mig 344; F5 — mig 345): a conversa
// monta o pedido no carrinho do Regem conduzida pelo `proximo` (escolha obrigatória → adicionais e observação do item →
// "mais alguma coisa?" → entrega → referência → nome → pagamento → troco), o Regem manda o RESUMO PARA CONFERIR com os
// botões, e o "Pode registrar" registra pelo MESMO caminho do cardápio online (`receberPedido`) — sem a IA carregar a
// versão. As 344/345 são só da nuvem: o banco do CI é o de uma loja, então o teste aplica os arquivos (duas vezes:
// idempotentes). A entrada do pedido (`DeliveryService.ingest`) é trocada por uma gravação simples.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-pedido-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATIONS = ['344_robo_carrinho.sql', '345_robo_carrinho_conducao.sql'].map((m) => join(__dirname, '../../../../database/migrations', m));
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
             troco_para, valor_bruto, observacao, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19,$20,$21,'novo') returning *`,
          [tenantId, unidadeId, canal, x.clientRef, n.displayId, n.cliente, n.clienteTelefone, n.tipo, n.endereco ?? null, x.enderecoRua ?? null,
            x.enderecoNumero ?? null, x.enderecoReferencia ?? null, x.enderecoBairro ?? null, JSON.stringify(n.itens), n.total, n.formaPagamento,
            x.taxaEntrega ?? 0, x.desconto ?? 0, x.trocoPara ?? null, n.valorBruto ?? null, x.observacao ?? null],
        )
      ).map((r: any) => ({ ...r, id: r.id, displayId: r.display_id, status: r.status, unidadeId: r.unidade_id }))[0],
    aceitar: async (_t: string, _u: any, id: string) => q(`update pedido_externo set status = 'confirmado' where id = $1`, [id]),
  } as any;
  // A fidelidade e o cashback de verdade: o robô pergunta, desconta e registra pelas contas deles (Bloco 1b).
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any);
  // Os envios: a Evolution (o QR — opções em menu numerado) e a API oficial (texto e botões).
  const enviados: { para: string; texto: string; opcoes?: string[] }[] = [];
  const whats = { enviar: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }) } as any;
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }),
    enviarOpcoes: async (_t: string, para: string, texto: string, ops: any[]) => void enviados.push({ para, texto, opcoes: ops.map((o) => o.titulo) }),
  } as any;
  const robo = new RoboPedidoService(db, cardapio, whats, oficial);
  const empresas: string[] = [];
  const antes = { segredo: process.env.BOT_RESOLVER_SECRET, edge: process.env.EDGE_MODE, cliente: process.env.CLIENTE_TOKEN_SECRET };

  async function aplicarMigrations() {
    const c = await pool.connect();
    try {
      for (const m of MIGRATIONS) {
        await c.query('begin');
        await c.query(readFileSync(m, 'utf8'));
        await c.query('commit');
      }
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
    await aplicarMigrations();
    await aplicarMigrations(); // idempotentes
    // A nuvem pergunta se a loja tem servidor ligado (tabelas só da nuvem): sem linha, não tem.
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  beforeEach(() => {
    enviados.length = 0;
  });
  afterAll(async () => {
    if (antes.segredo === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes.segredo;
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (antes.cliente === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = antes.cliente;
    if (empresas.length) {
      for (const t of ['robo_carrinho', 'cupom_uso', 'cupom', 'cashback_vale', 'cashback_movimento', 'cashback_saldo', 'cashback_plano',
        'fidelidade_resgate', 'fidelidade_cliente', 'fidelidade_plano', 'cliente_endereco', 'pedido_externo', 'cliente', 'cardapio_senha_seq', 'cardapio_bairro', 'cardapio_config',
        'complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento', 'opcao', 'produto_variacao', 'produto',
        'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  // ── a loja de teste: X-Bacon (R$ 25,90; adicional Bacon extra +R$ 4), Trio X-Bacon (R$ 34,90; refri obrigatório),
  //    Coca lata (R$ 6, em Bebidas). Entrega por bairro (Centro R$ 5), retirada, mínimo R$ 20, Pix online e "pagar na
  //    entrega". `provedor` = a via do WhatsApp da loja (Evolution: menu numerado; oficial: botões).
  async function loja(provedor: 'evolution' | 'cloud' = 'evolution') {
    const t = (await q(`insert into empresa (nome) values ('teste pedido pelo whatsapp') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    const bebidas = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Bebidas') returning id`, [t]))[0].id as string;
    const token = `tk-${randomUUID()}`;
    const instancia = `inst-${randomUUID().slice(0, 8)}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada, area_modo, pedido_minimo, pagamentos,
         evolution_instancia, tempo_entrega_min, provedor)
       values ($1,$2,$3,true,true,'retirada',true,true,'bairro',20,'["pix","entrega"]'::jsonb,$4,40,$5)`,
      [t, u, token, instancia, provedor],
    );
    await q(`insert into cardapio_bairro (tenant_id, unidade_id, nome, taxa) values ($1,$2,'Centro',5)`, [t, u]);
    const produto = async (nome: string, preco: number, categoria = cat) =>
      (await q(
        `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, disponivel_cardapio)
         values ($1,$2,$3,$4,false,false,true) returning id`,
        [t, nome, categoria, preco],
      ))[0].id as string;
    const xbacon = await produto('X-Bacon', 25.9);
    const trio = await produto('Trio X-Bacon', 34.9);
    await produto('Coca lata', 6, bebidas);
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

  const campo = (r: any) => r?.pedido?.proximo?.campo;

  it('de ponta a ponta: o Regem conduz, manda o resumo para conferir e o "Pode registrar" registra sem a IA carregar a versão', async () => {
    const l = await loja();
    const c = await l.ctx();
    const visto: any = await robo.ver(c);
    expect(visto.cliente).toMatchObject({ conhecido: false, nome: null });
    expect(visto.enderecosSalvos).toEqual([]);
    expect(visto.pedido.proximo.campo).toBe('itens');

    // X-Bacon já com o adicional: os extras dele não se perguntam de novo.
    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'xbacon', adicionais: ['bacon'] });
    expect(r.ok).toBe(true);
    expect(r.pedido.itens[0]).toMatchObject({ linha: 1, quantidade: 1, item: 'X-Bacon (Bacon extra)', total: 'R$ 29,90' });
    expect(campo(r)).toBe('mais_algo');
    // O trio pede o refri — com TODAS as opções e como responder.
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'trio x-bacon' });
    expect(r.pedido.proximo).toMatchObject({ campo: 'linha 2', linha: 2, opcoes: ['Coca-Cola', 'Guaraná'] });
    expect(r.pedido.podeRegistrar).toBe(false);
    // O erro do teste do dono: a escolha chega como um novo "adicionar" do trio → COMPLETA o trio, não cria outro.
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'Trio X-Bacon', adicionais: 'Guaraná' });
    expect(r.pedido.itens).toHaveLength(2);
    expect(r.pedido.itens[1]).toMatchObject({ linha: 2, item: 'Trio X-Bacon (Guaraná)', total: 'R$ 34,90', faltaEscolher: [] });
    // Agora os extras do trio (é lanche): adicional (não tem) ou observação; "Não, obrigado" conclui.
    expect(r.pedido.proximo).toMatchObject({ campo: 'extras 2', opcoes: ['Pôr observação', 'Não, obrigado'] });
    r = await robo.mexerNosItens(c, { acao: 'concluir' });
    // "Mais alguma coisa?" com a bebida? O trio já tem refri → sem sugestão de bebida (nem sobremesa/porção na loja).
    expect(r.pedido.proximo).toMatchObject({ campo: 'mais_algo', opcoes: ['Não, só isso'] });
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'pizza' });
    expect(r).toMatchObject({ ok: false, motivo: 'produto_nao_encontrado' });
    r = await robo.mexerNosItens(c, { acao: 'fechar' });
    // Cliente novo, sem endereço salvo: entrega ou retirada.
    expect(r.pedido.proximo).toMatchObject({ campo: 'tipo', opcoes: ['Entrega', 'Retirar na loja'] });

    // Bairro fora da lista: "não cobre a região" (e a retirada como saída); depois o Centro, com a taxa e o complemento.
    r = await robo.definirEntrega(c, { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'Barra da Tijuca' });
    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_area', mensagem: 'Infelizmente nosso delivery não cobre a região.', alternativa: 'O cliente pode retirar na loja.' });
    r = await robo.definirEntrega(c, { tipo: 'entrega', rua: 'Rua A', numero: '10', bairro: 'centro' });
    expect(r.pedido.entrega).toMatchObject({ tipo: 'entrega', endereco: 'Rua A, 10 · Centro', taxa: 'R$ 5,00', foraDaArea: false });
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['referencia', 'nome', 'pagamento']);
    r = await robo.definirEntrega(c, { referencia: 'casa 2, portão azul' });
    expect(r.pedido.entrega.endereco).toBe('Rua A, 10 · Centro · ref: casa 2, portão azul');
    expect(r.pedido.total).toBe('R$ 69,80');

    // Pagamento: Pix online só pelo link; "Dinheiro" com "sem troco" que a IA marcou SOZINHA não vale (o teste do dono);
    // só o troco chega depois, sem repetir a forma; troco menor que o total não vale.
    r = await robo.definirPagamento(c, { forma: 'pix' });
    expect(r).toMatchObject({ ok: false, motivo: 'so_pelo_link' });
    r = await robo.definirPagamento(c, { forma: 'Dinheiro', semTroco: true });
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['nome', 'troco']);
    r = await robo.definirPagamento(c, { troco: '50' });
    expect(r.pedido.avisos).toContain('O troco para R$ 50,00 não cobre o total de R$ 69,80: pergunte de novo.');
    expect(r.pedido.falta.map((f: any) => f.campo)).toContain('troco');
    r = await robo.definirNome(c, { nome: 'Ana Maria' });
    expect(r.pedido.proximo).toMatchObject({ campo: 'troco', opcoes: ['R$ 100', 'R$ 150', 'Não preciso de troco'] });
    expect(enviados).toHaveLength(0);
    r = await robo.definirPagamento(c, { troco: 'R$ 100,00' });

    // Completo: o Regem MANDA o resumo para conferir (aqui pela Evolution: menu numerado) e marca a versão vista.
    expect(r.pedido).toMatchObject({ podeRegistrar: true, falta: [], nome: 'Ana Maria', resumoEnviado: true, pagamento: { forma: 'Dinheiro (pago na entrega)', troco: 'troco para R$ 100,00' } });
    expect(r.pedido.proximo.campo).toBe('confirmar');
    expect(r.pedido.proximo.pergunta).toContain('JÁ FOI ENVIADO');
    expect(enviados).toHaveLength(1);
    for (const pedaco of ['🧾 *Confere o seu pedido:*', '*1x X-Bacon* — R$ 29,90', '   + Guaraná', 'Ref.: casa 2, portão azul', '*troco de R$ 30,20*', '1) Pode registrar', '2) Pôr observação', '3) Quero mudar algo'])
      expect(enviados[0].texto).toContain(pedaco);
    const [car] = await q(`select versao, resumo_versao, itens_fechados from robo_carrinho where tenant_id = $1 and status = 'aberto'`, [l.t]);
    expect(car.resumo_versao).toBe(car.versao);
    expect(car.itens_fechados).toBe(true);

    // A IA repete a mesma chamada: nada muda, a versão fica e o resumo não sai de novo.
    r = await robo.definirPagamento(c, { forma: 'Dinheiro', troco: '100' });
    expect(r.pedido.versao).toBe(car.versao);
    expect(enviados).toHaveLength(1);

    // "Pôr observação": a observação do pedido muda a versão e o Regem manda o resumo de novo, com ela.
    r = await robo.mexerNosItens(c, { acao: 'observacao_do_pedido', observacao: 'interfone ruim, ligar ao chegar' });
    expect(r.pedido.observacao).toBe('interfone ruim, ligar ao chegar');
    expect(enviados).toHaveLength(2);
    expect(enviados[1].texto).toContain('📝 *Observação do pedido*\ninterfone ruim, ligar ao chegar');

    // "Pode registrar": a versão que a IA manda não conta mais (no teste ela chutava "7") — vale a do resumo enviado.
    const reg: any = await robo.registrar(c, { versao: 7 });
    expect(reg).toMatchObject({ ok: true, aceito: true, resumoEnviado: true, resumo: null });
    const [ped] = await q(`select * from pedido_externo where tenant_id = $1`, [l.t]);
    expect(Number(ped.total)).toBeCloseTo(69.8, 2);
    expect(ped).toMatchObject({ tipo: 'entrega', canal: 'cardapio', forma_pagamento: 'entrega', endereco_rua: 'Rua A', endereco_bairro: 'Centro', endereco_referencia: 'casa 2, portão azul', status: 'confirmado' });
    expect(Number(ped.troco_para)).toBe(100);
    expect(ped.observacao).toBe('interfone ruim, ligar ao chegar'); // mig 346: vai para o pedido (painel, via, entregador)
    expect(ped.client_ref).toMatch(/^robo-whatsapp-/);
    expect(reg.numero).toBe(ped.display_id);
    // O resumo final por escrito, com o número, os itens, o total, o pagamento, o troco e a observação do pedido.
    expect(enviados).toHaveLength(3);
    expect(enviados[2].para).toBe(CELULAR);
    for (const pedaco of [`*Pedido nº ${ped.display_id} registrado!*`, '*1x X-Bacon* — R$ 29,90', '   + Bacon extra', '   + Guaraná', '💰 *Total: R$ 69,80*', 'Dinheiro (pago na entrega)', '*troco de R$ 30,20*', '📝 *Observação do pedido*', 'aceito e já está em produção'])
      expect(enviados[2].texto).toContain(pedaco);
    // O cliente ficou no cadastro com o número com o nono dígito, e o endereço novo foi guardado.
    const clientes = await q(`select id, nome, telefone from cliente where tenant_id = $1`, [l.t]);
    expect(clientes).toEqual([expect.objectContaining({ nome: 'Ana Maria', telefone: '21987654321' })]);
    expect(await q(`select logradouro, numero, bairro, referencia from cliente_endereco where tenant_id = $1`, [l.t])).toEqual([
      { logradouro: 'Rua A', numero: '10', bairro: 'Centro', referencia: 'casa 2, portão azul' },
    ]);
    expect((await q(`select status from robo_carrinho where tenant_id = $1`, [l.t])).map((x: any) => x.status)).toEqual(['registrado']);

    // Registrar de novo não cria outro pedido; a próxima conversa já acha o cliente e o endereço salvo.
    expect((await robo.registrar(c, {})) as any).toMatchObject({ ok: false, motivo: 'sem_pedido' });
    expect(await q(`select count(*)::int as n from pedido_externo where tenant_id = $1`, [l.t])).toEqual([{ n: 1 }]);
    const depois: any = await robo.ver(c);
    expect(depois.cliente).toEqual({ conhecido: true, nome: 'Ana Maria' });
    expect(depois.enderecosSalvos).toEqual([{ n: 1, endereco: 'Rua A, 10 · Centro · ref: casa 2, portão azul' }]);
    expect(depois.ultimoEndereco).toBe(1);
    // O WhatsApp sem o nono dígito é o MESMO cliente (ERR-134).
    const sem9: any = await robo.ver(await l.ctx('552187654321'));
    expect(sem9.cliente).toEqual({ conhecido: true, nome: 'Ana Maria' });
  });

  it('registrar sem o cliente ter recebido o resumo desta versão: o Regem manda agora e espera a confirmação', async () => {
    const l = await loja();
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata', quantidade: 4 });
    await robo.mexerNosItens(c, { acao: 'fechar' });
    await robo.definirEntrega(c, { tipo: 'retirada' });
    await robo.definirNome(c, { nome: 'Caio' });
    await robo.definirPagamento(c, { forma: 'Cartão na retirada' });
    expect(enviados).toHaveLength(1); // o resumo saiu quando ficou completo
    await q(`update robo_carrinho set resumo_versao = null where tenant_id = $1 and status = 'aberto'`, [l.t]); // como se não tivesse saído
    const r: any = await robo.registrar(c, {});
    expect(r).toMatchObject({ ok: false, motivo: 'conferir' });
    expect(enviados).toHaveLength(2);
    expect(await q(`select count(*)::int as n from pedido_externo where tenant_id = $1`, [l.t])).toEqual([{ n: 0 }]);
    expect((await robo.registrar(c, {})) as any).toMatchObject({ ok: true });
  });

  it('o último endereço usado vem primeiro, com os outros e o "Cadastrar novo"; pedido mínimo; retirada com cartão', async () => {
    const l = await loja();
    const c = await l.ctx();
    const [cli] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Bruno','21987654321') returning id`, [l.t]);
    const bairro = (await q(`select id from cardapio_bairro where tenant_id = $1`, [l.t]))[0].id;
    await q(
      `insert into cliente_endereco (tenant_id, cliente_id, logradouro, numero, bairro, bairro_id, complemento, principal) values ($1,$2,'Rua B','20','Centro',$3,'apto 101',true)`,
      [l.t, cli.id, bairro],
    );
    await q(
      `insert into cliente_endereco (tenant_id, cliente_id, logradouro, numero, bairro, bairro_id, referencia, principal) values ($1,$2,'Rua C','30','Centro',$3,'casa azul',false)`,
      [l.t, cli.id, bairro],
    );
    // O último pedido de entrega foi na Rua C (a 2ª da lista: a principal é a Rua B).
    await q(
      `insert into pedido_externo (tenant_id, canal, display_id, cliente_id, cliente_nome, tipo, endereco_rua, endereco_numero, itens, total, status)
       values ($1,'cardapio','1',$2,'Bruno','entrega','Rua C','30','[]'::jsonb,10,'concluido')`,
      [l.t, cli.id],
    );
    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata' });
    // Bebida não pede adicional nem observação; e já tem bebida: nada a sugerir nesta loja.
    expect(r.pedido.proximo).toMatchObject({ campo: 'mais_algo', opcoes: ['Não, só isso'] });
    r = await robo.mexerNosItens(c, { acao: 'fechar' });
    expect(r.pedido.proximo).toMatchObject({ campo: 'endereco', opcoes: ['Sim, nesse', 'Outro endereço', 'Retirar na loja'] });
    expect(r.pedido.proximo.pergunta).toContain('Rua C, 30');
    expect(r.pedido.proximo.comoResponder).toContain('endereco = 2');
    expect(r.pedido.enderecosParaEscolher).toEqual([
      'Endereço 1 — Rua B, 20 · Centro · ref: apto 101',
      'Endereço 2 — Rua C, 30 · Centro · ref: casa azul',
      'Cadastrar novo endereço',
    ]);
    r = await robo.definirEntrega(c, { tipo: 'entrega', endereco: 2 });
    expect(r.pedido.entrega).toMatchObject({ endereco: 'Rua C, 30 · Centro · ref: casa azul', taxa: 'R$ 5,00' });
    expect(r.pedido.nome).toBe('Bruno'); // do cadastro
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['minimo', 'pagamento']);
    expect(r.pedido.falta[0].pergunta).toBe('O pedido mínimo para entrega é R$ 20,00 em itens (faltam R$ 14,00).');
    r = await robo.definirEntrega(c, { tipo: 'retirada' });
    r = await robo.definirPagamento(c, { forma: 'cartão' });
    expect(r.pedido).toMatchObject({ entrega: { tipo: 'retirada' }, falta: [], podeRegistrar: true, pagamento: { forma: 'Cartão na retirada (maquininha)', troco: null } });
    expect((await robo.definirEntrega(c, { tipo: 'entrega', endereco: 7 })) as any).toMatchObject({ ok: false, motivo: 'endereco' });
  });

  // Bloco 1 do plano de 31/10/2026 (pedido do dono): "no primeiro contato, verificar se o cliente já está no sistema e os
  // últimos pedidos para indicar repetir"; o upsell antes de confirmar (a troca pelo trio; o que o cliente costuma pedir).
  it('Bloco 1: o cliente conhecido repete o último pedido; o lanche sozinho oferece o trio; a sugestão pelo histórico', async () => {
    const l = await loja();
    const c = await l.ctx();
    const [cli] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Carla','21987654321') returning id`, [l.t]);
    const menu: any = await (robo as any).cardapio.menu(l.token);
    const xb = menu.produtos.find((p: any) => p.nome === 'X-Bacon');
    const bacon = xb.grupos.flatMap((g: any) => g.opcoes).find((o: any) => o.nome === 'Bacon extra');
    const coca = menu.produtos.find((p: any) => p.nome === 'Coca lata');
    const [guarana] = await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, disponivel_cardapio)
       values ($1,'Guaraná lata',$2,5.5,false,false,true) returning id`,
      [l.t, coca.categoriaId],
    );
    await q(
      `insert into pedido_externo (tenant_id, canal, display_id, cliente_id, cliente_nome, tipo, itens, total, status, criado_em)
       values ($1,'cardapio','7',$2,'Carla','retirada',$3::jsonb,63.3,'concluido', now() - interval '2 days')`,
      [l.t, cli.id, JSON.stringify([
        { produtoId: xb.id, opcaoIds: [bacon.id], quantidade: 2, descricao: 'X-Bacon' },
        { produtoId: guarana.id, opcaoIds: [], quantidade: 1, descricao: 'Guaraná lata' },
      ])],
    );
    let v: any = await robo.ver(c);
    expect(v.emCurso).toBe(false);
    expect(v.ultimoPedido).toMatchObject({ numero: '7', itens: ['2x X-Bacon', '1x Guaraná lata'], comoRepetir: 'mexer_no_pedido com acao = repetir' });

    // Repetir é pedir igual: os itens com o adicional, sem a pergunta dos extras; o "mais alguma coisa?" vem com o trio.
    let r: any = await robo.mexerNosItens(c, { acao: 'repetir' });
    expect(r.ok).toBe(true);
    expect(r.pedido.itens.map((i: any) => [i.linha, i.quantidade, i.item])).toEqual([
      [1, 2, 'X-Bacon (Bacon extra)'],
      [2, 1, 'Guaraná lata'],
    ]);
    expect(r.pedido.proximo).toMatchObject({ campo: 'mais_algo', opcoes: ['Trocar pelo Trio X-Bacon — +R$ 9,00', 'Não, só isso'] });
    expect(r.pedido.proximo.comoResponder).toContain('acao = trocar_pelo_trio e linha = 1');
    // Com o pedido em montagem: continuar — não oferece repetir de novo.
    v = await robo.ver(c);
    expect(v).toMatchObject({ emCurso: true });
    expect(v.ultimoPedido).toBeUndefined();

    // A troca pelo trio: o item vira o trio (mesma quantidade); o adicional que o trio não tem sai; o refri é perguntado.
    r = await robo.mexerNosItens(c, { acao: 'trocar_pelo_trio', linha: 1 });
    expect(r.pedido.itens[0]).toMatchObject({ linha: 1, quantidade: 2, item: 'Trio X-Bacon' });
    expect(r.pedido.proximo).toMatchObject({ campo: 'linha 1', opcoes: ['Coca-Cola', 'Guaraná'] });

    // Outro pedido da mesma cliente (sem bebida): a sugestão traz primeiro a bebida que ela costuma pedir.
    await robo.cancelar(c);
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon', adicionais: 'bacon' });
    expect(r.pedido.proximo).toMatchObject({
      campo: 'mais_algo',
      opcoes: ['Trocar pelo Trio X-Bacon — +R$ 9,00', 'Guaraná lata — R$ 5,50', 'Coca lata — R$ 6,00', 'Não, só isso'],
    });
  });

  // Bloco 1b do plano de 31/10/2026 (pedido do dono): "antes do pagamento verificar saldo e perguntar se quer usar para
  // desconto no pedido"; o cupom só quando o cliente fala; o resumo com o desconto e o cashback que o pedido dá.
  it('Bloco 1b: o cashback perguntado antes do pagamento; o cupom que o cliente diz; o resumo e o pedido com o desconto e o ganho', async () => {
    const l = await loja();
    const c = await l.ctx();
    const tel = '21987654321';
    await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Dora',$2)`, [l.t, tel]);
    // Plano de 10% sobre o total; R$ 8,00 de saldo (o saldo é a soma do extrato — gatilho da mig 274); cupom de R$ 5 (mínimo R$ 20).
    await q(`insert into cashback_plano (tenant_id, tipo, ativo, status, percentual, base) values ($1,'valor',true,'ativo',10,'total')`, [l.t]);
    await q(`insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem) values ($1,$2,'valor',8,'credito')`, [l.t, tel]);
    await q(`insert into cupom (tenant_id, codigo, tipo, valor, minimo, ativo) values ($1,'BEMVINDO','valor',5,20,true)`, [l.t]);

    // "Quanto tenho de cashback?": ver_pedido traz o saldo (o robô não abre a conversa com isso).
    const v: any = await robo.ver(c);
    expect(v.beneficios).toMatchObject({ saldoCashback: 'R$ 8,00' });

    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'xbacon', adicionais: ['bacon'] }); // R$ 29,90
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata' }); // + R$ 6,00
    expect(r.pedido.falta.map((f: any) => f.campo)).not.toContain('cashback'); // com os itens abertos, ainda não
    r = await robo.mexerNosItens(c, { acao: 'fechar' });
    r = await robo.definirEntrega(c, { tipo: 'retirada' });
    // Depois do nome (do cadastro) e antes do pagamento: o cashback, com o total que fica.
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['cashback', 'pagamento']);
    expect(r.pedido.proximo).toMatchObject({ campo: 'cashback', opcoes: ['Usar meu cashback — −R$ 8,00', 'Guardar para depois'] });
    expect(r.pedido.proximo.pergunta).toContain('o total fica R$ 27,90');
    expect(r.pedido.total).toBe('R$ 35,90'); // nada descontado antes de ele dizer

    // O cupom que o cliente disse: o errado volta com o motivo; o certo entra (em maiúsculas) e o cashback pergunta sobre o resto.
    r = await robo.mexerNosItens(c, { acao: 'usar_cupom', observacao: 'NAOEXISTE' });
    expect(r).toMatchObject({ ok: false, motivo: 'cupom' });
    expect(r.mensagem).toContain('Cupom inválido');
    r = await robo.mexerNosItens(c, { acao: 'usar_cupom', observacao: 'cupom bemvindo' });
    expect(r.ok).toBe(true);
    expect(r.pedido.descontos).toEqual([{ rotulo: 'Cupom BEMVINDO', valor: '−R$ 5,00' }]);
    expect(r.pedido.total).toBe('R$ 30,90');
    expect(r.pedido.proximo.campo).toBe('cashback');
    expect(r.pedido.proximo.pergunta).toContain('o total fica R$ 22,90');

    r = await robo.mexerNosItens(c, { acao: 'usar_cashback' });
    expect(r.pedido.descontos).toEqual([
      { rotulo: 'Cupom BEMVINDO', valor: '−R$ 5,00' },
      { rotulo: 'Cashback', valor: '−R$ 8,00' },
    ]);
    expect(r.pedido).toMatchObject({ total: 'R$ 22,90', cashbackGanho: 'R$ 2,29' }); // 10% de R$ 22,90
    expect(r.pedido.proximo.campo).toBe('pagamento');
    r = await robo.definirPagamento(c, { forma: 'cartão' });
    expect(r.pedido).toMatchObject({ podeRegistrar: true, total: 'R$ 22,90', cupom: 'BEMVINDO' });
    const conferir = enviados[enviados.length - 1].texto;
    for (const pedaco of ['Cupom BEMVINDO: −R$ 5,00', 'Cashback: −R$ 8,00', '💰 *Total: R$ 22,90*', '🎁 Com este pedido você ganha *R$ 2,29* de cashback.'])
      expect(conferir).toContain(pedaco);

    // Registrado pela conta do cardápio: o mesmo total, o saldo gasto, o uso do cupom e o resumo com o ganho.
    const reg: any = await robo.registrar(c, {});
    expect(reg.ok).toBe(true);
    const [ped] = await q(`select total, desconto from pedido_externo where tenant_id = $1`, [l.t]);
    expect(Number(ped.total)).toBeCloseTo(22.9, 2);
    expect(Number(ped.desconto)).toBeCloseTo(13, 2);
    const [saldo] = await q(`select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`, [l.t, tel]);
    expect(Number(saldo.saldo)).toBeCloseTo(0, 2);
    expect(await q(`select count(*)::int as n from cupom_uso where tenant_id = $1`, [l.t])).toEqual([{ n: 1 }]);
    const final = enviados[enviados.length - 1].texto;
    expect(final).toContain('Desconto: −R$ 13,00');
    expect(final).toContain('🎁 Você ganha *R$ 2,29* de cashback com este pedido');
  });

  it('Bloco 1b: o prêmio da fidelidade vem antes do cashback; "Guardar para depois" guarda o saldo e a forma não apaga as escolhas', async () => {
    const l = await loja();
    await q(`update cardapio_config set fidelidade_ativa = true where tenant_id = $1`, [l.t]);
    const c = await l.ctx();
    const tel = '21987654321';
    await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Edu',$2)`, [l.t, tel]);
    const [plano] = await q(
      `insert into fidelidade_plano (tenant_id, nome, pontos_meta, recompensa_tipo, recompensa_valor) values ($1,'Clube do lanche',10,'valor_fixo',5) returning id`,
      [l.t],
    );
    const [premio] = await q(`insert into fidelidade_resgate (tenant_id, plano_id, telefone) values ($1,$2,$3) returning id`, [l.t, plano.id, tel]);
    await q(`insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem) values ($1,$2,'valor',3,'credito')`, [l.t, tel]);

    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata', quantidade: 4 }); // R$ 24,00
    await robo.mexerNosItens(c, { acao: 'fechar' });
    let r: any = await robo.definirEntrega(c, { tipo: 'retirada' });
    expect(r.pedido.falta.map((f: any) => f.campo)).toEqual(['premio', 'cashback', 'pagamento']);
    expect(r.pedido.proximo).toMatchObject({ campo: 'premio', opcoes: ['Usar o prêmio — R$ 5.00 de desconto no próximo pedido', 'Deixar para depois'] });

    r = await robo.mexerNosItens(c, { acao: 'usar_premio' });
    expect(r.ok).toBe(true);
    expect(r.pedido.descontos).toEqual([{ rotulo: 'Prêmio · Clube do lanche', valor: '−R$ 5,00' }]);
    expect(r.pedido.total).toBe('R$ 19,00');
    expect(r.pedido.cashbackGanho).toBeUndefined(); // a loja não tem plano de cashback
    // O prêmio ganho foi resgatado agora (o passo do "Resgatar" do cardápio); o cashback pergunta sobre o resto.
    expect((await q(`select status from fidelidade_resgate where id = $1`, [premio.id]))[0].status).toBe('resgatado');
    expect(r.pedido.proximo).toMatchObject({ campo: 'cashback', opcoes: ['Usar meu cashback — −R$ 3,00', 'Guardar para depois'] });

    r = await robo.mexerNosItens(c, { acao: 'guardar_cashback' });
    expect(r.pedido).toMatchObject({ total: 'R$ 19,00' });
    expect(r.pedido.proximo.campo).toBe('pagamento');
    r = await robo.definirPagamento(c, { forma: 'cartão' });
    expect(r.pedido).toMatchObject({ podeRegistrar: true, total: 'R$ 19,00' });
    expect(r.pedido.falta).toEqual([]);

    const reg: any = await robo.registrar(c, {});
    expect(reg.ok).toBe(true);
    const [ped] = await q(`select id, total from pedido_externo where tenant_id = $1`, [l.t]);
    expect(Number(ped.total)).toBeCloseTo(19, 2);
    expect(await q(`select status, pedido_id from fidelidade_resgate where id = $1`, [premio.id])).toEqual([{ status: 'usado', pedido_id: ped.id }]);
    // O saldo guardado continua inteiro.
    expect(Number((await q(`select saldo from cashback_saldo where tenant_id = $1 and tipo = 'valor'`, [l.t]))[0].saldo)).toBeCloseTo(3, 2);
  });

  // Caminho A dos adicionais (aprovado pelo dono em 31/10/2026): os botões do WhatsApp são de escolha única.
  it('caminho A: "2 bacon" entra duas vezes; a lista mostra quantos já tem; o molho que não repete entra uma vez e o Regem avisa', async () => {
    const l = await loja();
    const c = await l.ctx();
    // Um lanche com uma etapa de molhos que NÃO repete.
    const [cat] = await q(`select id from categoria_produto where tenant_id = $1 and nome = 'Lanches'`, [l.t]);
    const [burguer] = await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque, disponivel_cardapio)
       values ($1,'Burguer da casa',$2,30,false,false,true) returning id`,
      [l.t, cat.id],
    );
    const maio: any = await produtos.criarOpcaoCatalogo(l.t, { nome: 'Maionese verde', codigoPdv: 'M1' });
    const molhos: any = await produtos.criarComplemento(l.t, { nome: 'Molhos', regra: 'varias', max: 2, itens: [{ opcaoId: maio.id, preco: 1 }] });
    await produtos.setProdutoComplementos(l.t, burguer.id, [molhos.id]);

    // A quantidade dita: duas vezes o bacon (a etapa repete), sem aviso.
    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'xbacon', adicionais: '2 bacon' });
    expect(r.pedido.itens[0]).toMatchObject({ item: 'X-Bacon (2x Bacon extra)', total: 'R$ 33,90' });
    expect(r.aviso).toBeUndefined();
    // O molho que não repete: entra uma vez e volta o aviso (antes ia calado).
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'burguer da casa', adicionais: '2 maionese verde' });
    expect(r.aviso).toContain('Maionese verde vai uma vez só');
    expect(r.pedido.itens[1]).toMatchObject({ item: 'Burguer da casa (Maionese verde)', total: 'R$ 31,00' });

    // Um adicional por toque: o bacon fica na lista com quantos já tem, e tocar de novo põe mais um.
    await robo.cancelar(c);
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'xbacon' });
    expect(r.pedido.proximo).toMatchObject({ campo: 'extras 1' });
    expect(r.pedido.proximo.opcoes[0]).toBe('Bacon extra — +R$ 4,00');
    r = await robo.mexerNosItens(c, { acao: 'escolher', linha: 1, adicionais: 'Bacon extra — +R$ 4,00' });
    expect(r.pedido.proximo.opcoes[0]).toBe('Bacon extra (1) — +R$ 4,00');
    expect(r.pedido.proximo.pergunta).toContain('tocar de novo põe mais um');
    r = await robo.mexerNosItens(c, { acao: 'escolher', linha: 1, adicionais: 'Bacon extra (1) — +R$ 4,00' });
    expect(r.pedido.itens[0]).toMatchObject({ item: 'X-Bacon (2x Bacon extra)', total: 'R$ 33,90' });
    expect(r.pedido.proximo.opcoes[0]).toBe('Bacon extra (2) — +R$ 4,00');
  });

  it('API oficial: o resumo para conferir vai com os 3 botões; o que passa do limite vai em texto + botões', async () => {
    const l = await loja('cloud');
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'coca lata', quantidade: 4 });
    await robo.mexerNosItens(c, { acao: 'fechar' });
    await robo.definirEntrega(c, { tipo: 'retirada' });
    await robo.definirNome(c, { nome: 'Dani' });
    await robo.definirPagamento(c, { forma: 'Dinheiro', troco: 'não preciso' });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ opcoes: ['Pode registrar', 'Pôr observação', 'Quero mudar algo'] });
    expect(enviados[0].texto).toContain('Sem troco');
    // Uma observação bem longa empurra o texto acima de 1000: o resumo vai em texto e os botões, logo depois.
    await robo.mexerNosItens(c, { acao: 'observacao_do_pedido', observacao: 'x'.repeat(300) });
    for (let i = 0; i < 12; i++) await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon', observacao: `lanche ${i} sem cebola e bem passado` });
    await robo.mexerNosItens(c, { acao: 'fechar' });
    const ultimos = enviados.slice(-2);
    expect(ultimos[0].opcoes).toBeUndefined();
    expect(ultimos[0].texto.length).toBeGreaterThan(1000);
    expect(ultimos[1]).toMatchObject({ texto: 'Está tudo certo? 👇', opcoes: ['Pode registrar', 'Pôr observação', 'Quero mudar algo'] });
  });

  // A ferramenta do n8n descreve só adicionar/alterar/remover/limpar: a IA pode não usar as ações novas. Nada pode
  // ficar em ciclo por isso.
  it('a IA que não usa as ações novas: "Não, obrigado" como observação ou adicional conclui; a entrega fecha o "mais alguma coisa?"', async () => {
    const l = await loja();
    const c = await l.ctx();
    let r: any = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon' });
    expect(r.pedido.proximo.campo).toBe('extras 1');
    r = await robo.mexerNosItens(c, { acao: 'alterar', linha: 1, observacao: 'Não, obrigado' });
    expect(r.pedido.itens[0].observacao).toBeNull(); // não virou observação
    expect(r.pedido.proximo.campo).toBe('mais_algo');
    r = await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'trio x-bacon', adicionais: 'coca-cola' });
    expect(r.pedido.proximo.campo).toBe('extras 2');
    r = await robo.mexerNosItens(c, { acao: 'escolher', adicionais: 'Não, obrigado' });
    expect(r.pedido.proximo.campo).toBe('mais_algo');
    // A IA foi direto para a entrega sem chamar "fechar": o "mais alguma coisa?" conta como respondido.
    r = await robo.definirEntrega(c, { tipo: 'retirada' });
    expect(r.pedido.falta.map((f: any) => f.campo)).not.toContain('mais_algo');
    // Ação que o Regem não conhece: recusa explicada (200), não erro.
    r = await robo.mexerNosItens(c, { acao: 'trocar_tudo' });
    expect(r).toMatchObject({ ok: false, motivo: 'acao' });
    expect(r.pedido.itens).toHaveLength(2);
  });

  it('com o adicional ou a observação do item ainda por perguntar, ir para a entrega NÃO pula a pergunta', async () => {
    const l = await loja();
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'adicionar', produto: 'x-bacon' });
    const r: any = await robo.definirEntrega(c, { tipo: 'retirada' });
    expect(r.pedido.proximo.campo).toBe('extras 1');
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
