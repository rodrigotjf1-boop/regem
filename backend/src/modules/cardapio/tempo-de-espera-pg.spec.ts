import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O TEMPO DE ESPERA AGORA (26/11/2026, item 2 do plano das leituras do Mister para o atendente), contra o Postgres real: a
// mediana da cozinha (até ficar pronto ou sair) na última hora × os 7 dias anteriores; a faixa só com a cozinha mais lenta.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('tempo-de-espera-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o tempo de espera agora (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, {} as any, {} as any, { emit: () => true } as any, {} as any);
  const empresas: string[] = [];

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_externo', 'cardapio_config']) await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await q('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(() => CardapioService.esquecerCozinha());

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste tempo de espera') returning id`))[0].id as string;
    empresas.push(t);
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, token, ativo, tempo_entrega_min, tempo_retirada_min) values ($1, $2, true, 40, 20)`, [t, token]);
    return { t, token };
  }
  /** `n` pedidos que levaram `minutos` até ficar prontos (ou sair), terminados há `terminouHaMin`. */
  async function feitos(t: string, n: number, minutos: number, terminouHaMin: number, opts: { porSaida?: boolean; status?: string } = {}) {
    for (let i = 0; i < n; i++)
      await q(
        `insert into pedido_externo (tenant_id, canal, client_ref, tipo, itens, total, forma_pagamento, status, criado_em, pronto_em, despachado_em)
         values ($1, 'cardapio', $2, 'entrega', '[]', 30, 'entrega', $3,
                 now() - make_interval(mins => $4::int + $5::int),
                 case when $6::boolean then null else now() - make_interval(mins => $4::int) end,
                 case when $6::boolean then now() - make_interval(mins => $4::int) else null end)`,
        [t, `ref-${randomUUID()}`, opts.status ?? 'concluido', terminouHaMin, minutos, !!opts.porSaida],
      );
  }

  it('a cozinha mais lenta agora: a faixa da entrega e da retirada, acima do configurado', async () => {
    const l = await loja();
    await feitos(l.t, 30, 14, 600); // o normal: 14 min até pronto (há 10 h e dias atrás)
    await feitos(l.t, 6, 26, 20); // agora: 26 min (terminados há 20 min)
    await feitos(l.t, 2, 26, 30, { porSaida: true }); // os que saíram sem passar por "pronto" contam pela saída
    const a = await cardapio.amostraDaCozinha(l.t, null);
    expect(a).toMatchObject({ nAgora: 8, nNormal: 30 });
    expect(Math.round(a.medianaAgoraMin!)).toBe(26);
    expect(Math.round(a.medianaNormalMin!)).toBe(14);
    expect(await cardapio.tempoDeEsperaAgora(l.token)).toEqual({ entrega: { de: 55, ate: 65 }, retirada: { de: 35, ate: 45 } });
  });

  it('a cozinha no ritmo normal: nada (vale o configurado); cancelado e tempo absurdo não contam', async () => {
    const l = await loja();
    await feitos(l.t, 30, 14, 600);
    await feitos(l.t, 6, 15, 20);
    await feitos(l.t, 5, 60, 10, { status: 'cancelado' }); // cancelado: fora
    await feitos(l.t, 5, 300, 10); // pedido esquecido aberto (300 min): fora
    const a = await cardapio.amostraDaCozinha(l.t, null);
    expect(a.nAgora).toBe(6);
    expect(await cardapio.tempoDeEsperaAgora(l.token)).toEqual({ entrega: null, retirada: null });
  });

  it('pouco histórico: nada; a amostra fica lembrada 2 min (outra conversa não refaz a conta)', async () => {
    const l = await loja();
    await feitos(l.t, 10, 14, 600); // menos de 20 no normal
    await feitos(l.t, 6, 40, 20);
    expect(await cardapio.tempoDeEsperaAgora(l.token)).toEqual({ entrega: null, retirada: null });
    await feitos(l.t, 30, 14, 600); // agora daria; mas a amostra lembrada vale por 2 min
    expect((await cardapio.amostraDaCozinha(l.t, null)).nNormal).toBe(10);
    CardapioService.esquecerCozinha();
    expect((await cardapio.amostraDaCozinha(l.t, null)).nNormal).toBe(40);
  });

  it('o token que não existe não derruba nada: vale o configurado', async () => {
    expect(await cardapio.tempoDeEsperaAgora(`tk-${randomUUID()}`)).toEqual({ entrega: null, retirada: null });
  });
});
