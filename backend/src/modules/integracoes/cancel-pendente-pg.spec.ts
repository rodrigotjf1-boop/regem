import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { marcarCancelPendente, tirarCancelPendente } from './cancel-pendente';
import { mesclarNoConfigDaIntegracao } from './config-da-integracao';
import { IfoodService } from './ifood/ifood.service';
import { CardapioWebService } from './cardapio-web/cardapio-web.service';
import { AnotaAiService } from './anotaai/anotaai.service';
import { Food99Service } from './food99/food99.service';
import { OpenDeliveryService } from './open-delivery/open-delivery.service';
import { DeliveryService } from '../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os canais sem rede: o token devolve um de mentira e a lista de pedidos vem vazia.
const mockFetch = async (url: string) => {
  const corpo = String(url).includes('/oauth/token') ? { access_token: 'tk-novo', refresh_token: 'refresh-2', expires_in: 7200 } : [];
  return { ok: true, status: 200, json: async () => corpo, text: async () => JSON.stringify(corpo) };
};
jest.mock('../../common/fetch-externo', () => ({
  ...jest.requireActual('../../common/fetch-externo'),
  fetchExterno: (url: string) => mockFetch(url),
}));

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

// A configuração da integração com vários escritores (ERR-475): o fim de um ciclo de leitura, a renovação do token, o
// vínculo da loja e a tela gravam SÓ as próprias chaves — o que outro escritor gravou NO MEIO fica. Cada teste força a
// gravação do outro escritor entre a leitura da cópia e a gravação de quem está sendo testado.
descrever('a configuração da integração: cada escritor grava só a sua chave (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const log = { log() {}, warn() {}, error() {}, debug() {} };
  const empresas: string[] = [];
  const config = async (id: string) => (await q(`select config from integracao where id = $1`, [id]))[0].config;
  async function integracao(canal: string, cfg: Record<string, unknown>, extra: Record<string, string> = {}) {
    const [{ id: tenant }] = await q(`insert into empresa (nome) values ($1) returning id`, [`teste config ${canal}`]);
    empresas.push(tenant);
    const [{ id }] = await q(
      `insert into integracao (tenant_id, canal, ativo, token, merchant_id, client_id, client_secret, config)
       values ($1, $2, true, $3, $4, $5, $6, $7::jsonb) returning id`,
      [tenant, canal, extra.token ?? 'tk-velho', extra.merchant ?? null, extra.clientId ?? null, extra.clientSecret ?? null, JSON.stringify(cfg)],
    );
    return { tenant, id };
  }

  afterAll(async () => {
    for (const t of empresas) {
      await q(`delete from integracao where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });

  it('o ajudante mescla as chaves, tira as pedidas, grava as colunas junto e devolve o config; sem a linha, null', async () => {
    const { id } = await integracao('cardapio_web', { env: 'sandbox', pendingState: 'abc', lastPollAt: 'x' });
    const c = await mesclarNoConfigDaIntegracao(db, id, { tokenExp: 5, refreshToken: null }, { tirar: ['pendingState'], colunas: { token: 'tk-x', ativo: false } });
    expect(c).toEqual({ env: 'sandbox', lastPollAt: 'x', tokenExp: 5, refreshToken: null });
    expect((await q(`select token, ativo from integracao where id = $1`, [id]))[0]).toEqual({ token: 'tk-x', ativo: false });
    expect(await mesclarNoConfigDaIntegracao(db, '00000000-0000-0000-0000-000000000000', { a: 1 })).toBeNull();
  });

  it('Cardápio Web: o token renovado no meio do ciclo fica — o fim do ciclo grava só o cursor (antes devolvia o refreshToken velho)', async () => {
    const velho = new Date(Date.now() - 10 * 60000).toISOString();
    const { tenant, id } = await integracao('cardapio_web', { env: 'sandbox', refreshToken: 'refresh-1', tokenExp: 1, lastPollAt: velho });
    const svc = new CardapioWebService(db, { ingest: async () => {}, refletirStatusExterno: async () => {} } as any);
    (svc as any).logger = log;
    // A listagem relê a integração e, com o token vencido, renova: grava refresh-2 e o tokenExp novo no meio do ciclo.
    await svc.sincronizar(tenant);
    const c = await config(id);
    expect({ refresh: c.refreshToken, venceDepois: c.tokenExp > Date.now(), cursorAndou: c.lastPollAt !== velho, env: c.env }).toEqual({
      refresh: 'refresh-2',
      venceDepois: true,
      cursorAndou: true,
      env: 'sandbox',
    });
    expect((await q(`select token from integracao where id = $1`, [id]))[0].token).toBe('tk-novo');
  });

  it('Anota AI: o pedido de integração que a distribuição conclui durante o ciclo continua concluído (antes voltava a "pendente")', async () => {
    const { tenant, id } = await integracao('anotaai', { pedidoIntegracao: { status: 'pendente', solicitadoEm: '2026-11-15T10:00:00Z' }, seen: ['a0'] });
    const svc = new AnotaAiService(db, { ingest: async () => {}, refletirStatusExterno: async () => {} } as any, { emit() {} } as any);
    (svc as any).logger = log;
    // Durante a listagem, a distribuição marca o pedido como conectado no console (como `resolverPedidoIntegracao`).
    (svc as any).listar = async () => {
      await q(`update integracao set config = jsonb_set(config, '{pedidoIntegracao,status}', '"conectado"'::jsonb) where id = $1`, [id]);
      return [];
    };
    await svc.sincronizar(tenant);
    const c = await config(id);
    expect(c.pedidoIntegracao).toEqual({ status: 'conectado', solicitadoEm: '2026-11-15T10:00:00Z' });
    expect(c.seen).toEqual(['a0']);
    expect(typeof c.lastPollAt).toBe('string');
  });

  it('99: o vínculo da loja não apaga o cancelamento pendente gravado durante a consulta à 99; recusar tira só o vínculo', async () => {
    const { tenant, id } = await integracao('99food', { bindPending: 123, situacaoDaLoja: { aberta: true } });
    const svc: any = Object.create(Food99Service.prototype);
    svc.db = db;
    svc.logger = log;
    const copia = (await q(`select * from integracao where id = $1`, [id]))[0];
    svc.tenantBindPendente = async () => copia; // a cópia lida ANTES da consulta à 99
    svc.shopDetail = async () => {
      await marcarCancelPendente(db, id, 'ped-99', { reasonId: 1010 }); // o poller grava no meio
      return { shop_name: 'Loja da esquina', shop_addr: 'Rua A, 1' };
    };
    await svc.tratarBind('{"bindStatus":"bind","appShopIDList":["shop-1"]}', true);
    let c = await config(id);
    expect(c).toMatchObject({ pendingBind: { appShopId: 'shop-1', nome: 'Loja da esquina', addr: 'Rua A, 1' }, bindPending: null, situacaoDaLoja: { aberta: true } });
    expect(c.pendingCancels['ped-99']).toEqual({ reasonId: 1010, attempts: 1 });
    await svc.recusarBind(tenant);
    c = await config(id);
    expect(c.pendingBind).toBeNull();
    expect(Object.keys(c.pendingCancels)).toEqual(['ped-99']);
  });

  it('Open Delivery: a renovação do token não apaga a chave gravada depois que a cópia foi lida', async () => {
    const { tenant, id } = await integracao('open_delivery', { tokenExp: 1 }, { merchant: 'https://od.exemplo.com.br', clientId: 'cli', clientSecret: 'seg' });
    const svc = new OpenDeliveryService(db);
    (svc as any).logger = log;
    const ig = (await svc.integracaoDoTenant(tenant, 'open_delivery'))!;
    await q(`update integracao set config = config || '{"cor": "#E2A340"}'::jsonb where id = $1`, [id]); // a tela salva no meio
    expect(await (svc as any).token(ig)).toBe('tk-novo');
    const c = await config(id);
    expect({ cor: c.cor, venceDepois: c.tokenExp > Date.now() }).toEqual({ cor: '#E2A340', venceDepois: true });
    expect(ig.config.cor).toBe('#E2A340'); // a cópia de quem chamou sai atualizada pelo banco
  });

  it('iFood e tela de Integrações: pedir, desligar e trocar a cor mexem só na própria chave; a cor vazia sai', async () => {
    const { tenant, id } = await integracao('ifood', { pendingCancels: { 'ped-1': { attempts: 1 } }, pedidoIntegracao: { status: 'pendente', solicitadoEm: 'antes' } });
    const ifood = new IfoodService(db);
    (ifood as any).logger = log;
    (ifood as any).alertarDistribuicao = async () => {};
    await ifood.solicitarIntegracao(tenant, null);
    let c = await config(id);
    expect(c.pedidoIntegracao).toEqual({ status: 'pendente', solicitadoEm: 'antes' }); // já pendente: fica como estava
    const delivery: any = Object.create(DeliveryService.prototype);
    delivery.db = db;
    await delivery.salvarIntegracao(tenant, { canal: 'ifood', cor: '#123456' });
    expect((await config(id)).cor).toBe('#123456');
    // O token do iFood não se regrava pela tela (é do fluxo próprio): o renovado no meio fica.
    await q(`update integracao set token = 'tk-renovado' where id = $1`, [id]);
    await delivery.salvarIntegracao(tenant, { canal: 'ifood', cor: '' });
    c = await config(id);
    expect('cor' in c).toBe(false);
    expect((await q(`select token from integracao where id = $1`, [id]))[0].token).toBe('tk-renovado');
    await ifood.desativarIntegracao(tenant);
    c = await config(id);
    expect(c.pedidoIntegracao.status).toBe('pendente_remocao');
    expect(c.pendingCancels).toEqual({ 'ped-1': { attempts: 1 } });
  });
});
