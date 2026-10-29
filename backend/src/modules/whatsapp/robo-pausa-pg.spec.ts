import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import {
  estadoDaPausa,
  minutosDaPausa,
  pausarConversa,
  pausarPeloAtendente,
  pausasDaLoja,
  retomarConversa,
} from './robo-pausa';
import { CardapioService } from '../cardapio/cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ROBÔ CALADO NUMA CONVERSA contra o Postgres real (mig 342): as consultas de robo-pausa.ts, a chave do telefone nas
// duas tabelas (pausa e chamado), o prazo pela hora do banco e o chamado do robô ligado ao pedido do mesmo telefone.
// As tabelas da 342 são só da nuvem: o banco do CI é o de uma loja, então o teste aplica o arquivo da migration (que
// também prova que ele roda duas vezes sem erro).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('robo-pausa-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIGRATION = join(__dirname, '../../../../database/migrations/342_robo_pausa_e_config.sql');

descrever('robô calado numa conversa (Postgres)', () => {
  let pool: Pool;
  let db: any;
  const T = randomUUID();
  const TOKEN = `robo-pausa-${randomUUID().slice(0, 8)}`;
  // O mesmo celular em três formas: com 55 e nono dígito, sem 55, e sem o nono dígito (como o WhatsApp manda).
  const CEL_55 = '5521987654321';
  const CEL_LOCAL = '21987654321';
  const CEL_SEM_9 = '552187654321';
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

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
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    await aplicarMigration();
    await aplicarMigration(); // idempotente
    await q(`insert into empresa (id, nome) values ($1, 'teste robô calado')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1, $2, true)`, [T, TOKEN]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from robo_pausa where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from robo_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    await q(`delete from robo_pausa where tenant_id = $1`, [T]);
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
  });

  it('sem nada gravado: o robô responde e o prazo da loja é 60 min', async () => {
    expect(await minutosDaPausa(db, T)).toBe(60);
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(false);
  });

  it('a pausa gravada com um formato do número vale para os outros (55, sem 55, sem o nono dígito)', async () => {
    await pausarConversa(db, { tenantId: T, telefone: CEL_SEM_9, minutos: 30, motivo: 'manual' });
    for (const tel of [CEL_55, CEL_LOCAL, CEL_SEM_9]) {
      const e = await estadoDaPausa(db, T, tel);
      expect(e.pausado).toBe(true);
      expect(e.motivo).toBe('manual');
    }
    // Uma linha só por número, mesmo pausando de novo por outra forma.
    await pausarConversa(db, { tenantId: T, telefone: CEL_55, minutos: 10, motivo: 'manual' });
    expect(await q(`select count(*)::int as n from robo_pausa where tenant_id = $1`, [T])).toEqual([{ n: 1 }]);
  });

  it('o prazo vem da hora do banco: pausa vencida não cala', async () => {
    await pausarConversa(db, { tenantId: T, telefone: CEL_55, minutos: 30, motivo: 'atendente' });
    await q(`update robo_pausa set ate = now() - interval '1 minute' where tenant_id = $1`, [T]);
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(false);
  });

  it('chamado aberto (gravado com o 55) cala o número; resolvido, o robô volta', async () => {
    const [c] = await q(
      `insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1, 'humano', $2, 'aberto') returning id`,
      [T, CEL_55],
    );
    const e = await estadoDaPausa(db, T, CEL_SEM_9);
    expect(e).toMatchObject({ pausado: true, motivo: 'chamado' });
    expect(e.chamado?.id).toBe(c.id);
    await q(`update atendimento_chamado set status = 'resolvido', resolvido_em = now() where id = $1`, [c.id]);
    expect((await estadoDaPausa(db, T, CEL_LOCAL)).pausado).toBe(false);
  });

  it('resolver o chamado encerra também a pausa do atendente que estava no prazo', async () => {
    await pausarPeloAtendente(db, { tenantId: T, telefone: CEL_LOCAL, motivo: 'atendente' });
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(true);
    await q(
      `insert into atendimento_chamado (tenant_id, tipo, telefone, status, resolvido_em)
       values ($1, 'humano', $2, 'resolvido', now() + interval '1 second')`,
      [T, CEL_55],
    );
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(false);
  });

  it('Retomar vale contra o chamado já aberto', async () => {
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1, 'erro', $2, 'aberto')`, [T, CEL_55]);
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(true);
    await retomarConversa(db, { tenantId: T, telefone: CEL_LOCAL });
    expect((await estadoDaPausa(db, T, CEL_55)).pausado).toBe(false);
  });

  it('o atendente responder não encurta o "até eu retomar" de quem pausou', async () => {
    await pausarConversa(db, { tenantId: T, telefone: CEL_55, minutos: null, motivo: 'manual' });
    await pausarPeloAtendente(db, { tenantId: T, telefone: CEL_55, motivo: 'atendente' });
    expect(await estadoDaPausa(db, T, CEL_55)).toMatchObject({ pausado: true, ate: null, motivo: 'manual' });
  });

  it('prazo 0 da loja: o atendente respondeu → calado até alguém retomar', async () => {
    await q(`insert into robo_config (tenant_id, pausa_minutos) values ($1, 0)`, [T]);
    expect(await minutosDaPausa(db, T)).toBe(0);
    await pausarPeloAtendente(db, { tenantId: T, telefone: CEL_55, motivo: 'app' });
    expect(await estadoDaPausa(db, T, CEL_55)).toMatchObject({ pausado: true, ate: null, motivo: 'app' });
  });

  it('a lista da caixa traz pausa e chamado de cada número, pela chave', async () => {
    await pausarConversa(db, { tenantId: T, telefone: CEL_55, minutos: 30, motivo: 'atendente' });
    await q(`insert into atendimento_chamado (tenant_id, tipo, telefone, status) values ($1, 'mudanca', '21912345678', 'aberto')`, [T]);
    const mapa = await pausasDaLoja(db, T);
    expect(mapa.get('21987654321')).toMatchObject({ pausado: true, motivo: 'atendente' });
    expect(mapa.get('21912345678')).toMatchObject({ pausado: true, motivo: 'chamado' });
    expect(mapa.get('21912345678')?.chamado?.tipo).toBe('mudanca');
  });

  it('a constraint recusa motivo fora da lista e prazo da loja fora de 0–1440', async () => {
    await expect(
      q(`insert into robo_pausa (tenant_id, telefone, telefone_chave, motivo) values ($1, '1', '1', 'qualquer')`, [T]),
    ).rejects.toThrow();
    await expect(q(`insert into robo_config (tenant_id, pausa_minutos) values ($1, 5000)`, [T])).rejects.toThrow();
  });
});

descrever('chamado do robô ligado ao pedido (Postgres)', () => {
  let pool: Pool;
  let cardapio: CardapioService;
  const T = randomUUID();
  const TOKEN = `robo-chamado-${randomUUID().slice(0, 8)}`;
  const abertos: any[] = [];
  const antes = process.env.BOT_RESOLVER_SECRET;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    process.env.BOT_RESOLVER_SECRET = 'senha-do-robo-teste';
    pool = new Pool({ connectionString: URL_PG });
    const atendimento: any = { abrir: async (_t: string, _u: any, dto: any) => (abertos.push(dto), { ok: true, id: 'x' }) };
    const u: any = {};
    cardapio = new CardapioService(drizzle(pool, { schema }) as any, u, u, atendimento, u, u, u, u);
    await q(`insert into empresa (id, nome) values ($1, 'teste chamado do robô')`, [T]);
    await q(`insert into cardapio_config (tenant_id, token, ativo) values ($1, $2, true)`, [T, TOKEN]);
  });
  afterAll(async () => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
    if (!pool) return;
    await q(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(() => {
    abertos.length = 0;
  });

  it('sem a senha do robô: recusa (o chamado cala o robô no número)', async () => {
    await expect(cardapio.abrirAtendimento(TOKEN, { telefone: '21987654321' }, 'chute')).rejects.toThrow('Não autorizado');
    expect(abertos).toHaveLength(0);
  });

  it('liga ao pedido citado SÓ se for do mesmo telefone', async () => {
    const [meu] = await q(
      `insert into pedido_externo (tenant_id, canal, status, cliente_telefone, display_id)
       values ($1, 'regem', 'confirmado', '21987654321', '4471') returning id`,
      [T],
    );
    await q(
      `insert into pedido_externo (tenant_id, canal, status, cliente_telefone, display_id)
       values ($1, 'regem', 'confirmado', '21911112222', '4472')`,
      [T],
    );
    await cardapio.abrirAtendimento(TOKEN, { tipo: 'cancelamento', telefone: '552187654321', pedidoNumero: '4471' }, 'senha-do-robo-teste');
    expect(abertos[0]).toMatchObject({ pedidoId: meu.id, pedidoNumero: '4471' });
    // O número de OUTRO cliente não liga (o chamado sai sem pedido).
    await cardapio.abrirAtendimento(TOKEN, { tipo: 'cancelamento', telefone: '21987654321', pedidoNumero: '4472' }, 'senha-do-robo-teste');
    expect(abertos[1].pedidoId).toBeUndefined();
  });

  it('sem número citado: o pedido em andamento mais recente do telefone', async () => {
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    await q(
      `insert into pedido_externo (tenant_id, canal, status, cliente_telefone, display_id, criado_em)
       values ($1, 'regem', 'concluido', '21987654321', '10', now() - interval '1 hour')`,
      [T],
    );
    const [andamento] = await q(
      `insert into pedido_externo (tenant_id, canal, status, cliente_telefone, display_id)
       values ($1, 'regem', 'despachado', '5521987654321', '11') returning id`,
      [T],
    );
    await cardapio.abrirAtendimento(TOKEN, { tipo: 'erro', telefone: '21987654321' }, 'senha-do-robo-teste');
    expect(abertos[0]).toMatchObject({ pedidoId: andamento.id, pedidoNumero: '11' });
  });
});
