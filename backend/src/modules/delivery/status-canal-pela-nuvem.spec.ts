import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { fetchExterno } from '../../common/fetch-externo';
import { enviosDoPedido } from './pedido-envio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O SERVIDOR DA LOJA NÃO AVISAVA O CANAL (correção autorizada pelo dono em 02/10/2026).
//
// A credencial dos canais fica só na nuvem (a tabela `integracao` não desce para a loja). Aceitar,
// marcar pronto, despachar, concluir ou cancelar um pedido de canal no servidor da loja chamava o
// canal sem credencial — e nada saía, em silêncio. Agora a loja PEDE À NUVEM que envie
// (`POST /delivery/status-da-loja`, com o token do servidor), a nuvem roda o MESMO envio e
// responde o resultado; os dois lados registram na linha do tempo.
//
// Dois lados, um banco de teste: a NUVEM (`statusVindoDaLoja`) e a LOJA (os envios com
// `EDGE_MODE=true`, falando com uma nuvem simulada pela rede).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('status-canal-pela-nuvem.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('status do pedido ao canal: a loja pede, a nuvem envia', () => {
  let pool: Pool;
  let db: any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const empresas: string[] = [];
  const ambiente = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  const fetchOriginal = global.fetch;
  const NUVEM = 'https://nuvem.exemplo/api/v1';

  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(ambiente)) {
      if (v === undefined) delete (process.env as any)[k];
      else (process.env as any)[k] = v;
    }
    global.fetch = fetchOriginal;
    for (const t of empresas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
      await q('delete from equipamento where tenant_id = $1', [t]).catch(() => {});
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(() => {
    delete process.env.EDGE_MODE;
    delete process.env.CLOUD_API;
    delete process.env.SYNC_TOKEN;
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
  });

  const empresa = async () => {
    const t = (await q(`insert into empresa (nome) values ('teste status pela nuvem') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    return { t, u };
  };
  const pedido = async (t: string, u: string | null, canal: string, extra: Record<string, any> = {}) => {
    const r = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, tipo, total, itens, raw)
       values ($1,$2,$3,$4,$5,$6,10,'[]'::jsonb,'{}'::jsonb) returning *`,
      [t, u, canal, String(Math.floor(Math.random() * 1e12)), extra.status ?? 'confirmado', extra.tipo ?? 'entrega'],
    );
    const p = r[0];
    return { ...p, tenantId: p.tenant_id, unidadeId: p.unidade_id, externalId: p.external_id, motivoCancelamento: extra.motivoCancelamento ?? null };
  };
  const registros = (t: string, id: string) => enviosDoPedido(db, t, id);
  const ate = async (t: string, id: string, n: number) => {
    for (let i = 0; i < 60; i++) {
      const r = await registros(t, id);
      if (r.length >= n) return r;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    return registros(t, id);
  };
  const servico = (canais: { od?: any; cw?: any; ifood?: any; food99?: any; anotaai?: any } = {}) => {
    const s = new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => undefined }, { flashPedidos: () => undefined }, canais.od, canais.cw, canais.ifood, canais.food99, canais.anotaai, undefined) as any;
    s.esperasDoRepasse = [0, 5, 5]; // três tentativas, sem esperar minutos
    return s;
  };
  const post = async (url: string) => (await fetchExterno(url, { method: 'POST', body: '{}' })).ok;
  /** Um iFood de mentira COM credencial: cada envio é uma chamada pela rede (simulada). */
  const ifoodComCredencial = () => ({
    integracaoDoTenant: async () => ({ id: 'ig' }),
    confirmar: async (_ig: any, id: string) => void (await post(`https://ifood.exemplo/orders/${id}/confirm`)),
    prontoRetirada: async (_ig: any, id: string) => void (await post(`https://ifood.exemplo/orders/${id}/readyToPickup`)),
    despachar: async (_ig: any, id: string) => void (await post(`https://ifood.exemplo/orders/${id}/dispatch`)),
    cancelarComBlindagem: async (_t: string, id: string) => post(`https://ifood.exemplo/orders/${id}/requestCancellation`),
  });
  /** O que este servidor não tem: nenhuma integração configurada. */
  const semCredencial = () => ({ integracaoDoTenant: async () => null });

  describe('na NUVEM: o pedido de envio que chega da loja', () => {
    const redeDoCanal = (status = 202, corpo = '') => {
      const chamadas: string[] = [];
      global.fetch = jest.fn(async (url: any) => {
        chamadas.push(String(url));
        return new Response(corpo, { status });
      }) as any;
      return chamadas;
    };

    it('envia pelo mesmo caminho da nuvem, devolve o resultado e registra', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      const chamadas = redeDoCanal();
      const r = await servico({ ifood: ifoodComCredencial() }).statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'ready', status: 'pronto' });
      expect(r).toEqual({ ok: true, resultado: 'enviado', motivo: null, httpStatus: 202 });
      expect(chamadas).toEqual([`https://ifood.exemplo/orders/${p.externalId}/readyToPickup`]);
      expect(await registros(t, p.id)).toMatchObject([{ destino: 'ifood', acao: 'ready', resultado: 'enviado', servidor: 'nuvem' }]);
    });

    it('o canal recusou: a loja recebe "falhou" com o motivo (não é erro da rota)', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      redeDoCanal(409, '{"message":"Order is not in a valid state"}');
      const r = await servico({ ifood: ifoodComCredencial() }).statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'confirm' });
      expect(r).toMatchObject({ ok: true, resultado: 'falhou', httpStatus: 409, motivo: 'HTTP 409 — {"message":"Order is not in a valid state"}' });
    });

    it('resposta perdida, a loja repete: o canal NÃO recebe duas vezes', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      const chamadas = redeDoCanal();
      const svc = servico({ ifood: ifoodComCredencial() });
      await svc.statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'confirm' });
      const de_novo = await svc.statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'confirm' });
      expect(de_novo).toMatchObject({ ok: true, repetido: true, resultado: 'enviado' });
      expect(chamadas).toHaveLength(1);
      // outra ação do mesmo pedido não é repetição
      await svc.statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'ready' });
      expect(chamadas).toHaveLength(2);
    });

    it('pedido que o canal já cancelou: "pronto" não sai; "cancelado" sai', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood', { status: 'cancelado' });
      const chamadas = redeDoCanal();
      const svc = servico({ ifood: ifoodComCredencial() });
      expect(await svc.statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'ready' })).toMatchObject({ resultado: 'nao_enviado', motivo: 'o pedido já está cancelado na nuvem' });
      expect(chamadas).toEqual([]);
      expect(await svc.statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'cancel', motivoCancelamento: 'cliente desistiu' })).toMatchObject({ resultado: 'enviado' });
      expect(chamadas).toHaveLength(1);
      expect((await registros(t, p.id)).map((x) => `${x.acao}/${x.resultado}`)).toEqual(['ready/nao_enviado', 'cancel/enviado']);
    });

    it('o motivo do cancelamento que só a loja tem vai junto', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'anotaai');
      const visto: any[] = [];
      const anotaai = { integracaoDoTenant: async () => ({ id: 'ig' }), cancelar: async (_ig: any, _id: string, motivo?: string) => { visto.push(motivo); return true; } };
      await servico({ anotaai }).statusVindoDaLoja({ tenantId: t, unidadeId: u }, { pedidoId: p.id, acao: 'cancel', motivoCancelamento: 'faltou ingrediente' });
      expect(visto).toEqual(['faltou ingrediente']);
    });

    it('recusa o que não pode: id torto, pedido desconhecido, de outra empresa, de outra loja, ação que o canal não tem', async () => {
      const a = await empresa();
      const b = await empresa();
      const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja 2') returning id`, [a.t]))[0].id as string;
      const p = await pedido(a.t, a.u, 'anotaai');
      const chamadas = redeDoCanal();
      const svc = servico({ anotaai: { integracaoDoTenant: async () => ({ id: 'ig' }), pronto: (_ig: any, id: string) => post(`https://anota.exemplo/order/ready/${id}`) } });
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: a.u }, { pedidoId: 'x', acao: 'ready' })).rejects.toMatchObject({ status: 400 });
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: a.u }, { pedidoId: randomUUID(), acao: 'ready' })).rejects.toMatchObject({ status: 409 });
      await expect(svc.statusVindoDaLoja({ tenantId: b.t, unidadeId: b.u }, { pedidoId: p.id, acao: 'ready' })).rejects.toMatchObject({ status: 409 }); // outra empresa não o enxerga
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: outraLoja }, { pedidoId: p.id, acao: 'ready' })).rejects.toMatchObject({ status: 403 });
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: a.u }, { pedidoId: p.id, acao: 'confirm' })).rejects.toMatchObject({ status: 400 }); // a Anota AI não tem "confirm"
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: a.u }, { pedidoId: p.id, acao: 'drop table' })).rejects.toMatchObject({ status: 400 });
      expect(chamadas).toEqual([]);
      expect(await registros(a.t, p.id)).toEqual([]);
      // servidor sem loja definida (empresa de uma loja) pode
      await expect(svc.statusVindoDaLoja({ tenantId: a.t, unidadeId: null }, { pedidoId: p.id, acao: 'ready' })).resolves.toMatchObject({ resultado: 'enviado' });
    });

    it('credencial de integrador (GoGeM) não é servidor de loja: 403', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      const eq = async (integrador: string | null) =>
        (await q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador) values ($1,$2,'srv','servidor_local',$3,true,$4) returning id`, [t, u, randomBytes(24).toString('hex'), integrador]))[0].id as string;
      const chamadas = redeDoCanal();
      const svc = servico({ ifood: ifoodComCredencial() });
      await expect(svc.statusVindoDaLoja({ tenantId: t, unidadeId: u, equipamentoId: await eq('gogem') }, { pedidoId: p.id, acao: 'confirm' })).rejects.toMatchObject({ status: 403 });
      expect(chamadas).toEqual([]);
      await expect(svc.statusVindoDaLoja({ tenantId: t, unidadeId: u, equipamentoId: await eq(null) }, { pedidoId: p.id, acao: 'confirm' })).resolves.toMatchObject({ resultado: 'enviado' });
    });
  });

  describe('na LOJA: sem a credencial do canal, pede à nuvem', () => {
    /** A rede vista da loja: a nuvem responde o que o teste mandar; o canal nunca deve ser chamado daqui. */
    const rede = (nuvem: (corpo: any, n: number) => Response | Promise<Response>) => {
      const pedidosANuvem: { url: string; token: string | null; corpo: any }[] = [];
      const canal: string[] = [];
      global.fetch = jest.fn(async (url: any, init: any) => {
        const u = String(url);
        if (u.startsWith(NUVEM)) {
          const corpo = JSON.parse(String(init?.body ?? '{}'));
          pedidosANuvem.push({ url: u, token: new Headers(init?.headers).get('x-sync-token'), corpo });
          return nuvem(corpo, pedidosANuvem.length);
        }
        canal.push(u);
        return new Response('', { status: 202 });
      }) as any;
      return { pedidosANuvem, canal };
    };
    const json = (o: any, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
    const comoLoja = () => {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = NUVEM;
      process.env.SYNC_TOKEN = 'token-do-servidor-da-loja';
    };

    it('manda o pedido à nuvem com o token do servidor e grava o resultado que ela devolveu', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood', { status: 'pronto' });
      comoLoja();
      const r = rede(() => json({ ok: true, resultado: 'enviado', motivo: null, httpStatus: 202 }));
      await servico({ ifood: semCredencial() }).statusBackIfood(t, p, 'ready');
      const reg = await ate(t, p.id, 1);
      expect(r.pedidosANuvem).toEqual([{ url: `${NUVEM}/delivery/status-da-loja`, token: 'token-do-servidor-da-loja', corpo: { pedidoId: p.id, acao: 'ready', status: 'pronto', motivoCancelamento: null } }]);
      expect(r.canal).toEqual([]); // a loja não fala com o canal
      expect(reg).toMatchObject([{ destino: 'ifood', acao: 'ready', resultado: 'enviado', httpStatus: 202, servidor: 'loja', motivo: null }]);
    });

    it('o canal recusou lá na nuvem: a linha do tempo da loja mostra a falha com o motivo', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, '99food');
      comoLoja();
      rede(() => json({ ok: true, resultado: 'falhou', motivo: 'o canal recusou — {"errno":10012}', httpStatus: 200 }));
      await servico({ food99: semCredencial() }).statusBackFood99(t, p, 'confirm');
      expect(await ate(t, p.id, 1)).toMatchObject([{ destino: '99food', acao: 'confirm', resultado: 'falhou', motivo: 'o canal recusou — {"errno":10012}', servidor: 'loja' }]);
    });

    it('409 (pedido ainda não subiu) e nuvem fora do ar: tenta de novo; recusa definitiva: não insiste', async () => {
      const { t, u } = await empresa();
      const a = await pedido(t, u, 'anotaai');
      const b = await pedido(t, u, 'anotaai');
      const c = await pedido(t, u, 'anotaai');
      comoLoja();
      const svc = servico({ anotaai: semCredencial() });

      let r = rede((_c, n) => (n === 1 ? json({ message: 'ainda não chegou' }, 409) : json({ ok: true, resultado: 'enviado' })));
      await svc.statusBackAnotaAi(t, a, 'ready');
      expect(await ate(t, a.id, 1)).toMatchObject([{ resultado: 'enviado' }]);
      expect(r.pedidosANuvem).toHaveLength(2);

      r = rede(() => json({ message: 'caiu' }, 503));
      await svc.statusBackAnotaAi(t, b, 'ready');
      expect(await ate(t, b.id, 1)).toMatchObject([{ resultado: 'falhou', motivo: 'a nuvem não atendeu o pedido de envio (HTTP 503)', servidor: 'loja' }]);
      expect(r.pedidosANuvem).toHaveLength(3); // as três tentativas

      r = rede(() => json({ message: 'ação inválida' }, 400));
      await svc.statusBackAnotaAi(t, c, 'ready');
      expect(await ate(t, c.id, 1)).toMatchObject([{ resultado: 'falhou', motivo: 'a nuvem não atendeu o pedido de envio (HTTP 400)' }]);
      expect(r.pedidosANuvem).toHaveLength(1); // recusa definitiva: uma só
    });

    it('sem internet: nunca derruba o servidor (é chamado em segundo plano) e fica registrado', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'cardapio_web');
      comoLoja();
      global.fetch = jest.fn(async () => {
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      }) as any;
      await expect(servico({ cw: { statusBack: async () => false } }).statusBackCw(t, p, 'confirm')).resolves.toMatchObject({ resultado: 'nao_enviado' });
      expect(await ate(t, p.id, 1)).toMatchObject([{ destino: 'cardapio_web', acao: 'confirm', resultado: 'falhou', motivo: 'a nuvem não atendeu o pedido de envio (ENOTFOUND)' }]);
    });

    it('dois avisos do mesmo pedido chegam à nuvem NA ORDEM, mesmo com o primeiro demorando', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      comoLoja();
      const r = rede(async (corpo) => {
        if (corpo.acao === 'confirm') await new Promise((ok) => setTimeout(ok, 120)); // o aceite demora
        return json({ ok: true, resultado: 'enviado' });
      });
      const svc = servico({ ifood: semCredencial() });
      void svc.statusBackIfood(t, p, 'confirm');
      void svc.statusBackIfood(t, { ...p, status: 'pronto' }, 'ready');
      const reg = await ate(t, p.id, 2);
      expect(r.pedidosANuvem.map((x) => x.corpo.acao)).toEqual(['confirm', 'ready']);
      expect(reg.map((x) => x.acao)).toEqual(['confirm', 'ready']);
      expect(svc.filaDoCanal.size).toBe(0); // a fila some quando termina
    });

    it('loja que TEM a credencial continua enviando direto — sem passar pela nuvem', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      comoLoja();
      const r = rede(() => json({ ok: true, resultado: 'enviado' }));
      await servico({ ifood: ifoodComCredencial() }).statusBackIfood(t, p, 'confirm');
      expect(r.pedidosANuvem).toEqual([]);
      expect(r.canal).toEqual([`https://ifood.exemplo/orders/${p.externalId}/confirm`]);
      expect(await registros(t, p.id)).toMatchObject([{ acao: 'confirm', resultado: 'enviado', servidor: 'loja' }]);
    });

    it('loja sem ligação com a nuvem configurada: fica registrado que nada saiu', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      process.env.EDGE_MODE = 'true'; // sem CLOUD_API nem SYNC_TOKEN
      const r = rede(() => json({ ok: true }));
      await servico({ ifood: semCredencial() }).statusBackIfood(t, p, 'confirm');
      expect(await ate(t, p.id, 1)).toMatchObject([{ resultado: 'nao_enviado', servidor: 'loja', motivo: 'este servidor (loja) não tem a credencial do canal e não está ligado à nuvem' }]);
      expect(r.pedidosANuvem).toEqual([]);
    });

    it('o que não se envia continua não se enviando: entrega feita pela 99 e pedido de outro canal', async () => {
      const { t, u } = await empresa();
      const proprio = await pedido(t, u, 'cardapio');
      comoLoja();
      const r = rede(() => json({ ok: true, resultado: 'enviado' }));
      const svc = servico({ ifood: semCredencial(), anotaai: semCredencial() });
      await svc.statusBackIfood(t, proprio, 'confirm');
      await svc.statusBackAnotaAi(t, proprio, 'ready');
      await svc.statusBack(t, proprio, 'dispatch');
      await new Promise((ok) => setTimeout(ok, 150));
      expect(r.pedidosANuvem).toEqual([]);
      expect(await registros(t, proprio.id)).toEqual([]);
    });
  });

  describe('na NUVEM nada muda', () => {
    it('sem credencial na nuvem: "não enviado", sem pedir a ninguém', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      process.env.CLOUD_API = NUVEM; // mesmo que estas variáveis existam, a nuvem não repassa
      process.env.SYNC_TOKEN = 'x';
      const chamadas: string[] = [];
      global.fetch = jest.fn(async (url: any) => {
        chamadas.push(String(url));
        return new Response('{}', { status: 200 });
      }) as any;
      await servico({ ifood: semCredencial() }).statusBackIfood(t, p, 'confirm');
      await new Promise((ok) => setTimeout(ok, 100));
      expect(chamadas).toEqual([]);
      expect(await registros(t, p.id)).toMatchObject([{ resultado: 'nao_enviado', servidor: 'nuvem', motivo: 'integração do canal inativa ou sem credencial' }]);
    });
  });

  describe('ponta a ponta: a loja pede e a nuvem envia de verdade', () => {
    it('o aceite feito na loja chega ao iFood pela nuvem, e as duas linhas do tempo contam a mesma história', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      const nuvem = servico({ ifood: ifoodComCredencial() });
      const loja = servico({ ifood: semCredencial() });
      const noCanal: string[] = [];
      global.fetch = jest.fn(async (url: any, init: any) => {
        const alvo = String(url);
        if (alvo.startsWith(NUVEM)) {
          // a "rede" entrega o pedido da loja à nuvem (que NÃO é servidor local)
          delete process.env.EDGE_MODE;
          try {
            const r = await nuvem.statusVindoDaLoja({ tenantId: t, unidadeId: u }, JSON.parse(String(init.body)));
            return new Response(JSON.stringify(r), { status: 200 });
          } finally {
            process.env.EDGE_MODE = 'true';
          }
        }
        noCanal.push(alvo);
        return new Response('', { status: 202 });
      }) as any;
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = NUVEM;
      process.env.SYNC_TOKEN = 'token-do-servidor-da-loja';
      await loja.statusBackIfood(t, p, 'confirm');
      const reg = await ate(t, p.id, 2);
      expect(noCanal).toEqual([`https://ifood.exemplo/orders/${p.externalId}/confirm`]); // o iFood recebeu, uma vez
      expect(reg.map((x) => `${x.servidor}:${x.acao}/${x.resultado}`).sort()).toEqual(['loja:confirm/enviado', 'nuvem:confirm/enviado']);
    });
  });
});
