import { randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';

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
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'produto', 'ficha_ingrediente', 'ficha_tecnica', 'item_estoque', 'colaborador', 'funcao', 'unidade'])
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
  type Opcoes = { canal?: string; tipo?: string; codigo?: string; descricao?: string };

  /** Pedido que chegou do canal, ainda não aceito. */
  async function chegou(l: Loja, o: Opcoes = {}) {
    senha++;
    const externalId = randomUUID();
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, cliente_telefone,
         tipo, itens, total, forma_pagamento, status, pago)
       values ($1,$2,$3,$4,$5,'Cliente de teste','5500000000000',$6,$7::jsonb,'20.00','online','novo',true) returning id`,
      [l.t, l.u, o.canal ?? 'ifood', externalId, String(senha), o.tipo ?? 'delivery',
       JSON.stringify([{ codigo: o.codigo ?? 'XT1', descricao: o.descricao ?? 'Lanche de teste', quantidade: 1, precoUnitario: 20 }])],
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
  const cancelarNoPainel = (l: Loja, id: string, reaproveitado: boolean) =>
    delivery.cancelar(l.t, l.gestor, 'gerente', id, 'Cliente desistiu', SENHA_GESTOR, reaproveitado) as Promise<any>;

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
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['recebido']);
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(0);
    });

    it('pedido ainda não aceito (sem venda): só o pedido é cancelado, sem erro', async () => {
      const l = await loja();
      const p = await chegou(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'cancelado');
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', comanda_id: null });
      expect(auditado).toEqual([]);
    });

    it('os outros reflexos do canal (pronto, despachado) não mexem na venda nem na cozinha', async () => {
      const l = await loja();
      const p = await aceito(l);
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'pronto');
      await delivery.refletirStatusExterno(l.t, 'ifood', p.externalId, 'despachado');
      expect((await pedido(p.id)).status).toBe('despachado');
      expect((await comanda(p.comandaId)).status).toBe('fechada');
      expect((await cards(p.comandaId)).map((c) => c.status)).toEqual(['recebido']);
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
    it('PERDA com a cozinha já em preparo: o insumo sai do estoque e fica como perda', async () => {
      const l = await loja();
      const p = await aceito(l);
      await avancarCard(l, p.card); // em preparo
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe('Os insumos deste pedido foram baixados do estoque como PERDA.');
      expect(await saldo(l)).toBe(99);
      expect(await q(`select tipo, quantidade::float as quantidade, ref_tipo from movimento_estoque where tenant_id = $1 and ref_id = $2`, [l.t, p.comandaId])).toEqual([{ tipo: 'saida', quantidade: 1, ref_tipo: 'venda' }]);
      expect(await comanda(p.comandaId)).toMatchObject({ status: 'cancelada', estoque_reaproveitado: false });
      expect(await pedido(p.id)).toMatchObject({ status: 'cancelado', estoque_reaproveitado: false });
      expect((await lancamentos(p.comandaId)).filter((x) => x.categoria === 'estorno')).toHaveLength(1); // a venda é estornada do mesmo jeito
    });

    it('PERDA com o pedido já pronto ou em rota: baixa (a comida foi feita)', async () => {
      const l = await loja();
      const p = await aceito(l);
      await q(`update pedido_externo set status = 'despachado' where id = $1`, [p.id]); // card ainda "recebido": vale o pedido
      const r = await cancelarNoPainel(l, p.id, false);
      expect(r.estoqueAviso).toBe('Os insumos deste pedido foram baixados do estoque como PERDA.');
      expect(await saldo(l)).toBe(99);
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
      expect(r.estoqueAviso).toBe('Os insumos deste pedido foram baixados do estoque como PERDA.');
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
});
