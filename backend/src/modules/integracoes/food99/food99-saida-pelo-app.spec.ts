import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';
import { FiscalService } from '../../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../../producao-pedido/producao-pedido.service';
import { VendasService } from '../../vendas/vendas.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { Food99Service } from './food99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTREGA DA LOJA DESPACHADA PELO APP DA 99 (09/11/2026, pedido 436004): a 99 não tem webhook disso, o pedido
// ficava "em produção" no Regem e o aviso "saiu" do chat não nascia. Contra o Postgres de verdade (V6), com o
// DeliveryService de verdade e a API da 99 falsa (`order/detail`):
//  • o verificador pergunta só pelos pedidos de ENTREGA DA LOJA abertos (confirmado/pronto, até 4 h); 400/500 =
//    saiu → "em rota" pelo mesmo reflexo do canal, com a logística anotada (o Regem não manda o telefone da loja por
//    cima do entregador que a equipe pôs no app); 200 = fica; falha da API = fica;
//  • cada pedido no máximo 1×/min; o que a 99 ainda não despachou não toma a vez dos outros (V84);
//  • o reflexo grava condicional: se o painel concluiu entre a leitura e a gravação, nada regride (V43).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('food99-saida-pelo-app.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('99 — a saída da entrega da loja pelo app da 99 (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const beneficio = new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(db, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any);
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const empresas: string[] = [];

  // a API da 99 falsa: o estado de cada pedido no `order/detail` e quem foi perguntado
  let estadoNa99: Record<string, number | null> = {};
  let perguntas: string[] = [];
  let enviados: string[] = [];

  function svc99(tenant: string): { s: any; ig: any } {
    const ig = { id: 'ig', tenantId: tenant, unidadeId: null, appId: 'a', appSecret: 's', appShopId: 'shop', token: null, config: {} };
    const s: any = Object.create(Food99Service.prototype);
    s.db = db;
    s.logger = { log() {}, warn() {}, error() {} };
    s.delivery = delivery;
    s.perguntadoNa99 = new Map();
    s.ultimaPosicao = new Map();
    s.authToken = async () => 'tk';
    s.integracaoDoTenant = async () => ig;
    s.pedido = async (_ig: any, ext: string) => {
      perguntas.push(ext);
      const st = estadoNa99[ext];
      return st === undefined || st === null ? null : { status: st, expected_arrived_eta: 0 };
    };
    s.postJson = async (caminho: string, _tk: string, campos: string[]) => {
      enviados.push(`${caminho} ${campos.join(',')}`);
      return { errno: 0, errmsg: 'ok' };
    };
    return { s, ig };
  }

  async function loja(): Promise<string> {
    const t = (await q(`insert into empresa (nome) values ($1) returning id`, [`Teste saída 99 ${randomUUID().slice(0, 6)}`]))[0].id;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, contato_loja) values ($1,$2,'(21) 3333-4444')`, [t, randomUUID()]);
    return t;
  }

  let seq = 5764608647577600000n;
  async function pedido(t: string, o: { status: string; tipo?: string; raw?: any; horasAtras?: number }): Promise<{ id: string; ext: string }> {
    const ext = String(++seq);
    const id = (
      await q(
        `insert into pedido_externo (tenant_id, canal, external_id, status, tipo, cliente_nome, itens, total, raw, criado_em)
         values ($1,'99food',$2,$3,$4,'Cliente','[]'::jsonb,10,$5::jsonb, now() - ($6 || ' hours')::interval) returning id`,
        [t, ext, o.status, o.tipo ?? 'entrega', JSON.stringify(o.raw ?? { delivery_type: 2, fulfillment_mode: 0 }), String(o.horasAtras ?? 0.1)],
      )
    )[0].id;
    return { id, ext };
  }
  const situacao = async (id: string) => (await q(`select status, despachado_em from pedido_externo where id = $1`, [id]))[0];
  const logistica = async (id: string) => (await q(`select * from pedido_logistica where pedido_id = $1`, [id]))[0];

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // o verificador roda só na nuvem
    // `reconciliarDespachos` lê a preferência do entregador (mig 208, @cloud-only); o banco do CI é de loja. Em
    // paralelo, quem perde a corrida do `create table if not exists` recebe 23505/42P07 — é "já existe" (ERR-128).
    await pool
      .query(
        `create table if not exists entregador_preferencia (
           colaborador_id uuid primary key, tenant_id uuid not null,
           compartilha_contato boolean not null default false, atualizado_em timestamptz not null default now())`,
      )
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
  });

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_logistica', 'producao_pedido', 'pedido_externo', 'comanda', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  it('só a entrega da loja aberta é perguntada; 400/500 vira "em rota" com a logística anotada; 200 e a falha ficam', async () => {
    const t = await loja();
    const saiu = await pedido(t, { status: 'confirmado' });
    const chegou = await pedido(t, { status: 'pronto' });
    const naLoja = await pedido(t, { status: 'pronto' });
    const falhou = await pedido(t, { status: 'confirmado' });
    const da99 = await pedido(t, { status: 'pronto', raw: { delivery_type: 1, fulfillment_mode: 0 } });
    const retirada = await pedido(t, { status: 'pronto', tipo: 'retirada', raw: { delivery_type: 0, fulfillment_mode: 1 } });
    const antigo = await pedido(t, { status: 'confirmado', horasAtras: 5 });
    const jaEmRota = await pedido(t, { status: 'despachado' });
    const semTipo = await pedido(t, { status: 'confirmado', raw: {} });
    // retirada no Regem com a 99 dizendo "entrega da loja": vale o tipo do Regem (não há "em rota" na retirada)
    const retiradaAqui = await pedido(t, { status: 'pronto', tipo: 'retirada' });
    // e o contrário: entrega no Regem, mas a 99 diz retirada (fulfillment_mode 1) — não há saída para entrega a ver
    const retiradaNa99 = await pedido(t, { status: 'pronto', raw: { delivery_type: 2, fulfillment_mode: 1 } });
    estadoNa99 = { [saiu.ext]: 400, [chegou.ext]: 500, [naLoja.ext]: 200, [falhou.ext]: null };
    for (const p of [da99, retirada, antigo, jaEmRota, semTipo, retiradaAqui, retiradaNa99]) estadoNa99[p.ext] = 400;
    perguntas = [];
    const { s, ig } = svc99(t);
    const agora = Date.now();

    expect(await s.verificarSaidaPeloAppDa99(ig, agora)).toBe(2);
    expect(perguntas.sort()).toEqual([saiu.ext, chegou.ext, naLoja.ext, falhou.ext].sort());
    for (const p of [saiu, chegou]) {
      const st = await situacao(p.id);
      expect(st.status).toBe('despachado');
      expect(st.despachado_em).not.toBeNull();
      const l = await logistica(p.id);
      expect(l.modo).toBe('propria_canal');
      expect(l.despacho_enviado_em).not.toBeNull();
      expect(l.limite_coleta).not.toBeNull();
      expect(l.limite_entrega).not.toBeNull();
    }
    expect((await situacao(naLoja.id)).status).toBe('pronto');
    expect((await situacao(falhou.id)).status).toBe('confirmado');
    expect(await logistica(naLoja.id)).toBeUndefined();
    expect(await logistica(falhou.id)).toBeUndefined();
    for (const p of [da99, retirada, antigo, semTipo, retiradaAqui, retiradaNa99]) expect((await situacao(p.id)).status).not.toBe('despachado');

    // o Regem NÃO avisa a 99 de novo ("saiu para entrega" com o telefone da loja por cima do entregador do app)
    enviados = [];
    await s.reconciliarDespachos(ig);
    expect(enviados.filter((e) => e.includes(saiu.ext) || e.includes(chegou.ext))).toEqual([]);

    // no mesmo minuto ninguém é perguntado de novo; depois de 1 min, só os que seguem abertos
    perguntas = [];
    expect(await s.verificarSaidaPeloAppDa99(ig, agora + 30_000)).toBe(0);
    expect(perguntas).toEqual([]);
    estadoNa99[naLoja.ext] = 400;
    expect(await s.verificarSaidaPeloAppDa99(ig, agora + 61_000)).toBe(1);
    expect(perguntas.sort()).toEqual([naLoja.ext, falhou.ext].sort());
    expect((await situacao(naLoja.id)).status).toBe('despachado');
  });

  it('o que a 99 ainda não despachou não toma a vez: 20 na loja antes de um que saiu — ele anda na 2ª volta (V84)', async () => {
    const t = await loja();
    const naLoja: { id: string; ext: string }[] = [];
    for (let i = 0; i < 20; i++) naLoja.push(await pedido(t, { status: 'confirmado', horasAtras: 2 }));
    const saiu = await pedido(t, { status: 'confirmado', horasAtras: 1 });
    estadoNa99 = Object.fromEntries(naLoja.map((p) => [p.ext, 200]));
    estadoNa99[saiu.ext] = 400;
    const { s, ig } = svc99(t);
    const agora = Date.now();
    perguntas = [];
    expect(await s.verificarSaidaPeloAppDa99(ig, agora)).toBe(0);
    expect(perguntas).toHaveLength(15);
    expect(perguntas).not.toContain(saiu.ext);
    perguntas = [];
    expect(await s.verificarSaidaPeloAppDa99(ig, agora + 61_000)).toBe(1);
    expect(perguntas[0]).not.toBe(naLoja[0].ext); // os nunca perguntados vão primeiro
    expect(perguntas).toContain(saiu.ext);
    expect((await situacao(saiu.id)).status).toBe('despachado');
  });

  it('o reflexo só anda para a frente: o painel concluiu entre a leitura e a gravação → nada regride (V43)', async () => {
    const t = await loja();
    const p = await pedido(t, { status: 'pronto' });
    // a gravação do reflexo encontra o pedido já concluído (alguém finalizou no painel no meio do caminho)
    const dbComCorrida = new Proxy(db, {
      get(alvo, k) {
        if (k !== 'update') return Reflect.get(alvo, k);
        return (...a: any[]) => {
          const construtor = alvo.update(...a);
          return new Proxy(construtor, {
            get(c, k2) {
              if (k2 !== 'set') return Reflect.get(c, k2);
              return (patch: any) => {
                const passo = c.set(patch);
                return new Proxy(passo, {
                  get(w, k3) {
                    if (k3 !== 'where') return Reflect.get(w, k3);
                    return (cond: any) => {
                      const r = w.where(cond);
                      return {
                        returning: async () => {
                          await pool.query(`update pedido_externo set status = 'concluido', concluido_em = now() where id = $1`, [p.id]);
                          return r.returning();
                        },
                      };
                    };
                  },
                });
              };
            },
          });
        };
      },
    });
    const comCorrida = new DeliveryService(dbComCorrida, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any);
    expect(await comCorrida.refletirStatusExterno(t, '99food', p.ext, 'despachado')).toBe('ignorado');
    expect((await situacao(p.id)).status).toBe('concluido');
    // sem corrida, o mesmo reflexo anda (e não regride um concluído)
    const outro = await pedido(t, { status: 'pronto' });
    expect(await delivery.refletirStatusExterno(t, '99food', outro.ext, 'despachado')).toBe('aplicado');
    expect(await delivery.refletirStatusExterno(t, '99food', p.ext, 'despachado')).toBe('ignorado');
  });
});
