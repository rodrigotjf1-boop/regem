import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CloudFallbackProcessor } from './cloud-fallback.processor';
import { EdgePedidosProcessor } from './edge-pedidos.processor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O resgate da NUVEM (pedido online preso porque o servidor local caiu) só pode agir quando
// o servidor da loja está de fato fora — e só no caso para o qual existe: loja COM servidor
// local. Postgres real (a decisão é uma consulta).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cloud-fallback.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('resgate da nuvem de pedido online preso', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const aceitos: string[] = [];
  let proc: CloudFallbackProcessor;
  const antes = process.env.EDGE_MODE;

  const empresa = async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste fallback')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    return { t, u };
  };
  const pedidoNovo = async (t: string, u: string, canal = 'ifood') =>
    (await q(`insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, criado_em, itens, total)
              values ($1,$2,$3,$4,'novo', now() - interval '6 minutes', '[]'::jsonb, 10) returning id`,
      [t, u, canal, randomUUID()])).rows[0].id as string;

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    pool = new Pool({ connectionString: URL_PG });
    // Tabelas só-nuvem ausentes no banco do CI (montado como servidor local).
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
    proc = new CloudFallbackProcessor(drizzle(pool, { schema }) as any, {
      // Como o aceitar real: o pedido sai de 'novo' (senão fica elegível para sempre e,
      // no banco compartilhado do CI, empurra os pedidos dos testes para fora do limit 50).
      aceitar: async (_t: string, _a: any, id: string) => {
        aceitos.push(id);
        await q("update pedido_externo set status = 'confirmado' where id = $1", [id]);
      },
      // "Produz só depois do pagamento" (totem em dinheiro) — a configuração padrão das lojas.
      totemAposPagamento: async () => true,
    } as any);
  });
  const criadas: string[] = [];
  afterAll(async () => {
    if (antes !== undefined) process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of criadas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
      await q('delete from edge_status where tenant_id = $1', [t]).catch(() => {});
      await q('delete from edge_heartbeat where tenant_id = $1', [t]).catch(() => {});
      await q('delete from equipamento where tenant_id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  // Servidor de LOJA = já sincronizou (last_push_*). A credencial do GoGeM e a sobra de instalação
  // que nunca sincronizou também são `servidor_local`, mas não são servidor de loja (ERR-108).
  const servidorLocal = (t: string, u: string | null, o: { integrador?: string; semPush?: boolean } = {}) =>
    q(`insert into equipamento (tenant_id, unidade_id, nome, token, tipo, ativo, integrador, last_push_ts)
       values ($1,$2,'Servidor',$3,'servidor_local',true,$4, case when $5 then null else now() - interval '1 day' end)`,
      [t, u, 'tok-' + randomUUID(), o.integrador ?? null, !!o.semPush]);

  it('servidor local VIVO (edge_status agora; edge_heartbeat amostrado há 20 min) → NÃO resgata', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now())`, [randomUUID(), t, u]);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, recebido_em) values ($1,$2, now() - interval '20 minutes')`, [t, u]);
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  // ERR-132: o servidor em laço na primeira carga batia a cada ciclo com o sync falhando — a
  // nuvem o dava por vivo e segurava os pedidos online dele.
  const statusComFalha = (t: string, u: string, saude: any) =>
    q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, estado, saude, recebido_em)
       values ($1,$2,$3,'1.30.2','erro',$4::jsonb, now())`, [randomUUID(), t, u, JSON.stringify(saude)]);

  it('servidor que BATE mas não sincroniza há 20 min → resgata', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await statusComFalha(t, u, { syncFalhandoDesde: new Date(Date.now() - 20 * 60000).toISOString() });
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).toContain(id);
  });

  it('falha de sync há 2 min (pode ser só um ciclo) → ainda NÃO resgata', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await statusComFalha(t, u, { syncFalhandoDesde: new Date(Date.now() - 2 * 60000).toISOString() });
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('valor estranho na saúde não quebra o resgate: conta como vivo, como antes', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await statusComFalha(t, u, { syncFalhandoDesde: 'ontem' });
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('loja SEM servidor local, pedido do iFood aguardando aceite há 6 min → NÃO aceita pela loja', async () => {
    const { t, u } = await empresa();
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('loja COM servidor local e SEM batida (caiu) → resgata (é o caso para o qual o resgate existe)', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now() - interval '10 minutes')`, [randomUUID(), t, u]);
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).toContain(id);
  });

  // Auditoria do KDS (11/11/2026): o resgate aceitava o que a loja não aceitaria — a cozinha recebia sem pagamento.
  it('servidor caiu: Pix/cartão online ainda NÃO pago e o sinal pendente NÃO são resgatados (esperam o pagamento)', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now() - interval '10 minutes')`, [randomUUID(), t, u]);
    const pix = await pedidoNovo(t, u, 'cardapio');
    await q(`update pedido_externo set status_pagamento = 'aguardando' where id = $1`, [pix]);
    const sinal = await pedidoNovo(t, u, 'cardapio');
    await q(`update pedido_externo set sinal_status = 'pendente' where id = $1`, [sinal]);
    const pago = await pedidoNovo(t, u, 'cardapio');
    await q(`update pedido_externo set status_pagamento = 'aprovado', pago = true where id = $1`, [pago]);
    await proc.processar();
    expect(aceitos).not.toContain(pix);
    expect(aceitos).not.toContain(sinal);
    expect(aceitos).toContain(pago);
  });

  it('servidor caiu: totem em DINHEIRO numa loja que "produz só depois de pagar" NÃO vai à cozinha pelo resgate', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now() - interval '10 minutes')`, [randomUUID(), t, u]);
    const dinheiro = await pedidoNovo(t, u, 'totem');
    await q(`update pedido_externo set pago = false, forma_pagamento = 'dinheiro' where id = $1`, [dinheiro]);
    const totemPago = await pedidoNovo(t, u, 'totem');
    await q(`update pedido_externo set pago = true, forma_pagamento = 'pix' where id = $1`, [totemPago]);
    await proc.processar();
    expect(aceitos).not.toContain(dinheiro);
    expect(aceitos).toContain(totemPago);
  });

  it('loja que só usa o GoGeM na nuvem: a credencial dele NÃO é servidor de loja → NÃO aceita no lugar da loja', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u, { integrador: 'gogem', semPush: true });
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id); // antes: "servidor morto" → a nuvem confirmava no iFood
  });

  it('sobra de instalação que nunca sincronizou NÃO é servidor de loja → NÃO aceita', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u, { semPush: true });
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('servidor da MATRIZ vivo não cobre a FILIAL caída', async () => {
    const { t, u } = await empresa();
    const filial = randomUUID();
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Filial')`, [filial, t]);
    await servidorLocal(t, u);
    await servidorLocal(t, filial);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now())`, [randomUUID(), t, u]);
    const id = await pedidoNovo(t, filial);
    await proc.processar();
    expect(aceitos).toContain(id);
  });

  // ── o pedido que falha sempre não toma o lote (V84, ERR-493) ──
  /** Um processo novo (a espera por falha é dele), com o aceite que falha para os ids de `falham`. */
  const processoCom = (falham: Set<string>, chamados: string[]) =>
    new CloudFallbackProcessor(drizzle(pool, { schema }) as any, {
      aceitar: async (_t: string, _a: any, id: string) => {
        chamados.push(id);
        if (falham.has(id)) throw new Error('produto do pedido não existe mais');
        await q("update pedido_externo set status = 'confirmado' where id = $1", [id]);
      },
      totemAposPagamento: async () => true,
    } as any);
  const lojaCaida = async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now() - interval '10 minutes')`, [randomUUID(), t, u]);
    return { t, u };
  };
  const pedidoDeHa = async (t: string, u: string, ha: string) =>
    (await q(`insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, criado_em, itens, total)
              values ($1,$2,'ifood',$3,'novo', now() - $4::interval, '[]'::jsonb, 10) returning id`, [t, u, randomUUID(), ha])).rows[0].id as string;

  it('o resgate que falha sempre sai do lote na 3ª falha: o pedido bom atrás dele é resgatado, e ele segue "novo"', async () => {
    const { t, u } = await lojaCaida();
    const ruins = [await pedidoDeHa(t, u, '3 hours'), await pedidoDeHa(t, u, '2 hours'), await pedidoDeHa(t, u, '1 hour')];
    const bom = await pedidoDeHa(t, u, '6 minutes');
    const chamados: string[] = [];
    const p = processoCom(new Set(ruins), chamados);
    (p as any).logger = { warn: () => undefined, log: () => undefined };
    p.lote = 3;
    await p.processar([t]); // os três mais antigos: 1ª falha
    await p.processar([t]); // 2ª falha (a falha passageira teria passado aqui)
    expect(chamados).toEqual([...ruins, ...ruins]);
    await p.processar([t]); // 3ª falha: entram em espera
    await p.processar([t]); // o lote agora é do pedido bom
    expect(chamados).toEqual([...ruins, ...ruins, ...ruins, bom]);
    const fica = (await q(`select id, status from pedido_externo where tenant_id = $1 order by criado_em`, [t])).rows;
    expect(fica.map((x: any) => x.status)).toEqual(['novo', 'novo', 'novo', 'confirmado']);
    // Em espera, não são tentados de novo a cada ciclo.
    await p.processar([t]);
    expect(chamados).toHaveLength(10);
  });

  it('a falha passageira não atrasa: o pedido que falhou uma vez é resgatado no ciclo seguinte', async () => {
    const { t, u } = await lojaCaida();
    const id = await pedidoDeHa(t, u, '6 minutes');
    const falham = new Set([id]);
    const chamados: string[] = [];
    const p = processoCom(falham, chamados);
    (p as any).logger = { warn: () => undefined, log: () => undefined };
    await p.processar([t]);
    falham.clear(); // o banco voltou
    await p.processar([t]);
    expect(chamados).toEqual([id, id]);
    expect((await q(`select status from pedido_externo where id = $1`, [id])).rows[0].status).toBe('confirmado');
  });

  it('quem espera há mais tempo primeiro; o parado há mais de 12 h (pendência antiga) por último', async () => {
    const { t, u } = await lojaCaida();
    const antigo = await pedidoDeHa(t, u, '13 hours');
    const novo = await pedidoDeHa(t, u, '6 minutes');
    const maisVelhoDeHoje = await pedidoDeHa(t, u, '40 minutes');
    const chamados: string[] = [];
    const p = processoCom(new Set(), chamados);
    (p as any).logger = { warn: () => undefined, log: () => undefined };
    p.lote = 1;
    for (let i = 0; i < 3; i++) await p.processar([t]);
    expect(chamados).toEqual([maisVelhoDeHoje, novo, antigo]);
  });
});

