import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { SO_INGREDIENTES } from '../../common/embalagem-da-ficha';
import { DesperdicioService } from '../desperdicio/desperdicio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// KDS × DELIVERY × CANCELAMENTO × ESTOQUE — os cinco defeitos da auditoria de 02/10/2026
// (ERR-147 a 151), contra o Postgres real (TEST_PG_URL), com os serviços de verdade: o pedido é
// ACEITO pelo caminho do painel (venda, lançamento e card nascem como na loja).
//
//  147 · o canal (ou o cliente, na encomenda) cancela → o pedido era cancelado, mas o card seguia
//        na cozinha e avançava, e a venda continuava valendo.
//  148 · item acrescentado depois do aceite = 2º card; o 1º pronto já fechava o pedido e avisava o canal.
//  149 · cancelar só o card (fila de produção do PDV) deixava o delivery "confirmado" para sempre.
//  150 · "Voltar" um cancelado reabria o pedido sem cozinha e sem venda.
//  151 · cancelar com PERDA em produção não baixava nada e a resposta dizia "registrados como perda".
//  Perda parcial (dono, 28/10/2026): só os itens marcados saem, como DESPERDÍCIO (não venda), e o pedido que o canal
//  cancelou ganha o "Registrar perda" depois.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-delivery-cancelamentos.spec: sem TEST_PG_URL — PULADO');

const SENHA_GESTOR = 'Senha-Do-Gestor-1';

