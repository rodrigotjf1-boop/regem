import { HttpStatus, Logger } from '@nestjs/common';
import { checarBanco, limparCacheSaudeBanco } from './saude-banco';
import { AppController } from '../app.controller';
import { EdgeController } from '../modules/edge/edge.controller';
import { EdgeService } from '../modules/edge/edge.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Guarda do defeito reproduzido (set/2026): com o Postgres do servidor local PARADO, o
// /api/v1/ping e o /health respondiam 200 porque não tocavam no banco. O app da loja mostrava
// "servidor online" para sempre (nunca oferecia o modo nuvem) e o edge/saude-local.mjs aprovava
// uma atualização com o banco fora. Aqui o banco é mockado — sem Postgres de verdade.

// Resposta HTTP falsa: só precisamos saber se o controller trocou o status.
function resFalso() {
  const r: any = { statusCode: 200, status: (s: number) => { r.statusCode = s; return r; } };
  return r;
}

const dbDePe = () => ({ execute: jest.fn(async () => ({ rows: [{ '?column?': 1 }] })) }) as any;
const dbFora = () =>
  ({ execute: jest.fn(async () => { const e: any = new Error('connect ECONNREFUSED 127.0.0.1:5432'); e.code = 'ECONNREFUSED'; throw e; }) }) as any;

beforeEach(() => {
  limparCacheSaudeBanco();
  // O aviso local (V11) é comportamento desejado — aqui só não poluímos a saída do teste.
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('checarBanco', () => {
  it('banco de pé → ok:true com UM select 1', async () => {
    const db = dbDePe();
    await expect(checarBanco(db)).resolves.toEqual({ ok: true });
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('banco fora → ok:false com o motivo REAL (V11), sem lançar exceção', async () => {
    const db = dbFora();
    const r = await checarBanco(db);
    expect(r.ok).toBe(false);
    expect(r.motivo).toContain('ECONNREFUSED');
  });

  it('cache: duas chamadas seguidas consultam o banco UMA vez só', async () => {
    const db = dbDePe();
    await checarBanco(db);
    await checarBanco(db);
    await checarBanco(db);
    // Sem isto, 20 terminais pingando a cada 12 s viram ~100 select/min por loja.
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('cache: chamadas SIMULTÂNEAS compartilham a mesma consulta', async () => {
    const db = dbDePe();
    await Promise.all([checarBanco(db), checarBanco(db), checarBanco(db)]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });

  it('depois da janela do cache, consulta de novo (o estado volta a ser lido)', async () => {
    const db = dbDePe();
    await checarBanco(db);
    const agora = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(agora + 10_000);
    await checarBanco(db);
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('consulta pendurada → ok:false pelo prazo curto (o cliente não fica esperando)', async () => {
    jest.useFakeTimers();
    try {
      const db = { execute: jest.fn(() => new Promise(() => undefined)) } as any;
      const p = checarBanco(db);
      jest.advanceTimersByTime(2_500);
      await expect(p).resolves.toEqual(expect.objectContaining({ ok: false }));
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('GET /api/v1/ping', () => {
  const ping = (db: any) => new EdgeController(new EdgeService(db), {} as any);

  it('banco de pé → banco:true e status 200', async () => {
    const res = resFalso();
    const corpo = await ping(dbDePe()).ping(res);
    expect(corpo.banco).toBe(true);
    expect(corpo.regem).toBe(true); // contrato antigo preservado (saude-local.mjs lê regem/versao)
    expect(corpo.versao).toBeDefined();
    expect(res.statusCode).toBe(200);
  });

  it('banco fora → banco:false e HTTP 503 com o MESMO corpo', async () => {
    const res = resFalso();
    const corpo = await ping(dbFora()).ping(res);
    expect(corpo.banco).toBe(false);
    expect(corpo.regem).toBe(true);
    expect(res.statusCode).toBe(HttpStatus.SERVICE_UNAVAILABLE);
  });
});

describe('GET /api/v1/health', () => {
  it('banco de pé → status "ok" com banco:true', async () => {
    const corpo = await new AppController(dbDePe()).check();
    expect(corpo).toMatchObject({ status: 'ok', banco: true, service: 'regen-api' });
  });

  // De propósito (ver o comentário do app.controller.ts): o /health é o sinal de VIDA do
  // contêiner. Uma oscilação do Postgres não pode reiniciar todas as APIs em cascata — o
  // estado do banco vai no CORPO; quem precisa de "dá para operar?" usa o /ping (503).
  it('banco fora → segue respondendo (200), mas denuncia no corpo: status "degradado"', async () => {
    const corpo = await new AppController(dbFora()).check();
    expect(corpo).toMatchObject({ status: 'degradado', banco: false });
  });

  it('/health e /ping dividem o cache — um health-check e um ping seguidos, um select só', async () => {
    const db = dbDePe();
    await new AppController(db).check();
    await new EdgeController(new EdgeService(db), {} as any).ping(resFalso());
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