// O MESMO NO SERVIDOR DA LOJA (EdgePedidosProcessor): o aceite que falha sempre não toma o lote de 50 nem repete o erro a
// cada 15 s. A loja do teste é só dela (`EDGE_UNIDADE_ID`), porque o banco do CI é compartilhado.
descrever('aceite no servidor da loja: o pedido que falha sempre não toma o lote', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const antes = { edge: process.env.EDGE_MODE, loja: process.env.EDGE_UNIDADE_ID };
  const criadas: string[] = [];

  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
  });
  afterAll(async () => {
    for (const [k, v] of [['EDGE_MODE', antes.edge], ['EDGE_UNIDADE_ID', antes.loja]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    for (const t of criadas) await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
    await pool.end();
  });

  it('na 3ª falha o pedido sai do lote e o bom atrás dele é aceito; o antigo de mais de 12 h vai por último', async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste aceite na loja')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    const pedido = async (ha: string) =>
      (await q(`insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, criado_em, itens, total)
                values ($1,$2,'ifood',$3,'novo', now() - $4::interval, '[]'::jsonb, 10) returning id`, [t, u, randomUUID(), ha])).rows[0].id as string;
    const antigo = await pedido('13 hours');
    const ruins = [await pedido('30 minutes'), await pedido('20 minutes')];
    const bom = await pedido('1 minute');
    const falham = new Set(ruins);
    const chamados: string[] = [];
    process.env.EDGE_MODE = 'true';
    process.env.EDGE_UNIDADE_ID = u;
    const p = new EdgePedidosProcessor(drizzle(pool, { schema }) as any, {
      aceitar: async (_t: string, _a: any, id: string) => {
        chamados.push(id);
        if (falham.has(id)) throw new Error('produto do pedido não existe mais');
        await q("update pedido_externo set status = 'confirmado' where id = $1", [id]);
      },
      totemAposPagamento: async () => true,
    } as any);
    (p as any).logger = { warn: () => undefined, log: () => undefined, error: () => undefined };
    p.lote = 2;
    await p.processar(); // os dois de hoje mais antigos: 1ª falha
    await p.processar(); // 2ª falha
    await p.processar(); // 3ª falha: entram em espera
    expect(chamados).toEqual([...ruins, ...ruins, ...ruins]);
    await p.processar(); // agora o bom (de hoje) e o antigo de 13 h, nessa ordem
    expect(chamados.slice(6)).toEqual([bom, antigo]);
    const fica = (await q(`select status from pedido_externo where id = any($1::uuid[]) order by criado_em`, [[...ruins]])).rows;
    expect(fica.map((x: any) => x.status)).toEqual(['novo', 'novo']);
    await p.processar(); // em espera: ninguém é tentado de novo
    expect(chamados).toHaveLength(8);
  });
});
