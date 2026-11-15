import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { marcarCancelPendente, tirarCancelPendente } from './cancel-pendente';
import { IfoodService } from './ifood/ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O cancelamento pendente por pedido (ERR-474), contra o Postgres: cada operação grava só a entrada daquele pedido em
// `integracao.config.pendingCancels` — nem o pendente de outro pedido nem outra chave da config se perdem. A tabela
// `integracao` é do banco base (existe no banco de loja do CI): nenhuma migration a aplicar.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cancel-pendente-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o cancelamento pendente por pedido (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  let empresa = '';
  let ig = '';
  const config = async () => (await q(`select config from integracao where id = $1`, [ig]))[0].config;

  beforeAll(async () => {
    [{ id: empresa }] = await q(`insert into empresa (nome) values ('teste cancel pendente') returning id`);
    [{ id: ig }] = await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, 'ifood', true, $2::jsonb) returning id`, [
      empresa,
      JSON.stringify({ tokenExp: 1, avaliacoesNaFila: true }),
    ]);
  });
  afterAll(async () => {
    await q(`delete from integracao where tenant_id = $1`, [empresa]).catch(() => {});
    await q(`delete from empresa where id = $1`, [empresa]).catch(() => {});
    await pool.end();
  });

  it('dois pedidos cancelados ao mesmo tempo: os dois ficam pendentes (antes, o segundo apagava o primeiro)', async () => {
    await Promise.all([marcarCancelPendente(db, ig, 'pedido-a', { motivo: 'cliente desistiu' }), marcarCancelPendente(db, ig, 'pedido-b', { motivo: 'sem entregador' })]);
    const c = await config();
    expect(c.pendingCancels).toEqual({ 'pedido-a': { motivo: 'cliente desistiu', attempts: 1 }, 'pedido-b': { motivo: 'sem entregador', attempts: 1 } });
    // As outras chaves da config ficam como estavam.
    expect(c).toMatchObject({ tokenExp: 1, avaliacoesNaFila: true });
  });

  it('a nova tentativa soma no banco e mantém o motivo; o que outro escritor gravou no meio fica', async () => {
    // Outro escritor (a tela, a saúde da integração) grava uma chave entre a leitura e a gravação do cancelamento.
    await q(`update integracao set config = config || '{"semRespostaDesde": "2026-11-15T10:00:00Z"}'::jsonb where id = $1`, [ig]);
    const pend = await marcarCancelPendente(db, ig, 'pedido-a', {});
    expect(pend['pedido-a']).toEqual({ motivo: 'cliente desistiu', attempts: 2 });
    const c = await config();
    expect(c.semRespostaDesde).toBe('2026-11-15T10:00:00Z');
    expect(c.pendingCancels['pedido-b']).toEqual({ motivo: 'sem entregador', attempts: 1 });
    // O motivo novo (a 99 manda o reasonId) entra; o vazio não apaga o que havia.
    expect((await marcarCancelPendente(db, ig, 'pedido-b', { motivo: null, reasonId: 1010 }))['pedido-b']).toEqual({ motivo: 'sem entregador', reasonId: 1010, attempts: 2 });
  });

  it('tirar leva só aquele pedido; tirar o que não está pendente não mexe em nada', async () => {
    const pend = await tirarCancelPendente(db, ig, 'pedido-a');
    expect(Object.keys(pend ?? {})).toEqual(['pedido-b']);
    expect(await tirarCancelPendente(db, ig, 'pedido-que-nao-existe')).toBeNull();
    const c = await config();
    expect(Object.keys(c.pendingCancels)).toEqual(['pedido-b']);
    expect(c).toMatchObject({ tokenExp: 1, avaliacoesNaFila: true, semRespostaDesde: '2026-11-15T10:00:00Z' });
  });

  it('pelo serviço do iFood: dois cancelamentos que o iFood recusou ao mesmo tempo ficam os dois; a reconciliação reenvia cada um', async () => {
    const [{ id: loja }] = await q(`insert into empresa (nome) values ('teste cancel ifood') returning id`);
    try {
      const [{ id: igIfood }] = await q(
        `insert into integracao (tenant_id, canal, ativo, merchant_id, client_id, client_secret, config)
         values ($1, 'ifood', true, 'loja-teste', 'app-teste', 'segredo-teste', '{"avaliacoesNaFila": true}'::jsonb) returning id`,
        [loja],
      );
      const ifood = new IfoodService(db);
      let aceita = false;
      const enviados: string[] = [];
      jest.spyOn(ifood, 'cancelar').mockImplementation(async (_ig: any, orderId: string) => {
        enviados.push(orderId);
        return aceita;
      });
      // Os dois pedidos cancelados juntos no quadro, com o iFood fora: cada um lê a integração e marca o pendente.
      expect(await Promise.all([ifood.cancelarComBlindagem(loja, 'ped-1', 'cliente desistiu'), ifood.cancelarComBlindagem(loja, 'ped-2', 'sem entregador')])).toEqual([false, false]);
      const c = (await q(`select config from integracao where id = $1`, [igIfood]))[0].config;
      expect(Object.keys(c.pendingCancels).sort()).toEqual(['ped-1', 'ped-2']);
      expect(c.avaliacoesNaFila).toBe(true);
      // A reconciliação com o iFood ainda fora: as tentativas somam; com ele de volta, cada um sai.
      const ig1 = (await ifood.integracaoDoTenant(loja))!;
      expect(await ifood.reconciliarCancels(ig1)).toBe(0);
      expect((await q(`select config -> 'pendingCancels' as p from integracao where id = $1`, [igIfood]))[0].p).toEqual({
        'ped-1': { motivo: 'cliente desistiu', attempts: 2 },
        'ped-2': { motivo: 'sem entregador', attempts: 2 },
      });
      aceita = true;
      const ig2 = (await ifood.integracaoDoTenant(loja))!;
      expect(await ifood.reconciliarCancels(ig2)).toBe(2);
      expect((await q(`select config from integracao where id = $1`, [igIfood]))[0].config).toEqual({ avaliacoesNaFila: true, pendingCancels: {} });
    } finally {
      await q(`delete from integracao where tenant_id = $1`, [loja]).catch(() => {});
      await q(`delete from empresa where id = $1`, [loja]).catch(() => {});
    }
  });

  it('a config sem pendentes (ou vazia) também funciona', async () => {
    const [{ id: outra }] = await q(`insert into integracao (tenant_id, canal, ativo, config) values ($1, '99food', true, '{}'::jsonb) returning id`, [empresa]);
    expect(await tirarCancelPendente(db, outra, 'x')).toBeNull();
    expect(await marcarCancelPendente(db, outra, '123', { reasonId: 1010, reason: 'teste' })).toEqual({ 123: { reasonId: 1010, reason: 'teste', attempts: 1 } });
  });
});
