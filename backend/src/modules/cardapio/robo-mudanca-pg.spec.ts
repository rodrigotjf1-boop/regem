import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { assinarConversa } from '../../common/conversa-do-robo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CashbackService } from '../cashback/cashback.service';
import { DeliveryService } from '../delivery/delivery.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { AtendimentoService, consultaDosAvisosDoEndereco } from '../atendimento/atendimento.service';
import { sql } from 'drizzle-orm';
import { CardapioService } from './cardapio.service';
import { RoboPedidoService } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O geocodificador (Nominatim) sem rede (PR 3b-2, a distância entre os endereços): a Rua das Flores e a Rua Ipê em pontos
// conhecidos — sem OSRM_URL, a distância sai em linha reta.
const mockGeocode = jest.fn(async (q: string) =>
  /Rua Ipê/.test(q) ? { lat: -22.9, lng: -43.2 } : /Rua das Flores/.test(q) ? { lat: -22.92, lng: -43.18 } : null,
);
jest.mock('../../common/geocode', () => ({ ...jest.requireActual('../../common/geocode'), geocode: (q: string) => mockGeocode(q) }));

// O ROBÔ MUDA O PEDIDO JÁ FEITO, DE PONTA A PONTA (PR 3 do pedido alterado; mig 363) — contra Postgres (TEST_PG_URL),
// com a venda, a cozinha, o cashback e as vias de verdade (a MESMA alteração da equipe, `DeliveryService.alterar`), como
// NUVEM. O que se prova: o robô vê o pedido feito; o Regem manda a pergunta do troco e a conferência com os botões; o
// "Pode alterar" aplica com o preço do cardápio que o cliente conferiu (a promoção — V74), uma vez só e uma mudança por
// pedido; o que o robô não muda volta com o motivo e a oferta da equipe; na loja com servidor ligado vai como "pedida",
// o servidor da loja aplica com o mesmo preço e a rotina da nuvem avisa a decisão uma vez (ou chama a equipe).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-mudanca-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
// As do robô são só da nuvem: o banco do CI é o de uma loja, então o teste aplica os arquivos (ERR-273: a 363 em toda
// lista que lê o carrinho ou o ajuste do robô).
const DO_ROBO = [
  '342_robo_pausa_e_config.sql',
  '344_robo_carrinho.sql',
  '345_robo_carrinho_conducao.sql',
  '349_lembrete_do_carrinho.sql',
  '352_conferir_entrega.sql',
  '361_robo_carrinho_repetido.sql',
  '363_robo_mudanca_do_pedido.sql',
  '379_horario_da_equipe.sql', // o horário da equipe (o caso do robô fora do horário vira recado)
];
const SENHA = 'senha-do-robo-de-teste';
/** Um celular por loja: a rotina da nuvem varre TODAS as lojas — o teste só olha as mensagens do seu. */
const umCelular = () => `55219${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

descrever('o robô muda o pedido já feito (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const cashback = new CashbackService(db);
  const beneficio = () => new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new (DeliveryService as any)(
    db, vendas, producao, cashback, beneficio(), eventos, { flashPedidos: () => undefined },
    undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
  ) as DeliveryService;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), cashback, eventos, {} as any);
  // Os envios ao cliente: a Evolution (o QR — opções em menu numerado) e a API oficial (texto e botões).
  const enviados: { para: string; texto: string; opcoes?: string[] }[] = [];
  const whats = { enviar: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }) } as any;
  const oficial = {
    enviarTexto: async (_t: string, para: string, texto: string) => void enviados.push({ para, texto }),
    enviarOpcoes: async (_t: string, para: string, texto: string, ops: any[]) => void enviados.push({ para, texto, opcoes: ops.map((o) => o.titulo) }),
  } as any;
  // O chamado que a rotina abre quando a loja não responde.
  const chamados: any[] = [];
  const atendimento = { abrirPeloRobo: async (tenantId: string, unidadeId: string | null, d: any) => void chamados.push({ tenantId, unidadeId, ...d }) } as any;
  const robo = new RoboPedidoService(db, cardapio, whats, oficial, delivery, atendimento);
  // O endereço depois que o pedido saiu (PR 3b-2): o caso de verdade em `atendimento_chamado`, a ação da equipe e a rotina
  // que manda "Endereço atualizado!" — pelos mesmos envios de teste.
  const atendimentoDeVerdade = new AtendimentoService(db, eventos, delivery, auditoria, undefined, oficial, whats);
  const roboComEquipe = new RoboPedidoService(db, cardapio, whats, oficial, delivery, atendimentoDeVerdade);
  const empresas: string[] = [];
  const antes = { segredo: process.env.BOT_RESOLVER_SECRET, edge: process.env.EDGE_MODE, osrm: process.env.OSRM_URL };

  /** Uma migration numa transação só — de novo quando o DDL corre com o de outra spec no mesmo banco (ERR-194). */
  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    delete process.env.EDGE_MODE; // como NUVEM (o jest do CI roda sem EDGE_MODE — V44)
    delete process.env.OSRM_URL; // a distância do caso em linha reta (sem rede)
    for (const m of DO_ROBO) await aplicar(m);
    // "Servidor da loja ligado" (V53) e a versão dele: tabelas da nuvem (o banco do CI é de loja — V44).
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
    await repetirNaCorridaDeCatalogo(() => pool.query(`alter table edge_heartbeat add column if not exists versao text`));
    const tem = async (t: string) => (await q(`select to_regclass(current_schema() || '.' || $1) is not null as ok`, [t]))[0].ok;
    // A fila de comandos para o servidor da loja (só nuvem): a mig 124 cria, a 269 põe o destino e os dados.
    if (!(await tem('edge_comando'))) {
      await aplicar('124_edge_release_comando.sql');
      await aplicar('269_impressora_status_codepage_comando_destino.sql');
    }
    if (!(await tem('pedido_alteracao'))) await aplicar('362_pedido_alteracao.sql');
    // O índice parcial da rotina do "Endereço atualizado!" (PR 3b-2) — idempotente.
    await aplicar('364_pedido_alteracao_aviso_do_endereco.sql');
  });
  beforeEach(() => {
    enviados.length = 0;
    chamados.length = 0;
  });
  afterAll(async () => {
    if (antes.segredo === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes.segredo;
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (antes.osrm !== undefined) process.env.OSRM_URL = antes.osrm;
    if (empresas.length) {
      for (const t of ['atendimento_chamado', 'robo_carrinho', 'robo_config', 'pedido_alteracao', 'pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido',
        'cashback_movimento', 'cashback_saldo', 'cashback_plano', 'pedido_externo', 'lancamento_caixa', 'comanda', 'cliente_endereco', 'cliente',
        'cardapio_senha_seq', 'cardapio_bairro', 'cardapio_config', 'produto', 'categoria_produto', 'equipamento', 'edge_heartbeat', 'edge_comando',
        'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // ── a loja de teste: X-Bacon (R$ 32), Batata (R$ 14, em PROMOÇÃO por R$ 12 no cardápio) e Suco (R$ 7) vão para a
  //    cozinha; a Água (R$ 3) não. Impressoras da cozinha e do caixa na rede. `provedor` = a via do WhatsApp da loja.
  async function loja(provedor: 'cloud' | 'evolution' = 'cloud') {
    const t = (await q(`insert into empresa (nome) values ('teste robô muda o pedido') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [t]))[0].id as string;
    const gestor = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1,'Ana de teste',$2) returning id`, [t, funcao]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    const token = `tk-${randomUUID()}`;
    const instancia = `inst-${randomUUID().slice(0, 8)}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada, area_modo, pagamentos,
         evolution_instancia, tempo_entrega_min, provedor)
       values ($1,$2,$3,true,true,'retirada',true,true,'bairro','["pix","entrega"]'::jsonb,$4,40,$5)`,
      [t, u, token, instancia, provedor],
    );
    const prod = async (codigo: string, nome: string, preco: number, cozinha: boolean, promo: number | null = null) =>
      (await q(
        `insert into produto (tenant_id, codigo, nome, categoria_id, preco_venda, preco_promocional, vai_para_producao, controla_estoque, disponivel_cardapio)
         values ($1,$2,$3,$4,$5,$6,$7,false,true) returning id`,
        [t, codigo, nome, categoria, preco.toFixed(2), promo, cozinha],
      ))[0].id as string;
    const xbacon = await prod('XB1', 'X-Bacon de teste', 32, true);
    const batata = await prod('BT1', 'Batata de teste', 14, true, 12);
    const suco = await prod('SC1', 'Suco de teste', 7, true);
    const agua = await prod('AG1', 'Água de teste', 3, false);
    const imp = async (nome: string, cozinha: boolean) =>
      (await q(
        `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, faz_producao, faz_cupom, padrao, conexao, host)
         values ($1,$2,$3,'impressora',$4,$5,$6,$5,'rede',$7) returning id`,
        [t, u, nome, randomBytes(12).toString('hex'), cozinha, !cozinha, cozinha ? '10.0.0.21' : '10.0.0.22'],
      ))[0].id as string;
    const cozinha = await imp('Cozinha de teste', true);
    await imp('Caixa de teste', false);
    // As áreas de entrega (PR 3b): Centro R$ 6 (a do pedido) e Jardim América R$ 8.
    const bairro = async (nome: string, taxa: number) =>
      (await q(`insert into cardapio_bairro (tenant_id, unidade_id, nome, taxa) values ($1,$2,$3,$4) returning id`, [t, u, nome, taxa]))[0].id as string;
    const centro = await bairro('Centro', 6);
    const jardim = await bairro('Jardim América', 8);
    const celular = umCelular();
    const ctx = () => robo.contexto(SENHA, assinarConversa(t, celular)!, instancia);
    /** As mensagens que este cliente recebeu. */
    const doCliente = () => enviados.filter((e) => e.para === celular);
    return { t, u, gestor, xbacon, batata, suco, agua, cozinha, centro, jardim, celular, ctx, doCliente };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  /**
   * O pedido do cardápio deste celular, nº 57, aceito: X-Bacon + `suco` Sucos + R$ 6 de entrega, em dinheiro com troco
   * (ou o pagamento dado). Os itens entram na venda e o cartão vai para a cozinha (o aceite de sempre).
   */
  async function pedidoAceito(
    l: Loja,
    o: {
      sucos?: number;
      troco?: number | null;
      pagamentos?: any[];
      pagoOnline?: boolean;
      numero?: string;
      telefone?: string;
      itens?: any[];
      forma?: string;
      /** Retirada (sem endereço nem taxa) ou entrega (Rua das Flores, 120 · Centro — R$ 6 de padrão). */
      tipo?: 'entrega' | 'retirada';
      taxa?: number;
      /** Os descontos do pedido (o frete grátis vem como a linha de origem "frete"). */
      descontos?: any[];
    } = {},
  ) {
    const sucos = o.sucos ?? 1;
    const itens = o.itens ?? [
      { produtoId: l.xbacon, descricao: 'X-Bacon de teste', quantidade: 1, precoUnitario: 32, opcaoIds: [] },
      { produtoId: l.suco, descricao: 'Suco de teste', quantidade: sucos, precoUnitario: 7, opcaoIds: [] },
    ];
    const tipo = o.tipo ?? 'entrega';
    const taxa = tipo === 'retirada' ? 0 : (o.taxa ?? 6);
    const total = itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0) + taxa;
    const troco = o.troco === undefined ? 50 : o.troco;
    const ped: any = await delivery.ingest(
      l.t,
      l.u,
      'cardapio',
      {
        cliente: 'Marina de teste',
        clienteTelefone: o.telefone ?? l.celular.slice(2), // como o pedido grava (sem o 55); a conversa chega com o 55
        displayId: o.numero ?? '57',
        tipo,
        endereco: tipo === 'entrega' ? 'Rua das Flores, 120, Centro' : undefined,
        formaPagamento: o.forma ?? (o.pagamentos ? 'pix' : 'Dinheiro'),
        total,
        itens,
        valorBruto: total - taxa,
        ...(o.descontos ? { descontos: o.descontos } : {}),
        pagamentos: o.pagamentos ?? [{ rotulo: 'Dinheiro', valor: total, prepago: false, troco }],
        valorPagoCliente: total,
      } as any,
      { clientRef: randomUUID(), taxaEntrega: taxa, trocoPara: troco ?? undefined, repetidoConferido: true } as any,
    );
    if (tipo === 'entrega')
      await q(`update pedido_externo set endereco_rua = 'Rua das Flores', endereco_numero = '120', endereco_bairro = 'Centro' where id = $1`, [ped.id]);
    if (o.pagoOnline) await q(`update pedido_externo set pago_online = true, status_pagamento = 'aprovado' where id = $1`, [ped.id]);
    const r: any = await delivery.aceitar(l.t, l.gestor, ped.id);
    return { id: ped.id as string, comandaId: r.comandaId as string };
  }
  const alteracoes = (pedidoId: string) => q(`select * from pedido_alteracao where pedido_id = $1 order by created_at`, [pedidoId]);
  // Os itens da venda nascem juntos (o mesmo instante): a lista do teste vai pelo instante e pelo nome.
  const daVenda = (comandaId: string) =>
    q(`select descricao, quantidade::float8 as quantidade, preco_unitario::float8 as preco from comanda_item where comanda_id = $1 order by created_at, descricao`, [comandaId]);
  const ultimo = () => enviados[enviados.length - 1];

  it('pôr um item (loja sem servidor): a pergunta do troco, a conferência e o "Pode alterar" pela alteração da equipe, com o preço do cardápio', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const c = await l.ctx();

    // O robô vê o pedido feito, com os itens numerados e que dá para mudar.
    const v: any = await robo.ver(c);
    expect(v.pedidoFeito).toMatchObject({ numero: '57', situacao: 'em produção', podeMudar: true, total: 'R$ 45,00' });
    expect(v.pedidoFeito.itens).toEqual([
      { linha: 1, item: '1x X-Bacon de teste', valor: 'R$ 32,00' },
      { linha: 2, item: '1x Suco de teste', valor: 'R$ 7,00' },
    ]);

    // Pôr a Batata: o cardápio cobra R$ 12 (a promoção); R$ 57 passa do troco para R$ 50 → antes, a pergunta do troco.
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'batata' });
    expect(r).toMatchObject({ ok: true, feito: 'pergunta do troco da mudança enviada', proximo: { campo: 'troco_da_mudanca' } });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toEqual({
      para: l.celular,
      texto: ['Mudança no pedido nº 57', '➕ 1 Batata de teste — R$ 12,00', 'Total: R$ 45,00 → R$ 57,00', '', 'O troco para R$ 50,00 não cobre o valor novo. Vai precisar de troco para quanto?'].join('\n'),
      opcoes: ['R$ 100', 'R$ 150', 'Não preciso de troco'],
    });
    // O "Pode alterar" antes da conferência não muda nada: manda de novo o passo que falta.
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r.proximo.campo).toBe('troco_da_mudanca');
    expect(await alteracoes(p.id)).toHaveLength(0);

    // O troco pela ferramenta de sempre (definir_pagamento): vai para a mudança, não para um pedido novo.
    r = await robo.definirPagamento(c, { troco: 'R$ 100' });
    expect(r).toMatchObject({ ok: true, feito: 'conferência da mudança enviada', proximo: { campo: 'confirmar_mudanca', opcoes: ['Pode alterar', 'Mudar o troco', 'Deixar como estava'] } });
    expect(ultimo().texto).toBe(
      ['Mudança no pedido nº 57', '➕ 1 Batata de teste — R$ 12,00', 'Total: R$ 45,00 → R$ 57,00', 'Troco para R$ 100,00 (novo)', '', 'Confere a mudança 👇'].join('\n'),
    );
    expect((await q(`select itens from robo_carrinho where tenant_id = $1 and status = 'aberto'`, [l.t]))[0].itens).toEqual([]);

    // "Pode alterar": a MESMA alteração da equipe — o pedido, a venda (com o preço que o cliente conferiu), a cozinha.
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança feita no pedido' });
    expect(ultimo().texto).toBe('✅ Pronto! Pedido nº 57 alterado.\nTotal: R$ 57,00 · troco para R$ 100,00.');
    expect((await q(`select total::float8 as total, troco_para::float8 as troco, alterado from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ total: 57, troco: 100, alterado: true });
    expect(await daVenda(p.comandaId)).toEqual([
      { descricao: 'Suco de teste', quantidade: 1, preco: 7 },
      { descricao: 'X-Bacon de teste', quantidade: 1, preco: 32 },
      { descricao: 'Batata de teste', quantidade: 1, preco: 12 },
    ]);
    const [a] = await alteracoes(p.id);
    expect(a).toMatchObject({ origem: 'robo', situacao: 'aplicada', por_nome: 'Robô do WhatsApp', por_id: null, pedido_do_cliente: '➕ 1 Batata de teste — R$ 12,00' });
    const itensDoCartao = await q(
      `select i.descricao, i.status from producao_pedido_item i join producao_pedido p on p.id = i.pedido_id where p.comanda_id = $1 order by i.descricao`,
      [p.comandaId],
    );
    expect(itensDoCartao).toContainEqual({ descricao: 'Batata de teste', status: 'novo' });
    expect((await q(`select count(*)::int as n from impressao_job where comanda_id = $1 and conteudo like '%@CBD4 ALTERADO%'`, [p.comandaId]))[0].n).toBeGreaterThan(0);

    // O "Pode alterar" repetido (a IA chamou de novo) não muda outra vez nem manda outra mensagem.
    const n = enviados.length;
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, jaFeita: true });
    expect(enviados).toHaveLength(n);
    expect(await alteracoes(p.id)).toHaveLength(1);

    // Uma mudança por pedido (3A): a segunda vai para a equipe, com a pergunta antes.
    r = await robo.mexerNosItens(c, { acao: 'pedido_tirar', linha: 2 });
    expect(r).toMatchObject({ ok: false, motivo: 'ja_mudou', chamaEquipe: true, opcoes: ['Sim, quero ajuda', 'Não, obrigado'] });
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'ja_mudou' });
  });

  it('os itens do pedido feito vêm na ordem do resumo do cliente (não na do id); o pedido de OUTRO cliente nunca aparece', async () => {
    const l = await loja();
    const c = await l.ctx();
    // O pedido de outro número, na mesma loja: esta conversa não vê nem muda (a ficha assinada manda — V79).
    await pedidoAceito(l, { telefone: umCelular().slice(2), troco: 100 });
    expect(((await robo.ver(c)) as any).pedidoFeito).toBeUndefined();
    expect(await robo.mexerNosItens(c, { acao: 'pedido_tirar', linha: 1 })).toMatchObject({ ok: false, motivo: 'sem_pedido_feito' });
    // Quatro itens que nascem no mesmo instante: a numeração é a da lista do pedido (pelo id, só 1 chance em 24).
    const it4 = (produtoId: string, descricao: string, preco: number) => ({ produtoId, descricao, quantidade: 1, precoUnitario: preco, opcaoIds: [] });
    await pedidoAceito(l, {
      troco: 100,
      itens: [it4(l.suco, 'Suco de teste', 7), it4(l.xbacon, 'X-Bacon de teste', 32), it4(l.agua, 'Água de teste', 3), it4(l.batata, 'Batata de teste', 14)],
    });
    const v: any = await robo.ver(c);
    expect(v.pedidoFeito.itens.map((i: any) => `${i.linha}. ${i.item}`)).toEqual([
      '1. 1x Suco de teste',
      '2. 1x X-Bacon de teste',
      '3. 1x Água de teste',
      '4. 1x Batata de teste',
    ]);
    // E a ação usa a MESMA numeração: "tirar o 3" é a Água.
    const r: any = await robo.mexerNosItens(c, { acao: 'pedido_tirar', linha: 3 });
    expect(r.ok).toBe(true);
    expect(ultimo().texto).toContain('➖ 1 Água de teste — R$ 3,00');
  });

  it('tirar: o item pronto na cozinha fica; tirar só parte repete o item pelo preço pago; o troco que cobre continua', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { sucos: 2, troco: 100 });
    const c = await l.ctx();
    // O cartão da cozinha ficou pronto: nada dele sai por aqui.
    await q(`update producao_pedido set status = 'pronto' where comanda_id = $1`, [p.comandaId]);
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_tirar', produto: 'suco' });
    expect(r).toMatchObject({ ok: false, motivo: 'item_pronto', chamaEquipe: true });
    expect(enviados).toHaveLength(0);
    // De volta ao preparo: "tira um dos sucos" = o item fica com 1, pelo preço que o cliente já pagou.
    await q(`update producao_pedido set status = 'preparo' where comanda_id = $1`, [p.comandaId]);
    r = await robo.mexerNosItens(c, { acao: 'pedido_tirar', produto: 'suco', quantidade: 1 });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'confirmar_mudanca' } });
    expect(ultimo().texto).toBe(
      ['Mudança no pedido nº 57', '🔄 2 Suco de teste → 1 Suco de teste', 'Total: R$ 52,00 → R$ 45,00', 'Troco para R$ 100,00 (continua)', '', 'Confere a mudança 👇'].join('\n'),
    );
    // "Mudar o troco": o Regem pergunta o troco (o de agora ainda cobre — sem o "não cobre").
    r = await robo.mexerNosItens(c, { acao: 'troco_da_mudanca' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'troco_da_mudanca', opcoes: ['R$ 50', 'R$ 100', 'Não preciso de troco'] } });
    expect(ultimo().texto.endsWith('Total: R$ 52,00 → R$ 45,00\n\nVai precisar de troco para quanto?')).toBe(true);
    // O botão "Pode alterar" da conferência ANTERIOR, tocado no meio da troca do troco: não muda nada — o troco pedido
    // primeiro (o troco de antes cobriria; só a conferência protege aqui).
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r.proximo.campo).toBe('troco_da_mudanca');
    expect(await alteracoes(p.id)).toHaveLength(0);
    r = await robo.mexerNosItens(c, { acao: 'troco_da_mudanca', observacao: 'R$ 30' });
    expect(r).toMatchObject({ ok: false, motivo: 'troco', mensagem: 'O troco para R$ 30,00 não cobre o valor novo (R$ 45,00): peça outro valor.' });
    r = await robo.mexerNosItens(c, { acao: 'troco_da_mudanca', observacao: '50' });
    expect(r.proximo.campo).toBe('confirmar_mudanca');
    expect(ultimo().texto).toContain('Troco para R$ 50,00 (novo)');
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança feita no pedido' });
    expect(ultimo().texto).toBe('✅ Pronto! Pedido nº 57 alterado.\nTotal: R$ 45,00 · troco para R$ 50,00.');
    expect(await daVenda(p.comandaId)).toEqual([
      { descricao: 'X-Bacon de teste', quantidade: 1, preco: 32 },
      { descricao: 'Suco de teste', quantidade: 1, preco: 7 },
    ]);
  });

  it('pago pelo link: TODA mudança vai para a equipe (4A); no vale-refeição (sem troco) a conferência vem sem "Mudar o troco"', async () => {
    const l = await loja();
    const pago = await pedidoAceito(l, { troco: null, pagoOnline: true, pagamentos: [{ rotulo: 'pix', valor: 45, prepago: true }] });
    const c = await l.ctx();
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'pago', chamaEquipe: true });
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r).toMatchObject({ ok: false, motivo: 'pago', chamaEquipe: true });
    // Também a que não mexe no valor (a observação).
    r = await robo.mexerNosItens(c, { acao: 'pedido_trocar', linha: 1, observacao: 'sem cebola' });
    expect(r).toMatchObject({ ok: false, motivo: 'pago', mensagem: 'O pedido nº 57 já foi pago pelo link: a mudança precisa de alguém da equipe.' });
    expect(l.doCliente()).toEqual([]);
    expect(await alteracoes(pago.id)).toHaveLength(0);

    // O mesmo cliente, outro pedido pago NA ENTREGA com vale-refeição (forma sem troco): o robô muda a observação.
    await q(`update pedido_externo set status = 'concluido' where id = $1`, [pago.id]);
    const p = await pedidoAceito(l, { troco: null, forma: 'vr', pagamentos: [{ rotulo: 'vr', valor: 45, prepago: false }] });
    r = await robo.mexerNosItens(c, { acao: 'pedido_trocar', linha: 1, observacao: 'sem cebola' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'confirmar_mudanca', opcoes: ['Pode alterar', 'Deixar como estava'] } });
    expect(ultimo().texto).toBe(
      ['Mudança no pedido nº 57', '🔄 1 X-Bacon de teste → 1 X-Bacon de teste (sem cebola)', 'Total: R$ 45,00 (não muda)', '', 'Confere a mudança 👇'].join('\n'),
    );
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança feita no pedido' });
    expect(ultimo().texto).toBe('✅ Pronto! Pedido nº 57 alterado.\nTotal: R$ 45,00.');
    expect((await q(`select observacao from comanda_item where comanda_id = $1 and descricao = 'X-Bacon de teste'`, [p.comandaId]))[0].observacao).toBe('sem cebola');
  });

  it('loja com servidor ligado: vai como "pedida"; o servidor da loja aplica com o preço conferido; a rotina avisa o cliente uma vez', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 100 });
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    const c = await l.ctx();
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'batata' });
    expect(r.proximo.campo).toBe('confirmar_mudanca');
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança pedida ao servidor da loja (a decisão chega ao cliente por aqui)' });
    expect(ultimo().texto).toBe('Pedi a mudança à loja ⏳ Te confirmo aqui em instantes.');
    const [a] = await alteracoes(p.id);
    expect(a).toMatchObject({ origem: 'robo', situacao: 'pedida' });
    // O preço que o cliente conferiu viaja na pedida: o servidor da loja cobra o mesmo (não o preço cheio).
    expect(a.pedido.adicionar[0]).toMatchObject({ produtoId: l.batata, precoUnitario: 12 });
    expect((await q(`select count(*)::int as n from edge_comando where tenant_id = $1 and comando = 'alterar_pedido'`, [l.t]))[0].n).toBe(1);
    // Enquanto a loja decide, o robô não começa outra mudança — e a rotina ainda não tem o que avisar.
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'uma_por_vez' });
    enviados.length = 0;
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toEqual([]);

    // O servidor da loja aplica a pedida (o mesmo `alterar`, com o preço que veio do robô).
    expect(
      await delivery.aplicarAlteracaoPedida({
        id: a.id, tenantId: l.t, pedidoId: p.id, porId: null, porNome: a.por_nome, origem: 'robo', pedido: a.pedido, pedidoDoCliente: a.pedido_do_cliente, createdAt: new Date(),
      }),
    ).toEqual({ aplicada: true, motivo: null });
    expect((await daVenda(p.comandaId)).find((i: any) => i.descricao === 'Batata de teste')).toMatchObject({ preco: 12 });

    // A decisão chega ao cliente pela rotina da nuvem — uma vez só, também no pior caso de duas réplicas da API: a 2ª
    // lê a mudança ANTES de a 1ª marcar "avisada" e só grava depois que a 1ª terminou (a marca é condicional — V24/V42).
    enviados.length = 0;
    let leuB!: () => void;
    let liberarB!: () => void;
    const bLeu = new Promise<void>((r) => (leuB = r));
    const portaoB = new Promise<void>((r) => (liberarB = r));
    let leiturasB = 0;
    const dbB = new Proxy(db, {
      get(alvo: any, chave) {
        if (chave !== 'execute') return alvo[chave];
        return async (consulta: any) => {
          const r = await alvo.execute(consulta);
          if (leiturasB++ === 0) {
            leuB();
            await portaoB;
          }
          return r;
        };
      },
    });
    const replicaB = new RoboPedidoService(dbB, cardapio, whats, oficial, delivery, atendimento);
    const b = replicaB.avisarDecisoesDasMudancas();
    await bLeu;
    await robo.avisarDecisoesDasMudancas();
    liberarB();
    await b;
    expect(l.doCliente()).toEqual([{ para: l.celular, texto: '✅ A loja confirmou: pedido nº 57 alterado.\nTotal: R$ 57,00 · troco para R$ 100,00.' }]);
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toHaveLength(1);
  });

  it('servidor da loja numa versão que ainda não aplica: o robô oferece a equipe ANTES da conferência (nada sai para o cliente)', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 100 });
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.12')`, [l.t, l.u]);
    const c = await l.ctx();
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'loja_sem_versao', chamaEquipe: true });
    const r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r).toMatchObject({ ok: false, motivo: 'loja_sem_versao', chamaEquipe: true, opcoes: ['Sim, quero ajuda', 'Não, obrigado'] });
    expect(l.doCliente()).toEqual([]);
    expect(await alteracoes(p.id)).toHaveLength(0);
    // O servidor atualizado (1.30.13): a mesma conversa já pode mudar.
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: true });
  });

  it('a loja recusou: o cliente ouve "não conseguiu" com a oferta da equipe; a loja não respondeu: avisa e chama a equipe', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 100 });
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    // Recusada pelo servidor da loja (o motivo é da equipe: não vai ao cliente).
    await q(`update pedido_alteracao set situacao = 'recusada', motivo = 'O pedido mudou de situação' where pedido_id = $1`, [p.id]);
    enviados.length = 0;
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toEqual([
      { para: l.celular, texto: 'A loja não conseguiu mudar o pedido nº 57 agora. Quer ajuda de alguém da equipe?', opcoes: ['Sim, quero ajuda', 'Não, obrigado'] },
    ]);
    expect(chamados.filter((x) => x.tenantId === l.t)).toEqual([]);

    // Outra tentativa, que o servidor da loja não responde a tempo (a validade + a margem do sincronismo).
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_tirar', linha: 2 });
    expect(r.ok).toBe(true);
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r.feito).toContain('pedida');
    await q(`update pedido_alteracao set created_at = now() - interval '9 minutes' where pedido_id = $1 and situacao = 'pedida'`, [p.id]);
    enviados.length = 0;
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toEqual([
      { para: l.celular, texto: 'A loja não respondeu à mudança do pedido nº 57. Já chamei alguém da equipe — te respondem aqui em instantes 🙋' },
    ]);
    expect(chamados.filter((x) => x.tenantId === l.t)).toEqual([
      expect.objectContaining({
        tenantId: l.t,
        unidadeId: l.u,
        tipo: 'mudanca',
        telefone: l.celular,
        pedidoNumero: '57',
        pedidoId: p.id,
        resumo: expect.objectContaining({ motivo: 'a loja não respondeu à mudança do pedido nº 57 pedida pelo robô', quer: '➖ 1 Suco de teste — R$ 7,00' }),
      }),
    ]);
  });

  it('o que o robô não muda volta com o motivo: desligado na loja, dois pedidos, já saiu; e o "Deixar como estava" desfaz (pela Evolution)', async () => {
    const l = await loja('evolution');
    const p = await pedidoAceito(l, { troco: 100 });
    const c = await l.ctx();
    // "Deixar como estava": a conferência sai (menu numerado), e o "Pode alterar" depois não acha mudança.
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r.ok).toBe(true);
    expect(ultimo().texto).toContain('1) Pode alterar');
    r = await robo.mexerNosItens(c, { acao: 'desistir_da_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança desfeita: o pedido nº 57 continua como estava' });
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: false, motivo: 'sem_mudanca' });
    expect(await alteracoes(p.id)).toHaveLength(0);

    // A loja desligou "O robô faz mudanças simples".
    await q(`insert into robo_config (tenant_id, muda_pedido) values ($1, false) on conflict (tenant_id) do update set muda_pedido = false`, [l.t]);
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'desligado', chamaEquipe: true });
    r = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r).toMatchObject({ ok: false, motivo: 'desligado' });
    await q(`update robo_config set muda_pedido = true where tenant_id = $1`, [l.t]);

    // Dois pedidos em andamento do mesmo número: qual mudar, a equipe confere.
    const outro = await pedidoAceito(l, { troco: 100, numero: '58' });
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ numero: '58', podeMudar: false, motivo: 'dois_pedidos' });
    // O primeiro já saiu: o que sobra em andamento é o 58 — e, saindo também, não há o que mudar por aqui.
    await q(`update pedido_externo set status = 'concluido' where id = $1`, [p.id]);
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ numero: '58', podeMudar: true });
    await q(`update pedido_externo set status = 'despachado' where id = $1`, [outro.id]);
    r = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r).toMatchObject({ ok: false, motivo: 'saiu', chamaEquipe: true, mensagem: 'O pedido nº 58 já saiu para a entrega: não dá para mudar por aqui.' });
    expect(await alteracoes(outro.id)).toHaveLength(0);
  });

  // ── A MUDANÇA DE ENDEREÇO com o pedido em produção (PR 3b-1, decisão 8) ──────────────────────────────────────────────
  it('endereço em produção: o robô pede o endereço e a referência, confere com a taxa da área nova, e o "Pode alterar" muda o pedido sem chamar a cozinha', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const c = await l.ctx();
    expect(((await robo.ver(c)) as any).pedidoFeito).toMatchObject({ endereco: 'Rua das Flores, 120 · Centro', podeMudarEndereco: true });

    // "Errei o endereço!": abre a mudança; o endereço novo vem pelo definir_entrega (nada sai ao cliente pelo Regem).
    let r: any = await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'endereco_da_mudanca' } });
    r = await robo.definirEntrega(c, { rua: 'Rua Ipê', numero: '45', bairro: 'jardim america' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'referencia_da_mudanca', opcoes: ['Sem referência'] } });
    expect(l.doCliente()).toEqual([]);
    // O carrinho do pedido em montagem não ganhou entrega nenhuma (o endereço foi para a mudança).
    expect((await q(`select entrega from robo_carrinho where tenant_id = $1 and status = 'aberto'`, [l.t]))[0].entrega).toBeNull();

    // A referência completa: a conferência com a entrega da área nova (Jardim R$ 8) e o troco que continua.
    r = await robo.definirEntrega(c, { referencia: 'casa azul, portão de ferro' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'confirmar_mudanca', opcoes: ['Pode alterar', 'Mudar o troco', 'Deixar como estava'] } });
    expect(ultimo().texto).toBe(
      [
        'Mudança no pedido nº 57',
        '📍 Rua das Flores, 120 · Centro → Rua Ipê, 45 · Jardim América (casa azul, portão de ferro)',
        'Entrega: R$ 6,00 → R$ 8,00',
        'Total: R$ 45,00 → R$ 47,00',
        'Troco para R$ 50,00 (continua)',
        '',
        'Confere a mudança 👇',
      ].join('\n'),
    );
    r = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r).toMatchObject({ ok: true, feito: 'mudança feita no pedido' });
    expect(ultimo().texto).toBe('✅ Pronto! Pedido nº 57 alterado. A entrega vai para: Rua Ipê, 45 · Jardim América.\nTotal: R$ 47,00 · troco para R$ 50,00.');

    // O pedido: o endereço novo, a taxa da área nova e o total; o histórico do robô com o endereço (sem item).
    const [ped] = await q(
      `select endereco_rua, endereco_numero, endereco_bairro, endereco_referencia, taxa_entrega::float8 as taxa, total::float8 as total, cliente_id
         from pedido_externo where id = $1`,
      [p.id],
    );
    expect(ped).toMatchObject({ endereco_rua: 'Rua Ipê', endereco_numero: '45', endereco_bairro: 'Jardim América', endereco_referencia: 'casa azul, portão de ferro', taxa: 8, total: 47 });
    const [a] = await alteracoes(p.id);
    expect(a).toMatchObject({ origem: 'robo', situacao: 'aplicada', mudanca: { itens: [] } });
    expect(a.mudanca.endereco).toMatchObject({ para: 'Rua Ipê, 45 · Jardim América' });
    // A cozinha não é chamada (nada mudou para ela): nenhum cartão com o aviso, nenhuma via ALTERADO de produção.
    expect((await q(`select count(*)::int as n from producao_pedido where comanda_id = $1 and alterado_em is not null`, [p.comandaId]))[0].n).toBe(0);
    expect((await q(`select count(*)::int as n from impressao_job where comanda_id = $1 and via = 'producao' and conteudo like '%@CBD4 ALTERADO%'`, [p.comandaId]))[0].n).toBe(0);
    // O endereço novo entrou no cadastro do cliente (o próximo pedido já o oferece).
    expect((await q(`select logradouro, numero from cliente_endereco where cliente_id = $1`, [ped.cliente_id])).map((x: any) => `${x.logradouro}, ${x.numero}`)).toContain('Rua Ipê, 45');

    // Uma mudança de endereço por pedido; a de item continua valendo (cada uma por si).
    r = await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    expect(r).toMatchObject({ ok: false, motivo: 'ja_mudou_endereco', chamaEquipe: true });
    r = await robo.mexerNosItens(c, { acao: 'pedido_por', produto: 'agua' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'confirmar_mudanca' } });
  });

  it('endereço: fora da área e pedido de retirada vão para a equipe; o endereço salvo pelo número vale; o frete grátis do pedido continua', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 100 });
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    let r: any = await robo.definirEntrega(c, { rua: 'Rua Longe', numero: '9', bairro: 'Barra da Tijuca', referencia: 'sem referência' });
    expect(r).toMatchObject({ ok: false, motivo: 'fora_da_area', chamaEquipe: true, opcoes: ['Sim, quero ajuda', 'Não, obrigado'] });
    expect(l.doCliente()).toEqual([]);
    // "Sem referência" fecha o endereço sem o passo da referência (e não grava a marca no pedido).
    r = await robo.definirEntrega(c, { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América', referencia: 'sem referência' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'confirmar_mudanca' } });
    expect(ultimo().texto).toContain('📍 Rua das Flores, 120 · Centro → Rua Ipê, 45 · Jardim América\n');
    await robo.mexerNosItens(c, { acao: 'desistir_da_mudanca' });
    expect(await alteracoes(p.id)).toHaveLength(0);

    // O pedido de retirada não tem endereço: a equipe.
    await q(`update pedido_externo set status = 'concluido' where id = $1`, [p.id]);
    await pedidoAceito(l, { tipo: 'retirada', numero: '58', troco: 100 });
    r = await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    expect(r).toMatchObject({ ok: false, motivo: 'retirada', chamaEquipe: true });
  });

  it('endereço: o frete grátis que o pedido ganhou continua no endereço novo — a taxa conferida é a gravada (V74)', async () => {
    const l = await loja();
    // O pedido saiu com o frete grátis (a linha "frete" dos descontos) e a taxa zerada.
    const p = await pedidoAceito(l, { taxa: 0, troco: 100, descontos: [{ origem: 'frete', rotulo: 'Frete grátis', valor: 6, alvo: 'DELIVERY_FEE', quemBanca: 'loja' }] });
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    const r: any = await robo.definirEntrega(c, { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América', referencia: 'portão azul' });
    expect(r.proximo.campo).toBe('confirmar_mudanca');
    expect(ultimo().texto).not.toContain('Entrega:');
    expect(ultimo().texto).toContain('Total: R$ 39,00 (não muda)');
    await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    // A gravação usa a taxa que o cliente conferiu (zero) — não a da lista de bairros (R$ 8).
    expect((await q(`select taxa_entrega::float8 as taxa, total::float8 as total from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ taxa: 0, total: 39 });
  });

  it('endereço na loja com servidor: a pedida leva o endereço e a taxa conferida; o servidor da loja aplica a mesma; a taxa que a TELA mandasse não vale', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 100 });
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    const c = await l.ctx();
    await robo.mexerNosItens(c, { acao: 'pedido_endereco' });
    await robo.definirEntrega(c, { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América', referencia: 'portão azul' });
    const r: any = await robo.mexerNosItens(c, { acao: 'confirmar_mudanca' });
    expect(r.feito).toContain('pedida');
    const [a] = await alteracoes(p.id);
    expect(a.pedido.endereco).toMatchObject({ rua: 'Rua Ipê', numero: '45', bairroId: l.jardim, referencia: 'portão azul', taxa: 8 });
    // O servidor da loja aplica com a taxa da pedida do robô.
    await delivery.aplicarAlteracaoPedida({
      id: a.id, tenantId: l.t, pedidoId: p.id, porId: null, porNome: a.por_nome, origem: 'robo', pedido: a.pedido, pedidoDoCliente: a.pedido_do_cliente, createdAt: new Date(),
    });
    expect((await q(`select endereco_rua, taxa_entrega::float8 as taxa from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ endereco_rua: 'Rua Ipê', taxa: 8 });
    enviados.length = 0;
    await robo.avisarDecisoesDasMudancas();
    expect(l.doCliente()).toEqual([
      { para: l.celular, texto: '✅ A loja confirmou: pedido nº 57 alterado. A entrega vai para: Rua Ipê, 45 · Jardim América.\nTotal: R$ 47,00 · troco para R$ 100,00.' },
    ]);

    // A tela (a equipe) não informa taxa: a que viesse no corpo sai — vale a do bairro do cadastro.
    await q(`delete from edge_heartbeat where tenant_id = $1`, [l.t]);
    const outro = await pedidoAceito(l, { troco: 100, numero: '59' });
    await delivery.alterar({ tenantId: l.t, colaboradorId: l.gestor, nome: 'Ana de teste', categoria: 'gerente' } as any, outro.id, {
      idAlteracao: randomUUID(),
      endereco: { rua: 'Rua Ipê', numero: '45', bairroId: l.jardim, taxa: 1 } as any,
    });
    expect((await q(`select taxa_entrega::float8 as taxa from pedido_externo where id = $1`, [outro.id]))[0].taxa).toBe(8);
  });

  // ── o endereço depois que o pedido SAIU (PR 3b-2, decisão 8): o robô não muda — chama a equipe como urgente ─────────
  const despachar = (pedidoId: string) =>
    q(
      `update pedido_externo set status = 'despachado', despachado_em = now(), entregador_nome = 'João de teste', entregador_telefone = '21988887777'
        where id = $1`,
      [pedidoId],
    );
  const equipe = (l: Loja) => ({ tenantId: l.t, colaboradorId: l.gestor, nome: 'Ana de teste', categoria: 'gerente' }) as any;
  const casos = (l: Loja) => q(`select * from atendimento_chamado where tenant_id = $1 order by criado_em`, [l.t]);
  /** Espera algo que acontece depois da resposta (a distância medida, o aviso que sai em seguida). */
  async function esperar<T>(ler: () => Promise<T>, pronto: (v: T) => boolean, ms = 8000): Promise<T> {
    const ate = Date.now() + ms;
    for (;;) {
      const v = await ler();
      if (pronto(v) || Date.now() > ate) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  /** O cliente do pedido que já saiu pede o endereço novo ao robô: o caso urgente que a equipe recebe. */
  async function casoDoEnderecoNaRua(l: Loja, p: { id: string }, endereco: any = { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América' }) {
    await despachar(p.id);
    const c = await l.ctx();
    await roboComEquipe.mexerNosItens(c, { acao: 'pedido_endereco' });
    const r: any = await roboComEquipe.definirEntrega(c, endereco);
    const [caso] = await casos(l);
    return { c, r, caso };
  }
  const user = equipe;

  it('o pedido já saiu: o robô pega o endereço novo e abre o caso URGENTE com a distância, a taxa da área nova e o entregador', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await despachar(p.id);
    const c = await l.ctx();
    const v: any = await roboComEquipe.ver(c);
    expect(v.pedidoFeito).toMatchObject({ podeMudar: false, motivo: 'saiu', enderecoPelaEquipe: true });

    let r: any = await roboComEquipe.mexerNosItens(c, { acao: 'pedido_endereco' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'endereco_da_mudanca' } });
    expect(r.proximo.pergunta).toContain('já saiu para a entrega');
    expect(l.doCliente()).toEqual([]); // até aqui o Regem não manda nada
    // Sem a pergunta da referência: o endereço que o cliente disse basta para a equipe.
    r = await roboComEquipe.definirEntrega(c, { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'equipe_chamada' } });
    expect(r.feito).toContain('caso urgente aberto');
    expect(l.doCliente()).toEqual([
      {
        para: l.celular,
        texto:
          'Seu pedido nº 57 já saiu para entrega, então a mudança de endereço passa pela equipe: ela avisa o entregador e confere a distância. Já chamei — alguém te responde aqui em instantes 🙋',
      },
    ]);
    const [caso] = await casos(l);
    expect(caso).toMatchObject({ tipo: 'mudanca', prioridade: 'urgente', pedido_id: p.id, pedido_numero: '57', canal: 'whatsapp', status: 'aberto' });
    expect(caso.detalhe.robo.motivo).toBe('o pedido nº 57 já saiu para a entrega e o cliente quer mudar o endereço');
    expect(caso.detalhe.endereco).toMatchObject({
      pedidoId: p.id,
      numero: '57',
      de: { rua: 'Rua das Flores', numero: '120', bairro: 'Centro' },
      para: { rua: 'Rua Ipê', numero: '45', bairro: 'Jardim América', bairroId: l.jardim },
      taxaAntes: 6,
      taxaNova: 8,
      total: 45,
      aReceber: 45,
      comANova: { total: 47, aReceber: 47 },
      pagoAntes: false,
      trocoPara: 50,
      entregador: { nome: 'João de teste', telefone: '21988887777' },
      via: 'cloud',
    });
    // A distância é medida DEPOIS (não segura a resposta ao cliente) e entra no caso.
    const medido = await esperar(
      async () => (await q(`select detalhe from atendimento_chamado where id = $1`, [caso.id]))[0].detalhe,
      (d: any) => 'distancia' in (d?.endereco ?? {}),
    );
    expect(medido.endereco.distancia).toMatchObject({ pelo: 'linha_reta', min: null });
    expect(medido.endereco.distancia.km).toBeGreaterThan(2.9);
    expect(medido.endereco.distancia.km).toBeLessThan(3.1);
    // O pedido NÃO mudou (quem muda é a equipe) e a mudança da conversa saiu.
    expect((await q(`select endereco_rua, status from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ endereco_rua: 'Rua das Flores', status: 'despachado' });
    expect(await alteracoes(p.id)).toHaveLength(0);
    expect((await q(`select mudanca from robo_carrinho where tenant_id = $1 and status = 'aberto'`, [l.t]))[0]?.mudanca ?? null).toBeNull();
  });

  it('a equipe muda pelo caso: só o endereço (sem cozinha e sem via); o cliente recebe "Endereço atualizado!" uma vez', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { caso } = await casoDoEnderecoNaRua(l, p);
    const jobsAntes = (await q(`select count(*)::int as n from impressao_job where tenant_id = $1`, [l.t]))[0].n;
    enviados.length = 0;

    const r: any = await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'manter' });
    expect(r).toMatchObject({ ok: true, situacao: 'aplicada', mudado: { taxa: 6, porNome: 'Ana de teste' } });
    expect((await q(`select endereco_rua, endereco_numero, endereco_bairro, taxa_entrega::float8 as taxa, total::float8 as total, status, alterado from pedido_externo where id = $1`, [p.id]))[0]).toEqual({
      endereco_rua: 'Rua Ipê', endereco_numero: '45', endereco_bairro: 'Jardim América', taxa: 6, total: 45, status: 'despachado', alterado: true,
    });
    const [a] = await alteracoes(p.id);
    expect(a).toMatchObject({ origem: 'equipe', situacao: 'aplicada', id: r.mudado.alteracaoId, vias: null });
    expect(a.pedido).toMatchObject({ depoisQueSaiu: true, chamadoId: caso.id, endereco: { rua: 'Rua Ipê', numero: '45', taxa: 6 } });
    // Sem via e sem cozinha: o entregador já está na rua.
    expect((await q(`select count(*)::int as n from impressao_job where tenant_id = $1`, [l.t]))[0].n).toBe(jobsAntes);
    expect((await q(`select count(*)::int as n from producao_pedido where comanda_id = $1 and alterado_em is not null`, [p.comandaId]))[0].n).toBe(0);
    // O caso guarda o que a equipe fez e fica com quem tocou.
    const [depois] = await casos(l);
    expect(depois.detalhe.endereco.mudado).toMatchObject({ taxa: 6, alteracaoId: a.id, porId: l.gestor });
    expect(depois.responsavel_id).toBe(l.gestor);

    // Mudou na nuvem, na hora: o cliente recebe já — e a rotina não manda de novo (a marca é na alteração).
    const doCliente = await esperar(async () => l.doCliente(), (x) => x.length > 0);
    expect(doCliente).toEqual([{ para: l.celular, texto: 'Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍' }]);
    await atendimentoDeVerdade.avisarEnderecosMudados();
    await atendimentoDeVerdade.avisarEnderecosMudados();
    expect(l.doCliente()).toHaveLength(1);
    expect((await alteracoes(p.id))[0].pedido.avisoAoCliente).toMatchObject({ em: expect.any(String) });
    expect((await alteracoes(p.id))[0].pedido.avisoAoCliente.falhou).toBeUndefined();

    // A fila mostra a mudança aplicada e o aviso; o "Mudar" de novo não muda outra vez.
    const fila: any = await atendimentoDeVerdade.fila(user(l), null);
    expect(fila.casos.find((x: any) => x.id === caso.id).mudancaDoEndereco).toMatchObject({ situacao: 'aplicada', aviso: { em: expect.any(String) } });
    expect(await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).toMatchObject({ repetido: true });
    expect(await alteracoes(p.id)).toHaveLength(1);
  });

  it('cobrar a taxa nova: a da área nova e o total novo; um valor digitado não vale; item depois que saiu, nunca', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { caso } = await casoDoEnderecoNaRua(l, p);
    for (const taxa of [10, '10', 'outra', undefined])
      await expect(atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa })).rejects.toThrow('Escolha a taxa da entrega');
    expect(await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).toMatchObject({ situacao: 'aplicada', mudado: { taxa: 8 } });
    expect((await q(`select taxa_entrega::float8 as taxa, total::float8 as total from pedido_externo where id = $1`, [p.id]))[0]).toEqual({ taxa: 8, total: 47 });
    // O "depois que saiu" só muda o endereço e o troco (a regra mora no `alterar`).
    await expect(
      delivery.alterar(user(l), p.id, { adicionar: [{ produtoId: l.agua, quantidade: 1 }] } as any, { depoisQueSaiu: true }),
    ).rejects.toThrow('Depois que o pedido saiu, só o endereço e o troco mudam.');
    // Sem a marca, o pedido na rua não muda pela alteração de sempre (a tela do painel).
    await expect(
      delivery.alterar(user(l), p.id, { idAlteracao: randomUUID(), endereco: { rua: 'Rua A', numero: '1', bairroId: l.centro } }),
    ).rejects.toThrow('Só dá para alterar um pedido aceito e ainda na loja');
  });

  it('fora da área: o caso vai mesmo assim, sem taxa nova; "cobrar a nova" não dá e "manter" muda o endereço', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { r, caso } = await casoDoEnderecoNaRua(l, p, { rua: 'Rua Ipê', numero: '45', bairro: 'Zona Rural Distante' });
    expect(r).toMatchObject({ ok: true, proximo: { campo: 'equipe_chamada' } });
    expect(caso.detalhe.endereco).toMatchObject({ para: { bairro: 'Zona Rural Distante', bairroId: null }, taxaNova: null, comANova: null });
    await expect(atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).rejects.toThrow('fora da área de entrega');
    await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'manter' });
    expect((await q(`select endereco_bairro, taxa_entrega::float8 as taxa from pedido_externo where id = $1`, [p.id]))[0]).toEqual({
      endereco_bairro: 'Zona Rural Distante',
      taxa: 6,
    });
  });

  it('o troco que não cobre a taxa nova: o caso já diz que "cobrar a nova" não dá (a conta da gravação — V74)', async () => {
    const l = await loja();
    const p = await pedidoAceito(l, { troco: 46 });
    const { caso } = await casoDoEnderecoNaRua(l, p);
    expect(caso.detalhe.endereco.comANova.recusa).toContain('O troco para R$ 46,00 não cobre o novo valor (R$ 47,00)');
    await expect(atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).rejects.toThrow('Mantenha a taxa do pedido.');
    expect(await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'manter' })).toMatchObject({ situacao: 'aplicada' });
  });

  it('loja com servidor: vai como "pedida" (com a marca e o caso); o servidor da loja aplica e a rotina avisa depois; passou do prazo, não avisa', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { caso } = await casoDoEnderecoNaRua(l, p);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    enviados.length = 0;
    expect(await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).toMatchObject({ situacao: 'pedida' });
    const [a] = await alteracoes(p.id);
    expect(a).toMatchObject({ situacao: 'pedida' });
    expect(a.pedido).toMatchObject({ depoisQueSaiu: true, chamadoId: caso.id, precoInformado: true, endereco: { rua: 'Rua Ipê', taxa: 8 } });
    // Enquanto a loja não aplica: nada ao cliente; a fila diz "pedida"; o "Mudar" de novo não pede outra.
    await atendimentoDeVerdade.avisarEnderecosMudados();
    expect(l.doCliente()).toEqual([]);
    expect(((await atendimentoDeVerdade.fila(user(l), null)) as any).casos.find((x: any) => x.id === caso.id).mudancaDoEndereco).toMatchObject({ situacao: 'pedida' });
    expect(await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'nova' })).toMatchObject({ repetido: true });

    // O servidor da loja aplica a pedida: com o "depois que saiu" e a taxa escolhida — sem via.
    expect(
      await delivery.aplicarAlteracaoPedida({
        id: a.id, tenantId: l.t, pedidoId: p.id, porId: l.gestor, porNome: a.por_nome, origem: 'equipe', pedido: a.pedido, pedidoDoCliente: a.pedido_do_cliente, createdAt: new Date(),
      }),
    ).toEqual({ aplicada: true, motivo: null });
    expect((await q(`select endereco_rua, taxa_entrega::float8 as taxa, total::float8 as total from pedido_externo where id = $1`, [p.id]))[0]).toEqual({
      endereco_rua: 'Rua Ipê',
      taxa: 8,
      total: 47,
    });
    await atendimentoDeVerdade.avisarEnderecosMudados();
    expect(l.doCliente()).toEqual([{ para: l.celular, texto: 'Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍' }]);

    // Outra loja: a mudança aplicada que chegou à nuvem tarde demais (a loja ficou sem internet) — marca, não manda.
    const l2 = await loja();
    const p2 = await pedidoAceito(l2);
    const { caso: caso2 } = await casoDoEnderecoNaRua(l2, p2);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l2.t, l2.u]);
    await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l2), caso2.id, { taxa: 'manter' });
    const [a2] = await alteracoes(p2.id);
    await delivery.aplicarAlteracaoPedida({
      id: a2.id, tenantId: l2.t, pedidoId: p2.id, porId: l2.gestor, porNome: a2.por_nome, origem: 'equipe', pedido: a2.pedido, pedidoDoCliente: null, createdAt: new Date(),
    });
    // "Manter" vale também no servidor da loja: a taxa escolhida viaja na pedida (não a do bairro novo, R$ 8).
    expect((await q(`select taxa_entrega::float8 as taxa from pedido_externo where id = $1`, [p2.id]))[0].taxa).toBe(6);
    await q(`update pedido_alteracao set created_at = now() - interval '40 minutes' where id = $1`, [a2.id]);
    enviados.length = 0;
    await atendimentoDeVerdade.avisarEnderecosMudados();
    expect(l2.doCliente()).toEqual([]);
    expect((await alteracoes(p2.id))[0].pedido.avisoAoCliente).toMatchObject({ expirou: true });
  });

  it('a rotina do "Endereço atualizado!": duas réplicas na mesma volta mandam UMA vez; a consulta lê pelo índice parcial (mig 364)', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { caso } = await casoDoEnderecoNaRua(l, p);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.13')`, [l.t, l.u]);
    await atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'manter' });
    const [a] = await alteracoes(p.id);
    await delivery.aplicarAlteracaoPedida({
      id: a.id, tenantId: l.t, pedidoId: p.id, porId: l.gestor, porNome: a.por_nome, origem: 'equipe', pedido: a.pedido, pedidoDoCliente: null, createdAt: new Date(),
    });
    enviados.length = 0;
    // A réplica B lê a alteração ANTES de a A marcar e só grava depois que a A terminou: a marca é condicional (V24/V42).
    let leuB!: () => void;
    let liberarB!: () => void;
    const bLeu = new Promise<void>((r) => (leuB = r));
    const portaoB = new Promise<void>((r) => (liberarB = r));
    let leiturasB = 0;
    const dbB = new Proxy(db, {
      get(alvo: any, chave) {
        if (chave !== 'execute') return alvo[chave];
        return async (consulta: any) => {
          const r = await alvo.execute(consulta);
          if (leiturasB++ === 0) {
            leuB();
            await portaoB;
          }
          return r;
        };
      },
    });
    const replicaB = new AtendimentoService(dbB, eventos, delivery, auditoria, undefined, oficial, whats);
    const b = replicaB.avisarEnderecosMudados(a.id);
    await bLeu;
    await atendimentoDeVerdade.avisarEnderecosMudados(a.id);
    liberarB();
    await b;
    expect(l.doCliente()).toEqual([{ para: l.celular, texto: 'Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍' }]);

    // O plano da consulta da rotina usa o índice parcial (a condição é a mesma — sem isso, varreria o histórico todo).
    const plano = await db.transaction(async (tx: any) => {
      await tx.execute(sql`set local enable_seqscan = off`);
      const r: any = await tx.execute(sql`explain ${consultaDosAvisosDoEndereco()}`);
      return (r.rows ?? r).map((x: any) => x['QUERY PLAN']).join('\n');
    });
    expect(plano).toContain('idx_pedido_alteracao_aviso_do_endereco');
  });

  it('loja com servidor numa versão antiga: a equipe recebe a frase certa (avisar o entregador pelo WhatsApp)', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    const { caso } = await casoDoEnderecoNaRua(l, p);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, versao) values ($1,$2,'1.30.12')`, [l.t, l.u]);
    await expect(atendimentoDeVerdade.mudarEnderecoDepoisQueSaiu(user(l), caso.id, { taxa: 'manter' })).rejects.toThrow(
      'O servidor desta loja ainda não muda o endereço do pedido que já saiu',
    );
    expect(await alteracoes(p.id)).toHaveLength(0);
  });

  it('a conversa já estava com a equipe (um caso aberto antes): o caso do endereço abre, mas o Regem não fala por cima', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await atendimentoDeVerdade.abrirPeloRobo(l.t, l.u, { tipo: 'humano', telefone: l.celular, mensagem: 'Quer falar com alguém' });
    enviados.length = 0;
    const { r } = await casoDoEnderecoNaRua(l, p);
    expect(l.doCliente()).toEqual([]);
    expect(r.mensagemParaOCliente).toContain('Seu pedido nº 57 já saiu para entrega');
    const todos = await casos(l);
    expect(todos.map((x: any) => x.tipo)).toEqual(['humano', 'mudanca']);
    expect(todos[1]).toMatchObject({ prioridade: 'urgente', pedido_id: p.id });
  });

  it('o robô desligado, dois pedidos ou retirada: a resposta de sempre (com a oferta da equipe) — nada de caso pelo endereço', async () => {
    const l = await loja();
    const p = await pedidoAceito(l);
    await despachar(p.id);
    await q(`insert into robo_config (tenant_id, muda_pedido) values ($1, false) on conflict (tenant_id) do update set muda_pedido = false`, [l.t]);
    const r: any = await roboComEquipe.mexerNosItens(await l.ctx(), { acao: 'pedido_endereco' });
    expect(r).toMatchObject({ ok: false, motivo: 'desligado', chamaEquipe: true });
    expect(await casos(l)).toEqual([]);
  });
});
