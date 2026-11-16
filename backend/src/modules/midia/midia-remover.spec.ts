import { mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MidiaService } from './midia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O `remover` da mídia (expurgo LGPD, ERR-075): o arquivo que já não existe conta como apagado — senão a rotina, que só zera
// a referência quando o arquivo saiu, ficaria presa na mesma foto todo dia. A falha de verdade (rede, recusa) não conta.

const TENANT = '11111111-2222-3333-4444-555555555555';
const ARQ = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jpg';
const LOCAL = `https://loja.local/api/v1/publico/midia/${TENANT}/${ARQ}`;
const NUVEM = `https://x.supabase.co/storage/v1/object/public/midia/${TENANT}/${ARQ}`;

describe('MidiaService.remover', () => {
  const antes = { dir: process.env.MIDIA_DIR, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
  const fetchOriginal = global.fetch;
  let dir = '';
  const svc = new MidiaService();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'midia-remover-'));
    process.env.MIDIA_DIR = dir;
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  });
  afterAll(async () => {
    global.fetch = fetchOriginal;
    for (const [k, v] of [['MIDIA_DIR', antes.dir], ['SUPABASE_URL', antes.url], ['SUPABASE_SERVICE_KEY', antes.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(dir, { recursive: true, force: true });
  });

  it('disco: apaga o arquivo; o que já não existe conta como apagado', async () => {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(join(dir, TENANT), { recursive: true });
    await writeFile(join(dir, TENANT, ARQ), 'x');
    expect(await svc.remover(LOCAL)).toBe(true);
    await expect(access(join(dir, TENANT, ARQ))).rejects.toBeTruthy();
    expect(await svc.remover(LOCAL)).toBe(true); // já não existe
    expect(await svc.remover(`https://loja.local/api/v1/publico/midia/../${ARQ}`)).toBe(false); // caminho que não é nosso
  });

  const respondendo = (status: number, corpo = '') => {
    global.fetch = (async () => new Response(corpo, { status })) as any;
  };

  it('storage: 200 e 404 apagaram; o 400 de "objeto não existe" também; outro 400, 500 ou rede caída não', async () => {
    respondendo(200);
    expect(await svc.remover(NUVEM)).toBe(true);
    respondendo(404);
    expect(await svc.remover(NUVEM)).toBe(true);
    respondendo(400, '{"statusCode":"404","error":"not_found","message":"Object not found"}');
    expect(await svc.remover(NUVEM)).toBe(true);
    respondendo(400, '{"statusCode":"400","error":"InvalidJWT","message":"invalid signature"}');
    expect(await svc.remover(NUVEM)).toBe(false);
    respondendo(500, 'erro');
    expect(await svc.remover(NUVEM)).toBe(false);
    global.fetch = (async () => {
      throw new Error('ECONNRESET');
    }) as any;
    expect(await svc.remover(NUVEM)).toBe(false);
  });
});