descrever('KDS × delivery: cancelamentos, pronto parcial, voltar e perda (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const emitidos: { nome: string; dado: any }[] = [];
  const eventos = { emit: (nome: string, dado: any) => (emitidos.push({ nome, dado }), true) } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  // cashback e fidelidade de mentira: qualquer método responde; os estornos são contados
  const estornados: { servico: string; pedidoId: string }[] = [];
  const beneficio = (servico: string) =>
    new Proxy({}, {
      get: (_alvo, metodo) => async (_tenant: string, pedidoId: string) => {
        if (metodo === 'estornarPedido') estornados.push({ servico, pedidoId });
        return undefined;
      },
    }) as any;
  const delivery = new DeliveryService(
    db, vendas, producao, beneficio('cashback'), beneficio('fidelidade'), eventos, { flashPedidos: () => undefined } as any,
  );
  const edgeOriginal = process.env.EDGE_MODE;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let senha = 500;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM: é lá que os canais avisam o cancelamento
    // O banco do CI é montado como o de uma loja e não tem as tabelas só-nuvem que o card consulta
    // ao nascer ("o servidor da loja está no ar?"). `create table if not exists` não é seguro
    // entre specs em paralelo (ERR-128): quem perde a corrida recebe 23505/42P07 — é "já existe".
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(
          `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
        )
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  beforeEach(() => {
    auditado.length = 0;
    emitidos.length = 0;
    estornados.length = 0;
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      // movimento_lote e as tabelas-filhas saem pela cascata; a ordem abaixo respeita as referências
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'caixa_sessao', 'movimento_estoque', 'desperdicio', 'comanda', 'produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_estoque', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste: um produto que baixa 1 unidade do insumo por venda, com 100 em estoque ──
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste kds delivery') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    const item = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,'Pão de teste','un',2) returning id`, [t]))[0].id as string;
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade) values ($1,$2,'entrada',100)`, [t, item]);
    const prod = async (codigo: string, nome: string) =>
      (await q(
        `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao, controla_estoque, item_id)
         values ($1,$2,$3,'20.00',true,true,$4) returning id`,
        [t, codigo, nome, item],
      ))[0].id as string;
    const produtoId = await prod('XT1', 'Lanche de teste');
    const extraId = await prod('XT2', 'Porção de teste');
    // produto por FICHA, com uma linha só de delivery (a embalagem): 1 pão + 1 embalagem por venda
    const emb = (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,'Embalagem de teste','un',1) returning id`, [t]))[0].id as string;
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade) values ($1,$2,'entrada',50)`, [t, emb]);
    const ficha = (await q(`insert into ficha_tecnica (tenant_id, nome, rendimento) values ($1,'Ficha de teste',1) returning id`, [t]))[0].id as string;
    await q(
      `insert into ficha_ingrediente (tenant_id, ficha_id, item_id, insumo_nome, quantidade, fator_correcao, custo_unitario, somente_delivery)
       values ($1,$2,$3,'Pão de teste',1,1,2,false), ($1,$2,$4,'Embalagem de teste',1,1,1,true)`,
      [t, ficha, item, emb],
    );
    await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao, controla_estoque, ficha_id)
       values ($1,'XT3','Marmita de teste','20.00',true,true,$2)`,
      [t, ficha],
    );
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Gestora',$2,$3) returning id`, [t, funcao, await bcrypt.hash(SENHA_GESTOR, 4)]))[0].id as string;
    return { t, u, item, emb, produtoId, extraId, gestor };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  type Opcoes = { canal?: string; tipo?: string; codigo?: string; descricao?: string; itens?: { codigo: string; descricao: string; quantidade: number }[] };

  /** Pedido que chegou do canal, ainda não aceito. */
  async function chegou(l: Loja, o: Opcoes = {}) {
    senha++;
    const externalId = randomUUID();
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, cliente_telefone,
         tipo, itens, total, forma_pagamento, status, pago)
       values ($1,$2,$3,$4,$5,'Cliente de teste','5500000000000',$6,$7::jsonb,'20.00','online','novo',true) returning id`,
      [l.t, l.u, o.canal ?? 'ifood', externalId, String(senha), o.tipo ?? 'delivery',
       JSON.stringify(
         (o.itens ?? [{ codigo: o.codigo ?? 'XT1', descricao: o.descricao ?? 'Lanche de teste', quantidade: 1 }]).map((it) => ({ ...it, precoUnitario: 20 })),
       )],
    );
    return { id: p.id as string, externalId, canal: o.canal ?? 'ifood' };
  }
  /** Pedido aceito pelo painel: venda fechada, lançamento e card na cozinha. */
  async function aceito(l: Loja, o: Opcoes = {}) {
    const p = await chegou(l, o);
    const r: any = await delivery.aceitar(l.t, l.gestor, p.id);
    const comandaId = r.comandaId as string;
    let cs = await cards(comandaId);
    // Sem destino de produção configurado o aceite pode não criar card: a cozinha do teste tem um.
    if (!cs.length) {
      await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,$4,'recebido','delivery',$4)`, [l.t, l.u, comandaId, senha]);
      cs = await cards(comandaId);
    }
    emitidos.length = 0;
    auditado.length = 0;
    return { ...p, comandaId, card: cs[0].id as string };
  }
  const cards = (comandaId: string) => q(`select id, status from producao_pedido where comanda_id = $1 order by criado_em, id`, [comandaId]);
  const pedido = async (id: string) => (await q(`select status, comanda_id, motivo_cancelamento, estoque_reaproveitado from pedido_externo where id = $1`, [id]))[0];
  const comanda = async (id: string) => (await q(`select status, estoque_reaproveitado from comanda where id = $1`, [id]))[0];
  const lancamentos = (comandaId: string) => q(`select tipo, categoria, valor::float as valor, estorno_de from lancamento_caixa where comanda_id = $1 order by created_at, id`, [comandaId]);
  const saldoDe = async (l: Loja, itemId: string) => Number((await q(`select coalesce(sum(case when tipo = 'entrada' then quantidade else -quantidade end), 0)::float as s from movimento_estoque where tenant_id = $1 and item_id = $2`, [l.t, itemId]))[0].s);
  const saldo = (l: Loja) => saldoDe(l, l.item);
  const cancelouNaCozinha = () => emitidos.filter((e) => e.nome === 'producao.evento' && e.dado?.tipo === 'cancelado').length;
  const avancarCard = (l: Loja, cardId: string) => producao.avancar(l.t, l.gestor, cardId);
  const cancelarNoPainel = (l: Loja, id: string, reaproveitado: boolean, perdaItens: any[] | null = null) =>
    delivery.cancelar(l.t, l.gestor, 'gerente', id, 'Cliente desistiu', SENHA_GESTOR, reaproveitado, null, perdaItens) as Promise<any>;
  /** Os itens da venda (o id que a tela da perda manda), pela ordem em que entraram. */
  const itensDaVenda = (comandaId: string) =>
    q(`select id, descricao, quantidade::float as quantidade from comanda_item where comanda_id = $1 order by descricao`, [comandaId]);
  /** O que a perda deixou em Estoque › Desperdício, e os movimentos de cada linha. */
  const desperdicios = (l: Loja) =>
    q(
      `select d.descricao, d.motivo, d.quantidade::float as quantidade, d.custo_unitario::float as custo,
              (select coalesce(json_agg(json_build_object('motivo', m.motivo, 'item', m.item_id, 'q', m.quantidade::float) order by m.item_id), '[]'::json)
                 from movimento_estoque m where m.ref_tipo = 'desperdicio' and m.ref_id = d.id) as movs
         from desperdicio d where d.tenant_id = $1 order by d.descricao`,
      [l.t],
    );

  // ══════════════════════════════════════════════════════════════════════════════════════════
  describe('ERR-147 · o canal cancela: a cozinha para e a venda é desfeita', () => {
    it('pedido aceito e em preparo: pedido cancelado, venda estornada, card fora da fila — e não avança mais', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card); // recebido → preparo
      emitidos.length = 0;
      const antes = await lancamentos(p.comandaId);
      expect(antes.filter((x) => x.tipo === 'entrada')).toHaveLength(1);

      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');

      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', motivo_cancelamento: 'Cancelado pelo ifood' });
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
      const depois = await lancamentos(p.comandaId);
      expect(depois.filter((x) => x.categoria === 'estorno')).toHaveLength(1);
      expect(depois.filter((x) => x.categoria === 'estorno')[0]).toMatchObject({ tipo: 'saida', valor: 20 });
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
      expect(cancelouNaCozinha()).toBe(1); // o KDS recebe o alerta de cancelado
      expect(auditado.filter((a) => a.acao === 'cancelou_delivery')).toEqual([expect.objectContaining({ tenantId: l.t, atorPerfil: 'servico', entidadeId: p.comandaId })]);
      await expect(avancarCard(l, p.card)).rejects.toThrow('Pedido cancelado não avança.');
      expect(await saldo(l)).toBe(100); // no delivery a baixa é na conclusão: nada saiu, nada volta
      expect(estornados.map((e) => e.servico).sort()).toEqual(['cashback', 'fidelidade']); // o crédito do aceite volta
    });

    it('o mesmo cancelamento chegando de novo (ou dois ao mesmo tempo) não estorna em dobro', async () => {
      const l = await loja();
      const p = await aceito(l);
      await Promise.all([
        delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado'),
        delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado'),
      ]);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1);
      expect(auditado.filter((a) => a.acao === 'cancelou_delivery')).toHaveLength(1);
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
    });

    it('pedido já concluído: o cancelamento do canal não desfaz nada', async () => {
      const l = await loja();
      const p = await aceito(l);
      await q(`update pedido_externo set status = 'concluido', concluido_em = now() where id = $1`, [p.id]);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      expect((await pedido(p.id)).status).toBe('concluido');
      expect((await comanda(p.comandaId)).status).toBe('fechada');
      // O cartão fechou quando o pedido saiu da loja (gatilho da mig 330) — e o cancelamento tardio não o cancela.
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['entregue']);
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(0);
    });

    it('pedido ainda não aceito (sem venda): só o pedido é cancelado, sem erro', async () => {
      const l = await loja();
      const p = await chegou(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', comanda_id: null });
      expect(auditado).toEqual([]);
    });

    // Auditoria do KDS (11/11/2026, O11): o "Pronto" marcado NA LOJA pelo painel fecha a etapa na cozinha — a TV de senhas
    // mostra a senha em "Pronto" e o tempo de preparo fica medido. O reflexo do canal (o teste abaixo) segue sem mexer.
    it('o "Pronto" do painel deixa os cartões ainda abertos prontos (com a hora); o cartão já pronto não muda', async () => {
      const l = await loja();
      const p = await aceito(l);
      const [card] = await cards(p.comandaId);
      expect(card.status).toBe('recebido');
      // Outra empresa não alcança os cartões desta (com o cartão ainda aberto).
      expect(await producao.prontoPeloPedido(randomUUID(), p.comandaId)).toBe(0);
      expect((await cards(p.comandaId))[0].status).toBe('recebido');
      emitidos.length = 0;
      await delivery.avancar(l.t, p.id); // confirmado → pronto, pela tela do Delivery
      expect((await pedido(p.id)).status).toBe('pronto');
      const [depois] = await q(`select status, pronto_em from producao_pedido where id = $1`, [card.id]);
      expect(depois.status).toBe('pronto');
      expect(depois.pronto_em).not.toBeNull();
      // O KDS e a TV ficam sabendo (um aviso por cartão), e nada volta para o painel em laço.
      expect(
        emitidos.filter((e) => e.nome === 'producao.evento' && e.dado?.pedidoId === card.id && e.dado?.tipo === 'status' && e.dado?.status === 'pronto'),
      ).toHaveLength(1);
      expect(emitidos.filter((e) => e.nome === 'producao.pronto')).toHaveLength(0);
      // De novo: o cartão já pronto não muda pelo "pronto".
      expect(await producao.prontoPeloPedido(l.t, p.comandaId)).toBe(0);
    });

    it('os outros reflexos do canal não desfazem a venda: pronto não mexe na cozinha; despachado fecha o cartão (mig 330)', async () => {
      const l = await loja();
      const p = await aceito(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'pronto');
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['recebido']);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'despachado');
      expect((await pedido(p.id)).status).toBe('despachado');
      expect((await comanda(p.comandaId)).status).toBe('fechada');
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['entregue']); // saiu da loja: fechado, não cancelado
      expect(cancelouNaCozinha()).toBe(0);
    });

    it('encomenda que o cliente cancela depois de aceita (cancelamento do sistema): mesma coisa', async () => {
      const l = await loja();
      const p = await aceito(l, { canal: 'cardapio', tipo: 'retirada' });
      const r = await delivery.cancelarSistema(l.t, p.id, 'Cancelado pelo cliente (encomenda)');
      expect(r).toMatchObject({ ok: true });
      expect((await pedido(p.id)).status).toBe('cancelado');
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1);
      // repetir não desfaz de novo
      expect(await delivery.cancelarSistema(l.t, p.id, 'de novo')).toEqual({ ok: false });
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1);
    });

    it('cancelamento do sistema em pedido sem venda (PIX que não chegou) e com a venda já desfeita (totem): nada em dobro', async () => {
      const l = await loja();
      const semVenda = await chegou(l, { canal: 'cardapio' });
      expect(await delivery.cancelarSistema(l.t, semVenda.id, 'Pagamento PIX não recebido no prazo')).toMatchObject({ ok: true });
      expect(auditado).toEqual([]);
      const p = await aceito(l, { canal: 'totem', tipo: 'retirada' });
      await vendas.estornarVendaExterna(l.t, null, 'servico', p.comandaId, 'cupom não impresso', true, { acao: 'venda_totem_desfeita_sem_cupom' });
      auditado.length = 0;
      await delivery.cancelarSistema(l.t, p.id, 'Cupom fiscal não impresso no totem');
      expect(auditado).toEqual([]); // a venda já estava desfeita: não se registra outro cancelamento
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1);
    });

    it('card que ficou para trás (a venda foi cancelada e o card não): ao tocar, sai da fila em vez de avançar', async () => {
      const l = await loja();
      // 1) a venda cancelada chegou antes do card (sincronismo): comanda cancelada, card ainda em preparo
      const a = await aceito(l);
      await q(`update comanda set status = 'cancelada' where id = $1`, [a.comandaId]);
      await q(`update producao_pedido set status = 'preparo' where id = $1`, [a.card]);
      await expect(avancarCard(l, a.card)).rejects.toThrow('Pedido cancelado: o card saiu da fila.');
      expect((await cards(a.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
      expect(cancelouNaCozinha()).toBe(1);
      // 2) pedido cancelado pelo canal antes desta correção: comanda ainda fechada, card ativo
      const b = await aceito(l);
      await q(`update pedido_externo set status = 'cancelado' where id = $1`, [b.id]);
      await expect(avancarCard(l, b.card)).rejects.toThrow('Pedido cancelado: o card saiu da fila.');
      expect((await cards(b.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
    });

    it('card de venda que vale (delivery ativo, balcão, sem comanda) avança como antes', async () => {
      const l = await loja();
      const p = await aceito(l);
      expect(await avancarCard(l, p.card)).toMatchObject({ ok: true, status: 'preparo' });
      const balcao = randomUUID();
      await q(`insert into comanda (id, tenant_id, unidade_id, status, total) values ($1,$2,$3,'fechada',10)`, [balcao, l.t, l.u]);
      const [cb] = await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,901,'recebido','balcao',901) returning id`, [l.t, l.u, balcao]);
      expect(await avancarCard(l, cb.id)).toMatchObject({ ok: true, status: 'preparo' });
      const [solto] = await q(`insert into producao_pedido (tenant_id, unidade_id, senha, status, origem, numero) values ($1,$2,902,'recebido','balcao',902) returning id`, [l.t, l.u]);
      expect(await avancarCard(l, solto.id)).toMatchObject({ ok: true, status: 'preparo' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  describe('ERR-148 · pedido com dois cards só fica pronto quando o último fica pronto', () => {
    const pronto = async (l: Loja, cardId: string, comandaId: string) => {
      emitidos.length = 0;
      await avancarCard(l, cardId); // → preparo
      await avancarCard(l, cardId); // → pronto
      // o emissor do teste não entrega eventos: confere que o KDS avisou e entrega ao ouvinte
      expect(emitidos.filter((e) => e.nome === 'producao.pronto')).toEqual([{ nome: 'producao.pronto', dado: { tenantId: l.t, comandaId } }]);
      await delivery.aoProducaoPronto({ tenantId: l.t, comandaId });
    };

    it('item acrescentado depois do aceite: o 1º card pronto NÃO fecha o pedido; o 2º fecha', async () => {
      const l = await loja();
      const p = await aceito(l);
      // segundo card da mesma comanda (é o que `alterarItensExterno` cria ao acrescentar o item)
      const [c2] = await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,$4,'recebido','delivery',$4) returning id`, [l.t, l.u, p.comandaId, senha]);
      await pronto(l, p.card, p.comandaId);
      expect((await pedido(p.id)).status).toBe('confirmado'); // o segundo ainda está na fila
      await pronto(l, c2.id, p.comandaId);
      expect((await pedido(p.id)).status).toBe('pronto');
    });

    it('card cancelado não segura o pedido; card já entregue conta como pronto', async () => {
      const l = await loja();
      const p = await aceito(l);
      await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,$4,'cancelado','delivery',$4), ($1,$2,$3,$4,'entregue','delivery',$4)`, [l.t, l.u, p.comandaId, senha]);
      await pronto(l, p.card, p.comandaId);
      expect((await pedido(p.id)).status).toBe('pronto');
    });

    it('pedido de um card só: fica pronto no primeiro "pronto", como antes', async () => {
      const l = await loja();
      const p = await aceito(l);
      await pronto(l, p.card, p.comandaId);
      expect((await pedido(p.id)).status).toBe('pronto');
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  describe('ERR-149 · card de pedido de canal não se cancela sozinho', () => {
    const cancelarCard = (l: Loja, cardId: string) => producao.cancelarPedido(l.t, l.gestor, 'gerente', cardId, 'engano');

    it('pedido de delivery valendo: recusa, com o caminho certo — card e pedido ficam como estavam', async () => {
      const l = await loja();
      const p = await aceito(l);
      await expect(cancelarCard(l, p.card)).rejects.toThrow('cancele o pedido em Delivery → Painel ou em PDV → Retirada / Encomendas');
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['recebido']);
      expect((await pedido(p.id)).status).toBe('confirmado');
      expect(auditado).toEqual([]);
      // pelo caminho certo o card sai junto
      await cancelarNoPainel(l, p.id, true);
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
    });

    it('pedido já cancelado ou concluído: o card pode sair', async () => {
      const l = await loja();
      const a = await aceito(l);
      await q(`update pedido_externo set status = 'concluido' where id = $1`, [a.id]);
      expect(await cancelarCard(l, a.card)).toEqual({ ok: true });
      const b = await aceito(l);
      await q(`update pedido_externo set status = 'cancelado' where id = $1`, [b.id]);
      expect(await cancelarCard(l, b.card)).toEqual({ ok: true });
    });

    it('card de balcão (venda sem pedido de canal) e card sem comanda: cancelam como antes', async () => {
      const l = await loja();
      const balcao = randomUUID();
      await q(`insert into comanda (id, tenant_id, unidade_id, status, total) values ($1,$2,$3,'fechada',10)`, [balcao, l.t, l.u]);
      const [cb] = await q(`insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,911,'preparo','balcao',911) returning id`, [l.t, l.u, balcao]);
      expect(await cancelarCard(l, cb.id)).toEqual({ ok: true });
      const [solto] = await q(`insert into producao_pedido (tenant_id, unidade_id, senha, status, origem, numero) values ($1,$2,912,'recebido','balcao',912) returning id`, [l.t, l.u]);
      expect(await cancelarCard(l, solto.id)).toEqual({ ok: true });
      expect(auditado.filter((a) => a.acao === 'cancelou_pedido_producao')).toHaveLength(2);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  describe('ERR-150 · pedido cancelado não volta', () => {
    it('cancelado que tinha venda: "Voltar" é recusado e nada muda', async () => {
      const l = await loja();
      const p = await aceito(l);
      await cancelarNoPainel(l, p.id, true);
      await expect(delivery.voltarPedido(l.t, l.gestor, p.id, SENHA_GESTOR)).rejects.toThrow('Pedido cancelado não pode ser reaberto: a venda já foi estornada');
      expect((await pedido(p.id)).status).toBe('cancelado');
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
    });

    it('cancelado que nunca foi aceito: também não volta (iria a "confirmado" sem venda e sem cozinha)', async () => {
      const l = await loja();
      const p = await chegou(l);
      await cancelarNoPainel(l, p.id, true);
      await expect(delivery.voltarPedido(l.t, l.gestor, p.id, SENHA_GESTOR)).rejects.toThrow('Pedido cancelado não pode ser reaberto. Lance um pedido novo.');
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', comanda_id: null });
    });

    it('pedido CONCLUÍDO continua voltando uma etapa, com a senha do gestor', async () => {
      const l = await loja();
      const entrega = await aceito(l);
      await q(`update pedido_externo set status = 'concluido', concluido_em = now() where id = $1`, [entrega.id]);
      await expect(delivery.voltarPedido(l.t, l.gestor, entrega.id, 'senha-errada')).rejects.toThrow('Senha de gestor inválida.');
      expect(await delivery.voltarPedido(l.t, l.gestor, entrega.id, SENHA_GESTOR)).toMatchObject({ status: 'despachado', concluidoEm: null });
      const retirada = await aceito(l, { tipo: 'retirada' });
      await q(`update pedido_externo set status = 'concluido', concluido_em = now() where id = $1`, [retirada.id]);
      expect(await delivery.voltarPedido(l.t, l.gestor, retirada.id, SENHA_GESTOR)).toMatchObject({ status: 'pronto' });
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  describe('ERR-151 · cancelar com PERDA baixa o estoque — e a resposta diz o que aconteceu', () => {
    const UM_ITEM = '1 item lançado como PERDA em Estoque › Desperdício: os insumos saíram do estoque.';

    it('PERDA com a cozinha já em preparo: o insumo sai do estoque como DESPERDÍCIO (não como venda)', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card); // em preparo
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe(UM_ITEM);
      expect(r.perda).toEqual({ itens: 1, custo: 2 });
      expect(await saldo(l)).toBe(99);
      // Antes a perda saía como VENDA da comanda (o CMV contava como vendido e Desperdício não via nada).
      expect(await q(`select 1 from movimento_estoque where tenant_id = $1 and ref_id = $2`, [l.t, p.comandaId])).toEqual([]);
      expect(await desperdicios(l)).toEqual([
        {
          descricao: expect.stringMatching(/^Cancelamento · Pedido #\d+ · 1× Lanche de teste$/),
          motivo: 'Cancelamento',
          quantidade: 1,
          custo: 2,
          movs: [{ motivo: 'desperdicio', item: l.item, q: 1 }],
        },
      ]);
      expect(await comanda(p.comandaId)).toMatchObject({ status: 'cancelada' });
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', estoque_reaproveitado: false });
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1); // a venda é estornada do mesmo jeito
    });

    it('PERDA com o pedido já pronto ou em rota: baixa (a comida foi feita)', async () => {
      const l = await loja();
      const p = await aceito(l);
      await q(`update pedido_externo set status = 'despachado' where id = $1`, [p.id]); // card ainda "recebido": vale o pedido
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe(UM_ITEM);
      expect(await saldo(l)).toBe(99);
    });

    it('PERDA PARCIAL: só os itens marcados saem — e na quantidade marcada', async () => {
      const l = await loja();
      const p = await aceito(l, {
        itens: [
          { codigo: 'XT1', descricao: 'Lanche de teste', quantidade: 2 },
          { codigo: 'XT2', descricao: 'Porção de teste', quantidade: 1 },
        ],
      });
      await avancarCard(l, p.card);
      const [lanche, porcao] = await itensDaVenda(p.comandaId);
      expect([lanche.descricao, porcao.descricao]).toEqual(['Lanche de teste', 'Porção de teste']);
      // A porção não se perdeu (desmarcada) e só 1 dos 2 lanches.
      const r = await cancelarNoPainel(l, p.id, false, [{ comandaItemId: lanche.id, quantidade: 1 }]);
      expect(r.estoqueAviso).toBe(UM_ITEM);
      expect(await saldo(l)).toBe(99); // 1 pão, não 3
      expect(await desperdicios(l)).toEqual([expect.objectContaining({ descricao: expect.stringMatching(/ · 1× Lanche de teste$/), quantidade: 1 })]);
      // Em Estoque › Desperdício a linha diz que baixou do estoque (sem `item_id`: quem diz é o movimento dela).
      const lista: any[] = await new DesperdicioService(db).findAll({ tenantId: l.t, categoria: 'gerente' } as any);
      expect(lista).toEqual([expect.objectContaining({ motivo: 'Cancelamento', itemId: null, baixouEstoque: true })]);
      // Registrar de novo não registra duas vezes (o id da perda é tirado do item).
      await vendas.registrarPerda(l.t, p.comandaId, [{ comandaItemId: lanche.id, quantidade: 1 }], { venda: SO_INGREDIENTES, atorId: null, rotulo: 'x' });
      expect(await saldo(l)).toBe(99);
      expect(await desperdicios(l)).toHaveLength(1);
    });

    it('PERDA com nenhum item marcado: o estoque não muda — e item que não é do pedido = 400, sem cancelar nada', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card);
      await expect(cancelarNoPainel(l, p.id, false, [{ comandaItemId: randomUUID() }])).rejects.toThrow(/não é desta venda/);
      expect(await pedido(p.id)).toMatchObject({ status: 'confirmado' }); // nada mudou: a lista é conferida antes
      expect(await comanda(p.comandaId)).toMatchObject({ status: 'fechada' });
      const r = await cancelarNoPainel(l, p.id, false, []);
      expect(r.estoqueAviso).toBe('Nenhum item marcado como perdido: o estoque não mudou.');
      expect(await saldo(l)).toBe(100);
      expect(await desperdicios(l)).toEqual([]);
    });

    it('PERDA do pedido concluído que voltou: a venda volta ao estoque e só o perdido sai, como desperdício', async () => {
      const l = await loja();
      const p = await aceito(l);
      await vendas.baixarEstoqueExterno(l.t, p.comandaId); // a baixa da conclusão (como venda)
      await q(`update pedido_externo set status = 'despachado' where id = $1`, [p.id]); // "Voltar" do concluído
      const [lanche] = await itensDaVenda(p.comandaId);
      await cancelarNoPainel(l, p.id, false, [{ comandaItemId: lanche.id }]);
      expect(await saldo(l)).toBe(99); // não 98: a saída de venda voltou, a de desperdício entrou
      expect(await desperdicios(l)).toHaveLength(1);
    });

    it('PERDA com a cozinha sem ter começado: nada é baixado, e a resposta diz isso', async () => {
      const l = await loja();
      const p = await aceito(l); // card em "recebido"
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe('A cozinha ainda não tinha começado este pedido: nada foi baixado do estoque.');
      expect(await saldo(l)).toBe(100);
      expect(await q(`select 1 from movimento_estoque where tenant_id = $1 and ref_id = $2`, [l.t, p.comandaId])).toEqual([]);
    });

    it('PERDA em loja sem card de cozinha: o aceite é o início da produção — baixa', async () => {
      const l = await loja();
      const p = await aceito(l);
      await q(`delete from producao_pedido where comanda_id = $1`, [p.comandaId]);
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe(UM_ITEM);
      expect(await saldo(l)).toBe(99);
    });

    it('embalagem (custo só de delivery): sai na perda do pedido que já saiu da cozinha; em preparo, só o insumo da receita', async () => {
      const l = await loja();
      const marmita = { codigo: 'XT3', descricao: 'Marmita de teste' };
      const emPreparo = await aceito(l, marmita);
      await avancarCard(l, emPreparo.card);
      await cancelarNoPainel(l, emPreparo.id, false);
      expect(await saldo(l)).toBe(99); // o pão da receita
      expect(await saldoDe(l, l.emb)).toBe(50); // a embalagem nem foi usada
      const jaPronto = await aceito(l, marmita);
      await q(`update pedido_externo set status = 'pronto' where id = $1`, [jaPronto.id]);
      await cancelarNoPainel(l, jaPronto.id, false);
      expect(await saldo(l)).toBe(98);
      expect(await saldoDe(l, l.emb)).toBe(49); // embalado e perdido
    });

    it('REAPROVEITADO em produção: nada sai, e a resposta não diz que "devolveu"', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card);
      const r = await cancelarNoPainel(l, p.id, true);
      expect(r.estoqueAviso).toBe('Nenhum insumo tinha saído do estoque por este pedido: o estoque não mudou.');
      expect(await saldo(l)).toBe(100);
    });

    it('REAPROVEITADO com a baixa já feita (pedido concluído que voltou): o insumo volta ao estoque', async () => {
      const l = await loja();
      const p = await aceito(l);
      await vendas.baixarEstoqueExterno(l.t, p.comandaId); // a baixa da conclusão
      await q(`update pedido_externo set status = 'despachado' where id = $1`, [p.id]); // "Voltar" do concluído
      expect(await saldo(l)).toBe(99);
      const r = await cancelarNoPainel(l, p.id, true);
      expect(r.estoqueAviso).toBe('Os insumos deste pedido foram devolvidos ao estoque (reutilizados).');
      expect(await saldo(l)).toBe(100);
    });

    it('pedido que nunca foi aceito: cancela sem falar de estoque', async () => {
      const l = await loja();
      const p = await chegou(l);
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBeNull();
      expect(await saldo(l)).toBe(100);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Dono, 28/10/2026: quando quem cancela não é a loja (o canal, o cliente, o sistema), ninguém diz na hora o que se perdeu.
  describe('"Registrar perda" depois do cancelamento que não foi da loja', () => {
    it('o canal cancelou: a loja marca o que se perdeu e sai do estoque como desperdício — uma vez só', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', estoque_reaproveitado: null }); // ninguém decidiu
      expect(await saldo(l)).toBe(100);
      const [lanche] = await itensDaVenda(p.comandaId);

      await expect(delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', p.id, [{ comandaItemId: lanche.id }], 'errada')).rejects.toThrow(/Senha de gestor inválida/);
      expect(await pedido(p.id)).toMatchObject({ estoque_reaproveitado: null }); // a senha errada não decide nada

      // Com a auditoria, como no sistema (o `delivery` desta spec nasce sem ela).
      const comAuditoria = new DeliveryService(
        db, vendas, producao, beneficio('cashback'), beneficio('fidelidade'), eventos, { flashPedidos: () => undefined } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
      );
      const r: any = await comAuditoria.registrarPerdaDepois(l.t, l.gestor, 'gerente', p.id, [{ comandaItemId: lanche.id }], SENHA_GESTOR);
      expect(r).toMatchObject({ ok: true, itens: 1, custo: 2, aviso: '1 item lançado como PERDA em Estoque › Desperdício.' });
      expect(await saldo(l)).toBe(99);
      expect(await pedido(p.id)).toMatchObject({ estoque_reaproveitado: false });
      expect(await desperdicios(l)).toHaveLength(1);
      expect(auditado).toEqual(expect.arrayContaining([expect.objectContaining({ acao: 'registrou_perda_do_cancelado', entidadeId: p.id })]));
      // De novo: já decidido.
      await expect(delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', p.id, [{ comandaItemId: lanche.id }], SENHA_GESTOR)).rejects.toThrow(/já foi decidido/);
      expect(await saldo(l)).toBe(99);
    });

    it('duas telas registram juntas: entra uma; a outra ouve que já foi registrada', async () => {
      const l = await loja();
      const p = await aceito(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      const [lanche] = await itensDaVenda(p.comandaId);
      const rs = await Promise.allSettled([1, 2].map(() => delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', p.id, [{ comandaItemId: lanche.id }], SENHA_GESTOR)));
      expect(rs.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(String((rs.find((x) => x.status === 'rejected') as any).reason?.message)).toMatch(/acabou de ser registrada|já foi decidido/);
      expect(await saldo(l)).toBe(99);
    });

    it('só pedido cancelado, com venda e sem decisão: o cancelado no painel já decidiu', async () => {
      const l = await loja();
      const ativo = await aceito(l);
      await expect(delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', ativo.id, [], SENHA_GESTOR)).rejects.toThrow(/Só pedido cancelado/);
      await cancelarNoPainel(l, ativo.id, true);
      await expect(delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', ativo.id, [], SENHA_GESTOR)).rejects.toThrow(/já foi decidido/);
      const semVenda = await chegou(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', semVenda.externalId, 'cancelado');
      await expect(delivery.registrarPerdaDepois(l.t, l.gestor, 'gerente', semVenda.id, [], SENHA_GESTOR)).rejects.toThrow(/não chegou a virar venda/);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // A venda do BALCÃO (Cupons / Buscar cupom): baixou o estoque na venda; cancelada, o que se perdeu sai como desperdício.
  describe('balcão: perda parcial na venda cancelada', () => {
    /** Venda do balcão já fechada: 2 lanches e 1 porção (1 pão cada, revenda), 3 pães baixados como venda, caixa aberto. */
    async function vendaDoBalcao(l: Loja) {
      await q(`insert into caixa_sessao (tenant_id, unidade_id, origem, status, valor_abertura, aberta_por_id) values ($1,$2,'pdv','aberta',0,$3)`, [l.t, l.u, l.gestor]);
      const c = (await q(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo, total, forma) values ($1,$2,'fechada',7,'B',60,'dinheiro') returning id`, [l.t, l.u]))[0].id as string;
      for (const [produtoId, descricao, qtd] of [[l.produtoId, 'Lanche de teste', 2], [l.extraId, 'Porção de teste', 1]] as const)
        await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1,$2,$3,$4,$5,20)`, [l.t, c, produtoId, descricao, qtd]);
      await q(`insert into lancamento_caixa (tenant_id, unidade_id, comanda_id, tipo, valor, data, categoria, forma) values ($1,$2,$3,'entrada',60,current_date,'venda','dinheiro')`, [l.t, l.u, c]);
      await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, motivo, ref_tipo, ref_id) values ($1,$2,'saida',3,'venda','venda',$3)`, [l.t, l.item, c]);
      const [lanche, porcao] = await itensDaVenda(c);
      return { comandaId: c, lanche, porcao };
    }
    const cancelarNoBalcao = (l: Loja, comandaId: string, dto: any) => vendas.cancelar(l.t, l.gestor, 'gerente', comandaId, { motivo: 'Desistiu', ...dto }, null) as Promise<any>;

    it('perda de 1 lanche: a venda volta inteira e só o lanche perdido sai, como desperdício', async () => {
      const l = await loja();
      const v = await vendaDoBalcao(l);
      expect(await saldo(l)).toBe(97);
      const r = await cancelarNoBalcao(l, v.comandaId, { reaproveitado: false, perdaItens: [{ comandaItemId: v.lanche.id, quantidade: 1 }] });
      expect(r.estoqueAviso).toBe('1 item lançado como PERDA em Estoque › Desperdício: os insumos saíram do estoque.');
      expect(r.perda).toEqual({ itens: 1, custo: 2 });
      expect(await saldo(l)).toBe(99); // os 3 da venda voltaram; 1 saiu como desperdício
      expect(await desperdicios(l)).toEqual([expect.objectContaining({ descricao: 'Cancelamento · Senha B-7 · 1× Lanche de teste', motivo: 'Cancelamento', quantidade: 1 })]);
      expect(await comanda(v.comandaId)).toMatchObject({ status: 'cancelada', estoque_reaproveitado: false });
    });

    it('reutilizado (o de sempre): tudo volta; perda sem a lista: a venda inteira', async () => {
      const l = await loja();
      const a = await vendaDoBalcao(l);
      const r = await cancelarNoBalcao(l, a.comandaId, {});
      expect(r.estoqueAviso).toBe('Os insumos desta venda voltaram ao estoque (reutilizados).');
      expect(await saldo(l)).toBe(100);
      expect(await desperdicios(l)).toEqual([]);
      await q(`update caixa_sessao set status = 'fechada' where tenant_id = $1`, [l.t]);
      const b = await vendaDoBalcao(l);
      await cancelarNoBalcao(l, b.comandaId, { reaproveitado: false });
      expect(await saldo(l)).toBe(97); // os 3 pães se perderam
      expect(await desperdicios(l)).toHaveLength(2);
    });

    it('item que não é da venda: 400 e nada muda (nem estoque, nem caixa, nem a venda)', async () => {
      const l = await loja();
      const v = await vendaDoBalcao(l);
      await expect(cancelarNoBalcao(l, v.comandaId, { reaproveitado: false, perdaItens: [{ comandaItemId: randomUUID() }] })).rejects.toThrow(/não é desta venda/);
      expect(await comanda(v.comandaId)).toMatchObject({ status: 'fechada' });
      expect(await saldo(l)).toBe(97);
      expect((await lancamentos(v.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(0);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Auditoria do KDS (11/11/2026): a loja finaliza a RETIRADA no painel do canal (Anota Aí check 3) e não no balcão do
  // Regem — o pedido ficava "pronto" para sempre, com o cartão aberto e o estoque sem baixar (610 em 60 dias).
  describe('Retirada finalizada pelo canal', () => {
    const cartoesDe = async (comandaId: string) => (await cards(comandaId)).map((c) => c.status);
    const fechouNaCozinha = () =>
      emitidos.filter((e) => e.nome === 'producao.evento' && e.dado?.tipo === 'status' && e.dado?.status === 'entregue').length;

    it('JÁ PAGA: conclui de verdade — baixa o estoque e o cartão fecha', async () => {
      const l = await loja();
      const p = await aceito(l, { canal: 'anotaai', tipo: 'retirada' });
      expect(await delivery.refletirStatusExterno(l.t, 'anotaai', p.externalId, 'concluido')).toBe('aplicado');
      expect((await pedido(p.id)).status).toBe('concluido');
      expect(await cartoesDe(p.comandaId)).toEqual(['entregue']);
      expect(await saldo(l)).toBe(99);
    });

    it('A PAGAR NA RETIRADA: segue "pronto" para o balcão cobrar, mas o cartão sai da cozinha — uma vez só', async () => {
      const l = await loja();
      const p = await aceito(l, { canal: 'anotaai', tipo: 'retirada' });
      await q(`update pedido_externo set pago = false, status_pagamento = 'na_entrega' where id = $1`, [p.id]);
      // "Prontos para entrega" da Anota (check 2): na retirada vira pronto; a cozinha ainda pode estar no balcão.
      expect(await delivery.refletirStatusExterno(l.t, 'anotaai', p.externalId, 'despachado')).toBe('aplicado');
      expect(await cartoesDe(p.comandaId)).toEqual(['recebido']);
      // Finalizado (check 3): o cliente levou. Nada de dinheiro lançado: o pedido segue pronto no balcão.
      await delivery.refletirStatusExterno(l.t, 'anotaai', p.externalId, 'concluido');
      expect((await pedido(p.id)).status).toBe('pronto');
      expect(await cartoesDe(p.comandaId)).toEqual(['entregue']);
      expect(fechouNaCozinha()).toBe(1);
      expect(await saldo(l)).toBe(100); // a baixa é na conclusão (o "Cobrar e entregar" do balcão)
      // A Anota repete o check 3 a cada leitura: nada muda de novo.
      emitidos.length = 0;
      expect(await delivery.refletirStatusExterno(l.t, 'anotaai', p.externalId, 'concluido')).toBe('ignorado');
      expect(fechouNaCozinha()).toBe(0);
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(0);
    });

    it('o delivery (não retirada) e o cancelado não mudam', async () => {
      const l = await loja();
      const entrega = await aceito(l, { canal: 'anotaai', tipo: 'delivery' });
      await q(`update pedido_externo set pago = false, status_pagamento = 'na_entrega' where id = $1`, [entrega.id]);
      await delivery.refletirStatusExterno(l.t, 'anotaai', entrega.externalId, 'concluido');
      expect((await pedido(entrega.id)).status).toBe('concluido'); // como sempre: o entregador recebeu
      const cancelada = await aceito(l, { canal: 'anotaai', tipo: 'retirada' });
      await q(`update pedido_externo set pago = false, status_pagamento = 'na_entrega' where id = $1`, [cancelada.id]);
      await delivery.refletirStatusExterno(l.t, 'anotaai', cancelada.externalId, 'cancelado');
      await delivery.refletirStatusExterno(l.t, 'anotaai', cancelada.externalId, 'concluido');
      expect(await cartoesDe(cancelada.comandaId)).toEqual(['cancelado']); // o finalizado tardio não "entrega" o cancelado
    });

    it('fechar os cartões entregues mexe só nos abertos (o cancelado e o já entregue ficam como estão)', async () => {
      const l = await loja();
      const p = await aceito(l, { canal: 'anotaai', tipo: 'retirada' });
      await q(`update producao_pedido set status = 'cancelado' where comanda_id = $1`, [p.comandaId]);
      expect(await producao.fecharCartoesEntregues(l.t, p.comandaId)).toBe(0);
      expect(await cartoesDe(p.comandaId)).toEqual(['cancelado']);
      const outro = await aceito(l, { canal: 'anotaai', tipo: 'retirada' });
      expect(await producao.fecharCartoesEntregues(l.t, outro.comandaId)).toBe(1);
      expect(await producao.fecharCartoesEntregues(l.t, outro.comandaId)).toBe(0);
      expect(await cartoesDe(outro.comandaId)).toEqual(['entregue']);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // Auditoria do KDS (11/11/2026, onda 1, PR 2b): o aceite e o avanço do pedido.
  describe('Aceite e avanço do pedido: pagamento pendente e corridas', () => {
    const vendasDaLoja = async (l: Loja) => Number((await q(`select count(*)::int as n from comanda where tenant_id = $1`, [l.t]))[0].n);

    it('dois aceites ao mesmo tempo: UMA venda, UM cartão na cozinha', async () => {
      const l = await loja();
      const p = await chegou(l);
      const r = await Promise.allSettled([delivery.aceitar(l.t, l.gestor, p.id), delivery.aceitar(l.t, l.gestor, p.id)]);
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      expect(String((r.find((x) => x.status === 'rejected') as any)?.reason?.message)).toMatch(/já foi aceito/);
      expect(await vendasDaLoja(l)).toBe(1);
      const ped = await pedido(p.id);
      expect(ped.status).toBe('confirmado');
      expect((await cards(ped.comanda_id)).length).toBe(1);
    });

    it('Pix/cartão online ainda não pago não vai à cozinha (nem pelo botão); depois de pago, vai', async () => {
      const l = await loja();
      const p = await chegou(l, { canal: 'cardapio' });
      await q(`update pedido_externo set pago = false, status_pagamento = 'aguardando' where id = $1`, [p.id]);
      await expect(delivery.aceitar(l.t, l.gestor, p.id)).rejects.toThrow(/espera o pagamento online/);
      expect(await pedido(p.id)).toMatchObject({ status: 'novo', comanda_id: null });
      expect(await vendasDaLoja(l)).toBe(0);
      await q(`update pedido_externo set pago = true, status_pagamento = 'aprovado' where id = $1`, [p.id]);
      await delivery.aceitar(l.t, l.gestor, p.id);
      expect((await pedido(p.id)).status).toBe('confirmado');
    });

    it('a venda que falha devolve a reserva: o pedido segue "novo" e aceitável', async () => {
      const l = await loja();
      const p = await chegou(l);
      const original = vendas.venderExterno;
      (vendas as any).venderExterno = async () => {
        throw new Error('falha de teste na venda');
      };
      try {
        await expect(delivery.aceitar(l.t, l.gestor, p.id)).rejects.toThrow('falha de teste na venda');
      } finally {
        (vendas as any).venderExterno = original;
      }
      expect(await pedido(p.id)).toMatchObject({ status: 'novo', comanda_id: null });
      await delivery.aceitar(l.t, l.gestor, p.id);
      expect((await pedido(p.id)).status).toBe('confirmado');
    });

    it('o canal cancela enquanto o pedido é aceito: a venda que acabou de nascer é desfeita', async () => {
      const l = await loja();
      const p = await chegou(l);
      const original = vendas.venderExterno;
      (vendas as any).venderExterno = async (...a: any[]) => {
        const v = await original.apply(vendas, a as any);
        await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado'); // chega no meio do aceite
        return v;
      };
      let comandaDaVenda: string | null = null;
      try {
        await expect(delivery.aceitar(l.t, l.gestor, p.id)).rejects.toThrow(/cancelado enquanto era aceito/);
        comandaDaVenda = (await q(`select id from comanda where tenant_id = $1`, [l.t]))[0]?.id ?? null;
      } finally {
        (vendas as any).venderExterno = original;
      }
      expect((await pedido(p.id)).status).toBe('cancelado');
      expect(comandaDaVenda).not.toBeNull();
      expect((await comanda(comandaDaVenda as string)).status).toBe('cancelada');
      expect((await cards(comandaDaVenda as string)).map((c) => c.status)).toEqual(['cancelado']);
    });

    it('aceite automático da ENTRADA: o pedido com Pix pendente espera (sem marcar "falhou"); o de pagar na entrega entra', async () => {
      const l = await loja();
      await q(`insert into delivery_config (tenant_id, unidade_id, auto_aceitar) values ($1,$2,true)`, [l.t, l.u]);
      const bruto = (cliente: string) => ({
        cliente,
        clienteTelefone: '5521900000000',
        tipo: 'retirada',
        formaPagamento: 'pix',
        total: 20,
        itens: [{ codigo: 'XT1', descricao: 'Lanche de teste', quantidade: 1, precoUnitario: 20 }],
      });
      const esperando: any = await delivery.ingest(l.t, l.u, 'cardapio', bruto('Cliente Pix'), { statusPagamento: 'aguardando', repetidoConferido: true } as any);
      expect((await q(`select status, comanda_id, auto_aceite_falhou from pedido_externo where id = $1`, [esperando.id]))[0]).toMatchObject({
        status: 'novo',
        comanda_id: null,
        auto_aceite_falhou: false,
      });
      const naEntrega: any = await delivery.ingest(l.t, l.u, 'cardapio', bruto('Cliente dinheiro'), { statusPagamento: 'na_entrega', repetidoConferido: true } as any);
      expect((await pedido(naEntrega.id)).status).toBe('confirmado');
      await q(`delete from delivery_config where tenant_id = $1`, [l.t]);
    });

    // ERR-463: o segundo "pronto" que chegava DEPOIS de o primeiro gravar relia "pronto" e avançava para "despachado"
    // (avisando o canal que saiu). Com a etapa vista (`de`), o segundo devolve o pedido sem mexer.
    it('dois "pronto" ao mesmo tempo no delivery: o pedido fica pronto (não pula para despachado)', async () => {
      const l = await loja();
      const p = await aceito(l);
      const r = await Promise.allSettled([
        delivery.avancar(l.t, p.id, { de: 'confirmado' }),
        delivery.avancar(l.t, p.id, { de: 'confirmado' }),
      ]);
      expect(r.map((x) => x.status)).toEqual(['fulfilled', 'fulfilled']);
      expect((await pedido(p.id)).status).toBe('pronto');
    });

    it('o segundo "pronto" que chega depois do primeiro não leva o pedido adiante', async () => {
      const l = await loja();
      const p = await aceito(l);
      await delivery.avancar(l.t, p.id, { de: 'confirmado' });
      const segundo: any = await delivery.avancar(l.t, p.id, { de: 'confirmado' });
      expect(segundo.status).toBe('pronto');
      expect((await pedido(p.id)).status).toBe('pronto');
    });

    it('perdeu a gravação para outro "pronto" (leu "confirmado", o banco já estava "pronto"): devolve o pedido sem erro', async () => {
      const l = await loja();
      const p = await aceito(l);
      const real = (delivery as any).carregar.bind(delivery);
      const lido = await real(l.t, p.id); // a leitura de ANTES do outro gravar
      await delivery.avancar(l.t, p.id, { de: 'confirmado' }); // o outro "pronto" grava
      const espiao = jest.spyOn(delivery as any, 'carregar').mockImplementationOnce(async () => lido);
      try {
        const r: any = await delivery.avancar(l.t, p.id, { de: 'confirmado' });
        expect(r.status).toBe('pronto');
      } finally {
        espiao.mockRestore();
      }
      expect((await pedido(p.id)).status).toBe('pronto');
    });

    it('a etapa vista que não é a do pedido (nem a seguinte) é recusada; sem ela, avança um passo como antes', async () => {
      const l = await loja();
      const p = await aceito(l);
      await expect(delivery.avancar(l.t, p.id, { de: 'pronto' })).rejects.toThrow(/mudou de etapa/);
      expect((await pedido(p.id)).status).toBe('confirmado');
      await delivery.avancar(l.t, p.id);
      await delivery.avancar(l.t, p.id);
      expect((await pedido(p.id)).status).toBe('despachado');
    });

    // Auditoria do KDS (11/11/2026, O7; regra do ERR-257): o item do canal sem cadastro ficava fora do cartão da cozinha.
    it('item do canal sem produto no cadastro vai para o cartão da cozinha, com o nome que o canal mandou', async () => {
      const l = await loja();
      const p = await aceito(l, {
        itens: [
          { codigo: 'XT1', descricao: 'Lanche de teste', quantidade: 1 },
          { codigo: 'SEM-CADASTRO-99', descricao: 'Guaraviton 500 ml', quantidade: 2 },
        ],
      });
      const itens = await q(
        `select i.descricao, i.quantidade::float as q from producao_pedido_item i
           join producao_pedido c on c.id = i.pedido_id where c.comanda_id = $1 order by i.descricao`,
        [p.comandaId],
      );
      expect(itens).toEqual([
        { descricao: 'Guaraviton 500 ml', q: 2 },
        { descricao: 'Lanche de teste', q: 1 },
      ]);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════════════════════
  // O3 (auditoria do KDS, 11/11/2026): o canal cancelou NA NUVEM (lá sem venda) e o servidor da loja, que ainda não sabia,
  // aceitou: venda, lançamento e cartão na cozinha DELE. O sincronismo faz o cancelamento descer (mesmo mais velho) e guarda
  // o vínculo com a venda daqui; o `EdgePedidosProcessor` desfaz pelo mesmo serviço do cancelamento pelo canal.
  describe('O3 · o canal cancelou na nuvem e o servidor da loja já tinha aceitado', () => {
    const unidadeOriginal = process.env.EDGE_UNIDADE_ID;
    /** O pull trouxe o cancelamento: 'cancelado', com a venda daqui ainda ligada (o daemon guarda o vínculo). Da nuvem
     *  que nunca viu o aceite vem sem `confirmado_em`. */
    const desceuCancelado = (id: string, o: { nuvemViuOAceite: boolean; ha: string }) =>
      q(
        `update pedido_externo set status = 'cancelado', cancelado_em = now() - $2::interval, motivo_cancelamento = 'Cancelado pelo ifood'
           ${o.nuvemViuOAceite ? '' : ', confirmado_em = null'} where id = $1`,
        [id, o.ha],
      );
    /** O servidor da loja, só desta loja (o banco do CI é compartilhado entre as specs). */
    async function noServidorDaLoja<R>(l: Loja, fn: (proc: EdgePedidosProcessor) => Promise<R>) {
      process.env.EDGE_MODE = 'true';
      process.env.EDGE_UNIDADE_ID = l.u;
      try {
        return await fn(new EdgePedidosProcessor(db, delivery));
      } finally {
        delete process.env.EDGE_MODE; // o resto do arquivo roda como NUVEM
        if (unidadeOriginal === undefined) delete process.env.EDGE_UNIDADE_ID;
        else process.env.EDGE_UNIDADE_ID = unidadeOriginal;
      }
    }
    const estornos = async (comandaId: string) => (await lancamentos(comandaId)).filter((x) => x.categoria === 'estorno');

    it('a nuvem nunca viu o aceite: desfaz na hora — venda estornada, comanda e cartão cancelados com o alerta, cashback e pontos de volta; e uma vez só', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card); // a cozinha já começou
      emitidos.length = 0;
      await desceuCancelado(p.id, { nuvemViuOAceite: false, ha: '20 seconds' });

      await noServidorDaLoja(l, (proc) => proc.processar());

      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', comanda_id: p.comandaId });
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
      expect(await estornos(p.comandaId)).toEqual([expect.objectContaining({ tipo: 'saida', valor: 20 })]);
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
      expect(cancelouNaCozinha()).toBe(1); // o KDS recebe o alerta de cancelado
      expect(auditado.filter((a) => a.acao === 'cancelou_delivery')).toEqual([
        expect.objectContaining({ tenantId: l.t, atorPerfil: 'servico', entidadeId: p.comandaId }),
      ]);
      expect(estornados.map((e) => e.servico).sort()).toEqual(['cashback', 'fidelidade']); // o crédito do aceite daqui volta
      expect(emitidos.filter((e) => e.nome === 'pedido.cancelado')).toHaveLength(1);
      await expect(avancarCard(l, p.card)).rejects.toThrow('Pedido cancelado não avança.');
      // Outro ciclo: nada repete.
      await noServidorDaLoja(l, (proc) => proc.processar());
      expect(await estornos(p.comandaId)).toHaveLength(1);
      expect(auditado.filter((a) => a.acao === 'cancelou_delivery')).toHaveLength(1);
    });

    it('a nuvem conhecia a venda: espera 3 min (ela mesma desfaz — o estorno não sai em dobro); o que continua de pé depois disso é desfeito aqui', async () => {
      const l = await loja();
      const p = await aceito(l);
      await desceuCancelado(p.id, { nuvemViuOAceite: true, ha: '30 seconds' });
      await noServidorDaLoja(l, (proc) => proc.processar());
      expect((await comanda(p.comandaId)).status).toBe('fechada');
      expect(await estornos(p.comandaId)).toHaveLength(0);
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['recebido']);

      await q(`update pedido_externo set cancelado_em = now() - interval '4 minutes' where id = $1`, [p.id]);
      await noServidorDaLoja(l, (proc) => proc.processar());
      expect((await comanda(p.comandaId)).status).toBe('cancelada');
      expect(await estornos(p.comandaId)).toHaveLength(1);
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['cancelado']);
    });

    it('fora do alcance: pedido de outra loja da empresa, cancelado há mais de 2 dias ou de balcão — nada muda', async () => {
      const l = await loja();
      const filial = (await q(`insert into unidade (tenant_id, nome) values ($1,'Filial') returning id`, [l.t]))[0].id as string;
      const daFilial = await aceito({ ...l, u: filial });
      await desceuCancelado(daFilial.id, { nuvemViuOAceite: false, ha: '20 seconds' });
      const antigo = await aceito(l);
      await desceuCancelado(antigo.id, { nuvemViuOAceite: false, ha: '3 days' });
      const balcao = await aceito(l);
      await desceuCancelado(balcao.id, { nuvemViuOAceite: false, ha: '20 seconds' });
      await q(`update pedido_externo set canal = 'balcao' where id = $1`, [balcao.id]);

      await noServidorDaLoja(l, (proc) => proc.processar());

      for (const x of [daFilial, antigo, balcao]) {
        expect((await comanda(x.comandaId)).status).toBe('fechada');
        expect(await estornos(x.comandaId)).toHaveLength(0);
      }
    });

    it('V84: 25 que esperam a nuvem e 25 já desfeitos NA FRENTE da fila não seguram o que precisa ser desfeito agora', async () => {
      const l = await loja();
      const lote = (statusDaComanda: string, nuvemViuOAceite: boolean, ha: string) =>
        q(
          `with c as (insert into comanda (tenant_id, unidade_id, status, total)
                      select $1, $2, $3, 20 from generate_series(1, 25) returning id)
           insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, comanda_id, cancelado_em, confirmado_em)
           select $1, $2, 'ifood', gen_random_uuid()::text, 'cancelado', c.id, now() - $4::interval,
                  case when $5::boolean then now() - interval '1 hour' end
             from c`,
          [l.t, l.u, statusDaComanda, ha, nuvemViuOAceite],
        );
      await lote('cancelada', false, '2 minutes'); // a venda já foi desfeita
      await lote('fechada', true, '90 seconds'); // a nuvem conhecia a venda: espera por ela
      const p = await aceito(l);
      await desceuCancelado(p.id, { nuvemViuOAceite: false, ha: '20 seconds' }); // o mais novo: o último da fila

      await noServidorDaLoja(l, (proc) => proc.processar());

      expect((await comanda(p.comandaId)).status).toBe('cancelada');
      // Os que esperam a nuvem continuam de pé.
      expect(Number((await q(`select count(*) n from comanda where tenant_id = $1 and status = 'fechada'`, [l.t]))[0].n)).toBe(25);
    });

    it('a venda que não se desfez (erro do banco) sai da frente por 10 min, sem travar as outras; depois tenta de novo', async () => {
      const l = await loja();
      const falha = await aceito(l);
      const ok = await aceito(l);
      await desceuCancelado(falha.id, { nuvemViuOAceite: false, ha: '40 seconds' }); // o mais antigo: o primeiro da fila
      await desceuCancelado(ok.id, { nuvemViuOAceite: false, ha: '20 seconds' });
      const espiao = jest.spyOn(vendas, 'estornarVendaExterna').mockRejectedValueOnce(new Error('conexão perdida (simulada)'));
      try {
        await noServidorDaLoja(l, async (proc) => {
          await proc.processar();
          expect((await comanda(falha.comandaId)).status).toBe('fechada');
          expect((await comanda(ok.comandaId)).status).toBe('cancelada');
          // Cashback e pontos só voltam com a venda desfeita.
          expect(estornados.filter((e) => e.pedidoId === falha.id)).toHaveLength(0);
          expect(estornados.filter((e) => e.pedidoId === ok.id)).toHaveLength(2);
          await proc.processar(); // dentro dos 10 min: não tenta de novo
          expect(espiao).toHaveBeenCalledTimes(2);
          expect((await comanda(falha.comandaId)).status).toBe('fechada');
          (proc as any).canceladoFalhouAte.set(falha.id, Date.now() - 1); // passaram os 10 min
          await proc.processar();
          expect((await comanda(falha.comandaId)).status).toBe('cancelada');
          expect(await estornos(falha.comandaId)).toHaveLength(1);
          expect(estornados.filter((e) => e.pedidoId === falha.id)).toHaveLength(2);
        });
      } finally {
        espiao.mockRestore();
      }
    });
  });
});
