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

  // 26/11/2026: o nome do entregador ia ao robô sem a permissão dele — agora a regra do rastreio
  // (`common/entregador-para-o-cliente.ts`): o da loja só com "compartilhar contato"; o da plataforma, como veio.
  it('o nome do entregador da loja só vai ao robô com a permissão dele; o da plataforma vai como veio', async () => {
    // Sem a tabela da permissão (só da nuvem, mig 208 — o banco do teste é o da loja): ninguém compartilhou, o nome não vai.
    const semTabela = !(await q(`select to_regclass('entregador_preferencia') as t`))[0].t;
    if (semTabela) {
      const T0 = (await q(`insert into empresa (nome) values ('teste entregador sem tabela') returning id`))[0].id;
      empresas.push(T0);
      const INST0 = `inst-${randomUUID()}`;
      await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Loja 0', $3)`, [
        T0,
        `tok-${randomUUID()}`,
        INST0,
      ]);
      await q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status, entregador_id, entregador_nome)
         values ($1,'cardapio',$2,'8001','Cliente','21987654321','entrega','[]'::jsonb,30,'entrega','despachado',$3,'Carlos da loja'),
                ($1,'cardapio',$4,'8002','Cliente','21987654321','entrega','[]'::jsonb,30,'entrega','despachado',null,'Entregador iFood')`,
        [T0, `ref-${randomUUID()}`, randomUUID(), `ref-${randomUUID()}`],
      );
      const sem: any[] = await wa.pedidosPorTelefoneBot(INST0, SENHA, CLIENTE);
      expect(sem.map((p) => [String(p.displayId), p.entregadorNome]).sort()).toEqual([['8001', null], ['8002', 'Entregador iFood']]);
      expect(sem.every((p) => !('entregadorId' in p))).toBe(true); // o id do entregador não sai
      // A tabela como a mig 208 cria (outra suíte do mesmo banco pode criar junto: a repetida não conta).
      await q(
        `create table if not exists entregador_preferencia (colaborador_id uuid primary key, tenant_id uuid not null,
           compartilha_contato boolean not null default false, atualizado_em timestamptz not null default now())`,
      ).catch((e: any) => {
        if (!['42P07', '23505'].includes(e?.code)) throw e;
      });
    }
    const T2 = (await q(`insert into empresa (nome) values ('teste entregador do robo') returning id`))[0].id;
    empresas.push(T2);
    const INST2 = `inst-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Loja 2', $3)`, [
      T2,
      `tok-${randomUUID()}`,
      INST2,
    ]);
    const semPermissao = randomUUID();
    const comPermissao = randomUUID();
    const deOutraEmpresa = randomUUID();
    await q(`insert into entregador_preferencia (colaborador_id, tenant_id, compartilha_contato) values ($1,$2,false), ($3,$2,true), ($4,$5,true)`, [
      semPermissao,
      T2,
      comPermissao,
      deOutraEmpresa,
      T, // a permissão é de OUTRA empresa: não vale aqui
    ]);
    const despachado = (displayId: string, nome: string, entregadorId: string | null) =>
      q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status, entregador_id, entregador_nome)
         values ($1,'cardapio',$2,$3,'Cliente',$4,'entrega','[]'::jsonb,30,'entrega','despachado',$5,$6)`,
        [T2, `ref-${randomUUID()}`, displayId, '21987654321', entregadorId, nome],
      );
    await despachado('8101', 'Carlos da loja', semPermissao);
    await despachado('8102', 'Bruna da loja', comPermissao);
    await despachado('8103', 'Rafa de outra empresa', deOutraEmpresa);
    await despachado('8104', 'Entregador iFood', null);
    const lista: any[] = await wa.pedidosPorTelefoneBot(INST2, SENHA, CLIENTE);
    const nomeDe = (n: string) => lista.find((p) => String(p.displayId) === n)?.entregadorNome ?? null;
    expect(nomeDe('8101')).toBeNull();
    expect(nomeDe('8102')).toBe('Bruna da loja');
    expect(nomeDe('8103')).toBeNull();
    expect(nomeDe('8104')).toBe('Entregador iFood');
    await q(`delete from entregador_preferencia where colaborador_id = any($1::uuid[])`, [[semPermissao, comPermissao, deOutraEmpresa]]);
  });

  // 26/11/2026 — "cadê meu pedido?" com a previsão real (item 1 do plano das leituras do Mister): o pedido em andamento traz
  // o `acompanhar`; a previsão vem do Delivery (a função que ele entrega ao subir); o token e a saída não saem.
  it('o pedido em andamento traz o acompanhar: horas, previsão do Delivery, a parada na saída e o link; o token não sai', async () => {
    const T3 = (await q(`insert into empresa (nome) values ('teste acompanhar do robo') returning id`))[0].id;
    empresas.push(T3);
    const INST3 = `inst-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Loja 3', $3)`, [
      T3,
      `tok-${randomUUID()}`,
      INST3,
    ]);
    const saida = randomUUID();
    // o do cliente: saiu, 2ª parada de uma saída com 3 pedidos (os outros dois são de outras pessoas)
    const meu = (
      await q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status,
           criado_em, confirmado_em, despachado_em, saida_id, ordem_parada, rastreio_token)
         values ($1,'cardapio',$2,'7301','Cliente','21987654321','entrega','[]'::jsonb,30,'entrega','despachado',
           now() - interval '40 minutes', now() - interval '39 minutes', now() - interval '10 minutes', $3, 2, 'rastreio-do-teste')
         returning id`,
        [T3, `ref-${randomUUID()}`, saida],
      )
    )[0].id;
    for (const [d, ordem] of [['7302', 1], ['7303', 3]] as const)
      await q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status, saida_id, ordem_parada)
         values ($1,'cardapio',$2,$3,'Outro','21911112222','entrega','[]'::jsonb,30,'entrega','despachado',$4,$5)`,
        [T3, `ref-${randomUUID()}`, d, saida, ordem],
      );
    const pedidas: string[] = [];
    wa.definirPrevisaoDoPedido(async (_t, id) => {
      pedidas.push(id);
      return '20h35';
    });
    try {
      const lista: any[] = await wa.pedidosPorTelefoneBot(INST3, SENHA, CLIENTE);
      expect(lista.map((p) => String(p.displayId))).toEqual(['7301']);
      const a = lista[0].acompanhar;
      expect(a).toMatchObject({ quemEntrega: 'loja', chegaPorVoltaDe: '20h35', parada: { suaEntrega: 2, de: 3 } });
      expect(a.saiuAs).toMatch(/^\d{2}h\d{2}$/);
      expect(a.aceitoAs).toMatch(/^\d{2}h\d{2}$/);
      expect(a.linkAcompanhar).toMatch(/\/r\/rastreio-do-teste$/);
      expect(pedidas).toEqual([meu]); // a previsão só do pedido que saiu com o entregador da loja
      const json = JSON.stringify(lista);
      for (const proibido of ['rastreioToken', 'saidaId', 'ordemParada', '"raw"', saida]) expect(json).not.toContain(proibido);
    } finally {
      wa.definirPrevisaoDoPedido(async () => null);
    }
    // Sem a função do Delivery (servidor da loja, testes): sem previsão — o robô não inventa.
    const semPrevisao: any[] = await wa.pedidosPorTelefoneBot(INST3, SENHA, CLIENTE);
    expect(semPrevisao[0].acompanhar.chegaPorVoltaDe).toBeNull();
  });
});
