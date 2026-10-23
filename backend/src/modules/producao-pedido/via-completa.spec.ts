import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';
import { ProducaoPedidoService, TITULO_OUTROS_ITENS } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS VIAS DO PEDIDO (pedido do dono, 22–23/10/2026), no servidor da loja e contra o Postgres real:
//  • a via do caixa do pedido de canal é a VIA DO DELIVERY — nome, endereço, nº do pedido, total com a taxa e o
//    desconto, troco — e não a do balcão ("Venda balcao", total só dos itens);
//  • a VIA DE PRODUÇÃO COMPLETA (o pedido inteiro numa via, com a identificação e sem valores) sai nas impressoras
//    marcadas no modelo de produção — no teste da loja ela estava marcada na "Caixa delivery" e não saía;
//  • a impressora que recebe a completa não recebe a direcionada; sem impressora marcada, nada muda;
//  • a mesma via na venda que desce da nuvem (materializarProducaoLocal) e na reimpressão.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('via-completa.spec: sem TEST_PG_URL — PULADO');

descrever('as vias do pedido: via do delivery e via de produção completa (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  const beneficio = new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(db, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any);
  const env0 = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  const empresas: string[] = [];
  const pedidos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const um = async (s: string, p: any[] = []) => (await q(s, p))[0].id as string;
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const semNbsp = (s: string) => String(s).replace(/ /g, ' ');

  beforeAll(() => {
    process.env.EDGE_MODE = 'true'; // o servidor da loja aceita e imprime
    delete process.env.CLOUD_API;
    delete process.env.SYNC_TOKEN;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env0)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (pedidos.length) await pool.query('delete from impressao_edge_feito where comanda_id = any($1::uuid[])', [pedidos]).catch(() => {});
    if (empresas.length) {
      for (const t of [
        'pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido_item', 'producao_pedido', 'pedido_externo',
        'lancamento_caixa', 'comanda_item_complemento', 'comanda_item', 'comanda', 'senha_contador', 'delivery_config',
        'produto_combo_item', 'produto', 'equipamento', 'setor', 'unidade',
      ])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // A loja do teste do dono: a "Caixa delivery" (cupom) e uma impressora de cozinha que atende o setor do lanche.
  async function loja(cupomPerfis: any) {
    const t = await um(`insert into empresa (nome) values ('teste vias do pedido') returning id`);
    empresas.push(t);
    const u = await um(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]);
    const coz = await um(`insert into setor (tenant_id, unidade_id, nome) values ($1,$2,'Chapa') returning id`, [t, u]);
    const impressora = (nome: string, extra: string, v: any[]) =>
      um(
        `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, ${extra})
         values ($1,$2,'impressora',$3,$4,true,'rede',$5,9100${v.map((_, i) => `,$${i + 6}`).join('')}) returning id`,
        [t, u, nome, 'tok-' + randomUUID(), '10.0.0.' + Math.floor(Math.random() * 200 + 10), ...v],
      );
    const caixa = await impressora('Caixa delivery', 'faz_cupom', [true]);
    const cozinha = await impressora('Cozinha', 'faz_producao, setores_atendidos', [true, JSON.stringify([coz])]);
    const produto = (codigo: string, nome: string, vai: boolean, setor: string | null, tipo = 'simples') =>
      um(
        `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao, setor_producao_id, tipo) values ($1,$2,$3,'10',$4,$5,$6) returning id`,
        [t, codigo, nome, vai, setor, tipo],
      );
    const burger = await produto('XB1', 'Burger Fictício', true, coz);
    const refri = await produto('RF1', 'Refri Fictício', false, null);
    const batata = await produto('BT1', 'Batata Fictícia', true, null);
    const combo = await produto('CB1', 'Combo Fictício', true, null, 'combo');
    const molho = await produto('MO1', 'Molho Fictício', false, null);
    await q(`insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id, quantidade) values ($1,$2,$3,1),($1,$2,$4,1)`, [t, combo, batata, refri]);
    // Componente retirado do combo (mig 242): não sai na via.
    await q(`insert into produto_combo_item (tenant_id, combo_produto_id, componente_produto_id, quantidade, deleted_at) values ($1,$2,$3,1,now())`, [t, combo, molho]);
    const perfis = typeof cupomPerfis === 'function' ? cupomPerfis({ caixa, cozinha }) : cupomPerfis;
    await q(`insert into delivery_config (tenant_id, cupom_perfis, cupom_layout) values ($1,$2::jsonb,$3::jsonb)`, [
      t,
      JSON.stringify(perfis),
      JSON.stringify({ cabecalho: 'Loja Fictícia', rodape: 'Obrigado pela preferência' }),
    ]);
    return { t, u, caixa, cozinha };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  // Pedido do cardápio, entrega, dinheiro com troco para R$ 100: itens 2×10 + 10 + 2×5 = 40, taxa 6, desconto 2 → 44.
  async function aceitar(l: Loja, tipo: 'entrega' | 'retirada' = 'entrega') {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, cliente_nome, cliente_telefone, tipo,
         endereco, endereco_rua, endereco_numero, endereco_bairro, endereco_referencia, status, itens, total, valor_pago_cliente,
         taxa_entrega, desconto, troco_para, forma_pagamento, pagamentos)
       values ($1,$2,'cardapio',$3,'12',284,'Cliente Fictício','(00) 0000-0000',$4,
         'Rua Fictícia, 10 - Centro','Rua Fictícia','10','Centro','portão azul','novo',
         '[{"codigo":"XB1","descricao":"Burger Fictício","quantidade":2,"precoUnitario":10,"observacao":"bem passado"},
           {"codigo":"RF1","descricao":"Refri Fictício","quantidade":1,"precoUnitario":10},
           {"codigo":"CB1","descricao":"Combo Fictício","quantidade":2,"precoUnitario":5}]'::jsonb,
         44, 44, 6, 2, 100, 'dinheiro', '[{"rotulo":"Dinheiro","valor":44,"prepago":false,"troco":100}]'::jsonb)
       returning id`,
      [l.t, l.u, randomUUID(), tipo],
    );
    pedidos.push(p.id);
    await delivery.aceitar(l.t, null, p.id);
    const comanda = (await q('select comanda_id from pedido_externo where id = $1', [p.id]))[0].comanda_id as string;
    // A via do caixa sai logo depois do aceite (sem segurar a resposta): espera o trabalho aparecer.
    for (let i = 0; i < 50 && !(await jobs(comanda, 'cliente')).length; i++) await espera(100);
    return { pedido: p.id as string, comanda };
  }
  const jobs = async (comanda: string, via: string) =>
    (await q(`select equipamento_id as eq, conteudo from impressao_job where comanda_id = $1 and via = $2 order by criado_em, id`, [comanda, via])).map(
      (j: any) => ({ eq: j.eq as string, linhas: semNbsp(j.conteudo).split('\n') }),
    );

  it('o teste da loja: a via do delivery com os dados do pedido e a via de produção completa na impressora marcada', async () => {
    const l = await loja(({ caixa }: any) => ({ producao_delivery: { impressoras: [caixa] } }));
    const { comanda } = await aceitar(l);

    const [via] = await jobs(comanda, 'cliente');
    expect(via.eq).toBe(l.caixa);
    const texto = via.linhas.join('\n');
    for (const t of ['@CB Loja Fictícia', '@CB DELIVERY', '@CBD Cardápio #12', '@BD Cliente Fictício', '@BSD Rua Fictícia, 10', '@BSD Ref: portão azul',
      '@BD TOTAL: R$ 44,00', '@CB COBRAR R$ 44,00', '@B Troco para R$ 100,00', '@B LEVAR TROCO: R$ 56,00', 'Entrega: R$ 6,00', '@C Obrigado pela preferência'])
      expect(via.linhas).toContain(t);
    expect(texto).toMatch(/@CBD SENHA D-\d+/);
    expect(texto).not.toMatch(/Venda balcao/i);

    const prod = await jobs(comanda, 'producao');
    const completa = prod.find((j) => j.eq === l.caixa)!;
    expect(completa).toBeTruthy();
    const c = completa.linhas.join('\n');
    expect(completa.linhas).toEqual(
      // Os componentes do combo multiplicados pela quantidade do item (2 combos = 2 batatas).
      expect.arrayContaining(['@CB DELIVERY', '@CBD Cardápio #12', '@CBD Cliente Fictício', '@BD 2x Burger Fictício', '@B    OBS: bem passado',
        '@BD 2x Combo Fictício', '@BSD    - 2x Batata Fictícia', '@BSD    - 2x Refri Fictício', `@S ${TITULO_OUTROS_ITENS}`, '@S 1x Refri Fictício']),
    );
    expect(c).toMatch(/@CBD SENHA D-\d+/);
    // Só o que importa: sem valores, endereço, pagamento, cabeçalho e rodapé.
    expect(c).not.toMatch(/R\$|Rua Fictícia|Dinheiro|Troco|Loja Fictícia|Obrigado/);
    expect(c).not.toContain('Molho Fictício'); // retirado do combo
    // A cozinha segue com a via direcionada (o lanche do setor dela), como sempre.
    const coz = prod.find((j) => j.eq === l.cozinha)!;
    expect(coz.linhas.join('\n')).toContain('2x Burger Fictício');
    expect(coz.linhas.join('\n')).not.toContain(TITULO_OUTROS_ITENS);
    expect(prod).toHaveLength(2);
  });

  it('a impressora da via completa não recebe também a direcionada (o mesmo pedido duas vezes)', async () => {
    const l = await loja(({ cozinha }: any) => ({ producao_delivery: { impressoras: [cozinha] } }));
    const { comanda } = await aceitar(l);
    const prod = await jobs(comanda, 'producao');
    expect(prod.map((j) => j.eq)).toEqual([l.cozinha]);
    expect(prod[0].linhas).toEqual(expect.arrayContaining(['@BD 2x Burger Fictício', '@BD 2x Combo Fictício', '@S 1x Refri Fictício']));
  });

  it('sem impressora marcada no modelo de produção: nada muda — só a via direcionada', async () => {
    const l = await loja({});
    const { comanda } = await aceitar(l);
    const prod = await jobs(comanda, 'producao');
    expect(prod.map((j) => j.eq)).toEqual([l.cozinha]);
    expect(prod[0].linhas.join('\n')).not.toContain('Combo Fictício'); // o combo sem setor não tem impressora
    // A via sem perfil (loja que nunca editou) diz DELIVERY no lugar de "BALCAO" e traz o canal e o nome.
    expect(prod[0].linhas).toEqual(expect.arrayContaining(['@B Cardápio #12', '@B Cliente Fictício']));
    expect(prod[0].linhas.some((s) => /^DELIVERY · #\d+$/.test(s))).toBe(true);
    expect(prod[0].linhas.join('\n')).not.toContain('BALCAO');
    // A impressora marcada que saiu de uso também não conta.
    const l2 = await loja(({ caixa }: any) => ({ producao_delivery: { impressoras: [caixa, randomUUID()] } }));
    await q(`update equipamento set ativo = false where id = $1`, [l2.caixa]);
    const v2 = await aceitar(l2);
    expect((await jobs(v2.comanda, 'producao')).map((j) => j.eq)).toEqual([l2.cozinha]);
  });

  it('a via do delivery sai na impressora marcada no perfil "Cliente — delivery" (sem regra do documento)', async () => {
    const l = await loja(({ cozinha }: any) => ({ entregador: { impressoras: [cozinha] } }));
    const { comanda } = await aceitar(l);
    expect((await jobs(comanda, 'cliente')).map((j) => j.eq)).toEqual([l.cozinha]);
  });

  it('retirada pedida no canal: modelo do delivery, "RETIRADA", sem endereço', async () => {
    const l = await loja(({ caixa }: any) => ({ producao_delivery: { impressoras: [caixa] } }));
    const { comanda } = await aceitar(l, 'retirada');
    const via = (await jobs(comanda, 'cliente'))[0].linhas;
    expect(via).toContain('@CB RETIRADA');
    expect(via.join('\n')).not.toContain('Rua Fictícia');
    const completa = (await jobs(comanda, 'producao')).find((j) => j.eq === l.caixa)!;
    expect(completa.linhas).toContain('@CB RETIRADA');
  });

  it('a venda que desce da nuvem (servidor da loja) e a reimpressão saem iguais', async () => {
    const l = await loja(({ caixa }: any) => ({ producao_delivery: { impressoras: [caixa] } }));
    const { comanda } = await aceitar(l);
    const antes = await jobs(comanda, 'producao');
    await q(`delete from impressao_job where comanda_id = $1`, [comanda]);
    expect(await producao.materializarProducaoLocal(l.t, comanda)).toBe(2);
    const depois = await jobs(comanda, 'producao');
    // As mesmas linhas (fora a hora da impressão); a ordem dos itens segue a da leitura da venda.
    const linhasDe = (js: any[], id: string) => js.find((j) => j.eq === id).linhas.filter((s: string) => !/\d{2}\/\d{2}\/\d{4}/.test(s)).sort();
    expect(linhasDe(depois, l.caixa)).toEqual(linhasDe(antes, l.caixa));
    expect(linhasDe(depois, l.cozinha)).toEqual(linhasDe(antes, l.cozinha));

    const r: any = await vendas.reimprimirViasExterno(l.t, randomUUID(), comanda, null, null, null);
    expect(r.ok).toBe(true);
    const [reimpressa] = await jobs(comanda, 'cliente');
    expect(reimpressa.linhas).toEqual(expect.arrayContaining(['@BD Cliente Fictício', '@B LEVAR TROCO: R$ 56,00', '@CBD Cardápio #12']));
    expect(reimpressa.linhas.join('\n')).not.toMatch(/Venda balcao/i);
  });

  it('balcão: a via completa no modelo do balcão, com o resto da venda em letra pequena', async () => {
    const l = await loja(({ caixa }: any) => ({ producao_balcao: { impressoras: [caixa] } }));
    const cmd = await um(`insert into comanda (tenant_id, unidade_id, status, senha, senha_prefixo, cliente) values ($1,$2,'fechada',7,'B','Ana') returning id`, [l.t, l.u]);
    const [burger] = await db
      .select()
      .from(schema.produto)
      .where(and(eq(schema.produto.tenantId, l.t), eq(schema.produto.codigo, 'XB1')));
    await db.transaction((tx: any) =>
      producao.criarPedidos(
        tx,
        { tenantId: l.t, unidadeId: l.u, comandaId: cmd, origem: 'balcao', senha: 7, senhaPrefixo: 'B', cliente: 'Ana' },
        [{ produto: burger, descricao: 'Burger Fictício', quantidade: 1 }],
        [{ quantidade: 1, descricao: 'Refri Fictício' }],
      ),
    );
    const prodJobs = await jobs(cmd, 'producao');
    const completa = prodJobs.find((j) => j.eq === l.caixa)!;
    expect(completa.linhas).toEqual(expect.arrayContaining(['@CBD SENHA B-7', '@CB BALCAO', '@CBD Ana', '@BD 1x Burger Fictício', '@S 1x Refri Fictício']));
    expect(completa.linhas.join('\n')).not.toMatch(/DELIVERY|RETIRADA|R\$/);
  });
});
