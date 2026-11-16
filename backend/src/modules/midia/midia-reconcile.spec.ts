import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { MidiaService } from './midia.service';
import { MidiaReconcileProcessor, PADRAO_DA_MIDIA_LOCAL } from './midia-reconcile.processor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FILA DA RÉPLICA DAS IMAGENS DO CATÁLOGO NÃO TRANCA (V84). O servidor da loja guarda a foto no disco e este processo a
// sobe para a nuvem. O lote eram 25 linhas QUAISQUER que não fossem do storage, e o que não era arquivo local era pulado
// no laço: a imagem com endereço de fora (catálogo importado — 68 produtos na nuvem em 16/11/2026) ocupava o lote todo a
// cada ciclo, e a foto enviada pela loja nunca subia. Postgres real.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('midia-reconcile.spec: sem TEST_PG_URL — PULADO');

const STORAGE = 'https://x.supabase.co/storage/v1/object/public/midia';
const local = (t: string, arq = randomUUID()) => `http://localhost:4000/api/v1/publico/midia/${t}/${arq}.jpg`;
const deFora = (n: number) => `https://storage.googleapis.com/catalogo-de-outro-sistema/produtos/foto-${n}.jpg`;

descrever('a réplica das imagens do catálogo (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const empresas: string[] = [];
  const antes = process.env.EDGE_MODE;

  /** Uma empresa nova, o serviço de mídia com a réplica de mentira e o processo como se fosse o servidor da loja. */
  async function montar(replicar: (ref: string) => Promise<string | null>, comoLoja = true) {
    const T = randomUUID();
    empresas.push(T);
    await q(`insert into empresa (id, nome) values ($1, 'teste réplica da mídia')`, [T]);
    const midia = new MidiaService();
    const pedidos: string[] = [];
    (midia as any).temCloud = () => true;
    (midia as any).replicarViaNuvem = async (ref: string) => {
      pedidos.push(ref);
      return replicar(ref);
    };
    if (comoLoja) process.env.EDGE_MODE = 'true';
    else delete process.env.EDGE_MODE;
    const proc = new MidiaReconcileProcessor(db, midia);
    (proc as any).logger = { log: () => undefined, warn: () => undefined };
    const produto = async (id: string, nome: string, ref: string | null) =>
      q(`insert into produto (id, tenant_id, nome, imagem_ref) values ($1, $2, $3, $4)`, [id, T, nome, ref]);
    const refs = async () => (await q(`select nome, imagem_ref from produto where tenant_id = $1 order by id`, [T])).map((x) => [x.nome, x.imagem_ref]);
    return { T, proc, pedidos, produto, refs };
  }

  afterAll(async () => {
    for (const T of empresas) {
      for (const tab of ['produto', 'categoria_produto', 'opcao', 'cardapio_config']) await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => undefined);
      await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    }
    if (antes === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = antes;
    await pool.end();
  });

  it('30 imagens com endereço de fora na frente não seguram as fotos locais: sobem no MESMO ciclo', async () => {
    const m = await montar(async (ref) => `${STORAGE}/t/${ref.split('/').pop()}`);
    const ids = Array.from({ length: 36 }, () => randomUUID()).sort();
    for (let i = 0; i < 30; i++) await m.produto(ids[i], `fora ${i}`, deFora(i));
    const locais = [local(m.T), local(m.T), local(m.T)];
    for (let i = 0; i < 3; i++) await m.produto(ids[30 + i], `local ${i}`, locais[i]);
    await m.produto(ids[33], 'já na nuvem', `${STORAGE}/t/ja.jpg`);
    await m.produto(ids[34], 'sem imagem', null);
    await m.produto(ids[35], 'vazio', '');
    await m.proc.reconciliar([m.T]);
    // Só as três locais foram pedidas — as de fora, a da nuvem e as vazias nem entram no lote.
    expect(m.pedidos.sort()).toEqual([...locais].sort());
    const depois = await m.refs();
    expect(depois.filter(([n]) => String(n).startsWith('local')).every(([, r]) => String(r).startsWith(STORAGE))).toBe(true);
    expect(depois.filter(([n]) => String(n).startsWith('fora')).map(([, r]) => r)).toEqual(Array.from({ length: 30 }, (_, i) => deFora(i)));
  });

  it('o arquivo que sumiu não fica na frente da fila: o lote anda em rodízio e volta nele depois', async () => {
    const sumidos = new Set<string>();
    const m = await montar(async (ref) => (sumidos.has(ref) ? null : `${STORAGE}/t/${ref.split('/').pop()}`));
    const ids = Array.from({ length: 5 }, () => randomUUID()).sort();
    const refsLocais = ids.map(() => local(m.T));
    sumidos.add(refsLocais[0]);
    sumidos.add(refsLocais[1]);
    for (let i = 0; i < 5; i++) await m.produto(ids[i], `p${i}`, refsLocais[i]);
    m.proc.lote = 2;
    await m.proc.reconciliar([m.T]); // p0 e p1: sumiram
    await m.proc.reconciliar([m.T]); // p2 e p3: sobem
    await m.proc.reconciliar([m.T]); // p4: sobe; a página curta recomeça
    expect(m.pedidos).toEqual(refsLocais);
    expect((await m.refs()).map(([, r]) => String(r).startsWith(STORAGE))).toEqual([false, false, true, true, true]);
    // O rodízio volta nos dois que faltam (a internet pode ter voltado, o arquivo pode ter reaparecido).
    sumidos.delete(refsLocais[0]);
    m.pedidos.length = 0;
    await m.proc.reconciliar([m.T]);
    expect(m.pedidos).toEqual([refsLocais[0], refsLocais[1]]);
    expect((await m.refs()).map(([, r]) => String(r).startsWith(STORAGE))).toEqual([true, false, true, true, true]);
  });

  it('quem trocou a foto enquanto a antiga subia não perde a nova', async () => {
    const id = randomUUID();
    let T = '';
    const m = await montar(async (ref) => {
      await q(`update produto set imagem_ref = $2 where id = $1`, [id, `${STORAGE}/t/foto-nova.jpg`]);
      return `${STORAGE}/t/${ref.split('/').pop()}`;
    });
    T = m.T;
    await m.produto(id, 'trocado', local(T));
    await m.proc.reconciliar([T]);
    expect(await m.refs()).toEqual([['trocado', `${STORAGE}/t/foto-nova.jpg`]]);
  });

  it('só a empresa pedida é tocada; e fora do servidor da loja o processo não faz nada', async () => {
    const outra = await montar(async () => `${STORAGE}/t/x.jpg`);
    const refDaOutra = local(outra.T);
    await outra.produto(randomUUID(), 'da outra', refDaOutra);
    const m = await montar(async (ref) => `${STORAGE}/t/${ref.split('/').pop()}`);
    await m.produto(randomUUID(), 'meu', local(m.T));
    await m.proc.reconciliar([m.T]);
    expect(await outra.refs()).toEqual([['da outra', refDaOutra]]);
    const nuvem = await montar(async () => `${STORAGE}/t/x.jpg`, false);
    const refNaNuvem = local(nuvem.T);
    await nuvem.produto(randomUUID(), 'na nuvem', refNaNuvem);
    await nuvem.proc.reconciliar([nuvem.T]);
    expect(nuvem.pedidos).toEqual([]);
    expect(await nuvem.refs()).toEqual([['na nuvem', refNaNuvem]]);
  });

  it('o `where` e o `ehUrlLocal` respondem igual para os mesmos endereços', async () => {
    const midia = new MidiaService();
    const T = randomUUID();
    const A = randomUUID();
    const casos = [
      `http://localhost:4000/api/v1/publico/midia/${T}/${A}.jpg`,
      `https://regem.local:4000/api/v1/publico/midia/${T}/${A}.png`,
      `http://192.168.0.10:4000/api/v1/publico/midia/${T}/${A}.webp?v=3`,
      `http://localhost:4000/api/v1/publico/midia/${T}/${A}.gif/`,
      `https://outra-base.exemplo/${T}/${A}.jpg`,
      `${STORAGE}/${T}/${A}.jpg`,
      deFora(1),
      `http://localhost:4000/api/v1/publico/midia/${T}/foto.jpg`,
      `http://localhost:4000/api/v1/publico/midia/${T}/${A}.bmp`,
      `http://localhost:4000/api/v1/publico/midia/${A}.jpg`,
      '/caminho/relativo.jpg',
      'data:image/png;base64,AAAA',
    ];
    for (const u of casos) {
      const [{ sim }] = await q(`select ($1::text ~ $2 and $1::text not like '%/storage/v1/object/public/%') as sim`, [u, PADRAO_DA_MIDIA_LOCAL]);
      expect([u, sim]).toEqual([u, !!midia.ehUrlLocal(u)]);
    }
  });
});
