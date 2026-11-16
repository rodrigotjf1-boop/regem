import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { assinarConversa } from '../../common/conversa-do-robo';
import { WhatsappService } from './whatsapp.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS PEDIDOS QUE O ROBÔ VÊ SÃO OS DO CLIENTE DA CONVERSA (16/11/2026 — o documento "Atendente virtual — Mister Burguer" do
// dono: "separação de acesso: vincular ferramentas ao cliente e à loja no servidor" e "não revele informações de outros
// clientes"), contra o Postgres real:
//  • a lista (`publico/bot/pedidos`) casa pela CHAVE do telefone — antes, os últimos 8 dígitos com `ilike`: o mesmo número
//    noutro DDD trazia os pedidos de outra pessoa; o telefone gravado com +55, parênteses e traço continua casando;
//  • com a FICHA da conversa, o telefone é o dela (nunca o parâmetro que a IA escreve); a ficha de outra empresa não vale;
//  • o status pelo número (`publico/bot/pedido-status`) só acha o pedido do telefone da conversa — o de outro cliente volta
//    como "não achei", igual a um número que não existe (antes, sem casar o telefone, valia o 1º da lista); o Direct (`ig:`)
//    não vê pedido.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedidos-do-robo-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const SENHA = 'senha-do-robo-pedidos';
const CLIENTE = '5521987654321'; // o cliente da conversa
const VIZINHO = '11987654321'; // os mesmos 8 últimos dígitos, outro DDD: outra pessoa

descrever('os pedidos que o robô vê (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const wa = new WhatsappService(db);
  const antes = process.env.BOT_RESOLVER_SECRET;
  const empresas: string[] = [];
  let T = '';
  let INST = '';

  async function pedido(tenant: string, displayId: string, telefone: string) {
    await q(
      `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status)
       values ($1,'cardapio',$2,$3,'Cliente',$4,'retirada','[]'::jsonb,30,'entrega','confirmado')`,
      [tenant, `ref-${randomUUID()}`, displayId, telefone],
    );
  }

  beforeAll(async () => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    T = (await q(`insert into empresa (nome) values ('teste pedidos do robo') returning id`))[0].id;
    empresas.push(T);
    INST = `inst-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Loja', $3)`,
      [T, `tok-${randomUUID()}`, INST],
    );
    await pedido(T, '9101', '21987654321'); // do cliente
    await pedido(T, '9102', '+55 (21) 98765-4321'); // do cliente, escrito de outro jeito
    await pedido(T, '9103', VIZINHO); // do vizinho de outro DDD
  });
  afterAll(async () => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
    for (const t of ['pedido_externo', 'cardapio_config']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
    await q('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.end();
  });

  const numeros = (r: any[]) => r.map((p: any) => String(p.displayId ?? p.numero)).sort();

  it('a lista casa pela CHAVE do telefone: o vizinho de outro DDD não aparece; o número com +55 e máscara aparece', async () => {
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, CLIENTE))).toEqual(['9101', '9102']);
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, '552187654321'))).toEqual(['9101', '9102']); // sem o 9
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, `55${VIZINHO}`))).toEqual(['9103']);
    expect(await wa.pedidosPorTelefoneBot(INST, SENHA, '87654321')).toEqual([]); // sem DDD: não casa ninguém
  });

  it('com a FICHA da conversa, o telefone é o dela — nunca o parâmetro; a ficha de outra empresa não vale', async () => {
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, `55${VIZINHO}`, '', assinarConversa(T, CLIENTE)))).toEqual(['9101', '9102']);
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, `55${VIZINHO}`, '', assinarConversa(randomUUID(), CLIENTE)))).toEqual(['9103']);
    expect(numeros(await wa.pedidosPorTelefoneBot(INST, SENHA, '', '', assinarConversa(T, CLIENTE)))).toEqual(['9101', '9102']);
  });

  it('o status pelo número só acha o pedido do telefone da conversa; o de outro volta como "não achei"', async () => {
    expect(await wa.statusPedidoBot(INST, SENHA, CLIENTE, '9101')).toMatchObject({ encontrado: true, numero: '9101' });
    const doVizinho: any = await wa.statusPedidoBot(INST, SENHA, CLIENTE, '9103');
    const inexistente: any = await wa.statusPedidoBot(INST, SENHA, CLIENTE, '9999');
    expect(doVizinho).toEqual({ encontrado: false, texto: 'Não achei o pedido Nº 9103. Confere o número da senha?' });
    expect(inexistente.encontrado).toBe(false);
    // a ficha manda: o parâmetro com o número do vizinho não abre o pedido dele
    expect(await wa.statusPedidoBot(INST, SENHA, `55${VIZINHO}`, '9101', '', assinarConversa(T, CLIENTE))).toMatchObject({ encontrado: true });
    expect(await wa.statusPedidoBot(INST, SENHA, `55${VIZINHO}`, '9103', '', assinarConversa(T, CLIENTE))).toMatchObject({ encontrado: false });
    // sem telefone nenhum (o fluxo antigo): o mais recente com o número, como antes
    expect(await wa.statusPedidoBot(INST, SENHA, '', '9103')).toMatchObject({ encontrado: true });
  });

  it('o Direct (`ig:`) e o Messenger (`fb:`) não veem pedido pelo número', async () => {
    for (const tel of ['ig:17841400000000001', 'fb:2400000000000001'])
      expect(await wa.statusPedidoBot(INST, SENHA, tel, '9101')).toMatchObject({ encontrado: false });
  });
});
