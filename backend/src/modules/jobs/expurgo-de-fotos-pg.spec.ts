import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { JobsService } from './jobs.service';
import { PedidoManutencaoService } from '../pedido-manutencao/pedido-manutencao.service';
import { MARCA_DO_STORAGE, PREFIXO_DA_MIDIA_LOCAL, esteLadoApaga, ondeMoraAFoto, padraoDasFotosDoLado } from './expurgo-de-fotos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O EXPURGO LGPD DAS FOTOS POR LADO (ERR-075). O servidor da loja roda a mesma dist da nuvem: cada lado só apaga o arquivo
// que mora com ele (a loja o do disco, a nuvem o do storage) e só zera a referência quando o arquivo saiu. Antes, o lado que
// não conseguia apagar zerava assim mesmo, e o arquivo do outro lado ficava órfão para sempre.

const LOCAL = (n: string) => `https://loja.local${PREFIXO_DA_MIDIA_LOCAL}t/${n}.jpg`;
const NUVEM = (n: string) => `https://x.supabase.co${MARCA_DO_STORAGE}midia/t/${n}.jpg`;

describe('expurgo de fotos — quem apaga o quê (puro)', () => {
  it('onde mora a foto, pela URL', () => {
    expect(ondeMoraAFoto(LOCAL('a'))).toBe('disco');
    expect(ondeMoraAFoto(NUVEM('a'))).toBe('storage');
    expect(ondeMoraAFoto('https://outro.site/a.jpg')).toBeNull();
    expect(ondeMoraAFoto(null)).toBeNull();
  });
  it('a loja apaga a do disco; a nuvem a do storage — e, sem storage (desenvolvimento), a do próprio disco', () => {
    expect([esteLadoApaga(LOCAL('a'), true, true), esteLadoApaga(NUVEM('a'), true, true)]).toEqual([true, false]);
    expect([esteLadoApaga(LOCAL('a'), false, true), esteLadoApaga(NUVEM('a'), false, true)]).toEqual([false, true]);
    expect([esteLadoApaga(LOCAL('a'), false, false), esteLadoApaga(NUVEM('a'), false, false)]).toEqual([true, false]);
    expect(padraoDasFotosDoLado(true, true)).toBe(`%${PREFIXO_DA_MIDIA_LOCAL}%`);
    expect(padraoDasFotosDoLado(false, true)).toBe(`%${MARCA_DO_STORAGE}%`);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('expurgo-de-fotos-pg.spec: sem TEST_PG_URL — PULADO');

descrever('expurgo de fotos — cada lado as suas (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  let loja = '';
  let pessoa = '';
  /** O storage de mentira: guarda o que foi pedido para apagar; o que estiver em `falha` não sai. */
  const pedidos: string[] = [];
  const falha = new Set<string>();
  const midia: any = {
    remover: async (ref: string) => {
      pedidos.push(ref);
      return !falha.has(ref);
    },
  };
  const u = undefined as any;
  const svc = new JobsService(db, midia, u, u, u, u, u, u);
  (svc as any).log = { log: () => undefined, error: () => undefined };
  const antes = { edge: process.env.EDGE_MODE, url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_KEY };
  const comoNuvem = () => {
    delete process.env.EDGE_MODE;
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_KEY = 'chave-de-teste';
  };
  const comoLoja = () => {
    process.env.EDGE_MODE = 'true';
  };
  const vencida = '2020-01-01';

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste expurgo de fotos')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja do expurgo') returning id`, [T]);
    [{ id: pessoa }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Pessoa do expurgo') returning id`, [T]);
  });
  afterAll(async () => {
    for (const tab of ['pedido_manutencao', 'ponto_marcacao', 'tarefa_instancia', 'desperdicio', 'vistoria', 'colaborador', 'unidade'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    for (const [k, v] of [['EDGE_MODE', antes.edge], ['SUPABASE_URL', antes.url], ['SUPABASE_SERVICE_KEY', antes.key]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await pool.end();
  });
  beforeEach(() => {
    pedidos.length = 0;
    falha.clear();
  });

  it('ponto: a nuvem apaga a do storage e só larga a referência da cópia da loja; a loja apaga o arquivo dela', async () => {
    const ponto = async (ref: string, nsr: number) =>
      (await q(`insert into ponto_marcacao (tenant_id, colaborador_id, nsr, tipo, foto_ref, data_expurgo) values ($1, $2, $3, 'entrada', $4, $5) returning id`, [T, pessoa, nsr, ref, vencida]))[0].id;
    const daNuvem = await ponto(NUVEM('p1'), 900001);
    const daLoja = await ponto(LOCAL('p2'), 900002);
    const falhou = await ponto(NUVEM('p3'), 900003);
    const ref = async (id: string) => (await q(`select foto_ref from ponto_marcacao where id = $1`, [id]))[0].foto_ref;
    comoNuvem();
    falha.add(NUVEM('p3'));
    await svc.expurgarFotosPonto([T]);
    // A nuvem nunca pede para apagar o arquivo da loja; a referência da CÓPIA dela some (a marcação só sobe, não volta).
    expect(pedidos.sort()).toEqual([NUVEM('p1'), NUVEM('p3')].sort());
    expect([await ref(daNuvem), await ref(daLoja), await ref(falhou)]).toEqual([null, null, NUVEM('p3')]);
    // Na loja (o banco dela tem a cópia dela, ainda com a referência): ela apaga o arquivo dela e não toca no storage.
    await q(`update ponto_marcacao set foto_ref = $2 where id = $1`, [daLoja, LOCAL('p2')]);
    const lojaFalha = await ponto(LOCAL('p4'), 900004);
    falha.add(LOCAL('p4'));
    comoLoja();
    pedidos.length = 0;
    await svc.expurgarFotosPonto([T]);
    expect(pedidos.sort()).toEqual([LOCAL('p2'), LOCAL('p4')].sort());
    expect([await ref(daLoja), await ref(lojaFalha), await ref(falhou)]).toEqual([null, LOCAL('p4'), NUVEM('p3')]);
  });

  it('as fotos que não saem na frente da fila não trancam as seguintes (páginas pelo id — V84)', async () => {
    const ids = Array.from({ length: 6 }, () => randomUUID()).sort();
    for (const [i, id] of ids.entries())
      await q(`insert into ponto_marcacao (id, tenant_id, colaborador_id, nsr, tipo, foto_ref, data_expurgo) values ($1, $2, $3, $4, 'entrada', $5, $6)`,
        [id, T, pessoa, 900101 + i, NUVEM(`fila${i}`), vencida]);
    for (let i = 0; i < 5; i++) falha.add(NUVEM(`fila${i}`)); // as 5 primeiras pelo id não saem
    comoNuvem();
    svc.pagina = 2;
    try {
      await svc.expurgarFotosPonto([T]);
    } finally {
      svc.pagina = 500;
    }
    expect(pedidos.filter((p) => p.includes('/fila')).sort()).toEqual(ids.map((_, i) => NUVEM(`fila${i}`)).sort());
    const refs = (await q(`select id, foto_ref from ponto_marcacao where id = any($1::uuid[]) order by id`, [ids])).map((x) => x.foto_ref);
    expect(refs).toEqual([...ids.slice(0, 5).map((_, i) => NUVEM(`fila${i}`)), null]);
  });

  it('tarefa com fotos dos dois lados: cada lado apaga as dele, e a tarefa só sai do expurgo sem nenhuma', async () => {
    const [{ id }] = await q(
      `insert into tarefa_instancia (tenant_id, unidade_id, data, foto_ref, fotos, data_expurgo) values ($1, $2, $3, $4, $5::jsonb, $3) returning id`,
      [T, loja, vencida, NUVEM('t1'), JSON.stringify([NUVEM('t1'), LOCAL('t2'), NUVEM('t3')])],
    );
    const linha = async () => (await q(`select foto_ref, fotos, data_expurgo from tarefa_instancia where id = $1`, [id]))[0];
    comoNuvem();
    await svc.expurgarFotosTarefa([T]);
    expect(pedidos.sort()).toEqual([NUVEM('t1'), NUVEM('t3')].sort());
    let l = await linha();
    expect([l.foto_ref, l.fotos, !!l.data_expurgo]).toEqual([null, [LOCAL('t2')], true]);
    comoLoja();
    pedidos.length = 0;
    await svc.expurgarFotosTarefa([T]);
    expect(pedidos).toEqual([LOCAL('t2')]);
    l = await linha();
    expect([l.foto_ref, l.fotos, l.data_expurgo]).toEqual([null, [], null]);
  });

  it('desperdício e vistoria: a nuvem não zera a foto da loja (antes ela zerava e o arquivo ficava órfão)', async () => {
    const [{ id: d }] = await q(`insert into desperdicio (tenant_id, descricao, foto_ref, created_at) values ($1, 'x', $2, now() - interval '100 days') returning id`, [T, LOCAL('d1')]);
    const [{ id: v }] = await q(`insert into vistoria (tenant_id, foto_ref, created_at) values ($1, $2, now() - interval '100 days') returning id`, [T, NUVEM('v1')]);
    comoNuvem();
    await svc.expurgarFotosOperacao([T]);
    expect(pedidos).toEqual([NUVEM('v1')]);
    expect((await q(`select foto_ref from desperdicio where id = $1`, [d]))[0].foto_ref).toBe(LOCAL('d1'));
    expect((await q(`select foto_ref from vistoria where id = $1`, [v]))[0].foto_ref).toBeNull();
    comoLoja();
    pedidos.length = 0;
    await svc.expurgarFotosOperacao([T]);
    expect(pedidos).toEqual([LOCAL('d1')]);
    expect((await q(`select foto_ref from desperdicio where id = $1`, [d]))[0].foto_ref).toBeNull();
  });

  it('manutenção pendente há 15 dias: o aviso vai com a loja do pedido e é de gestão (não toca no KDS de outra loja)', async () => {
    await q(`insert into pedido_manutencao (tenant_id, unidade_id, titulo, prazo_15d) values ($1, $2, 'Coifa pingando', '2020-01-01')`, [T, loja]);
    const avisos: any[] = [];
    const manut = new PedidoManutencaoService(db, { emit: (_: string, a: any) => avisos.push(a) } as any, undefined as any);
    await manut.promoverAntigos();
    const meus = avisos.filter((a) => a.tenantId === T);
    expect(meus).toHaveLength(1);
    expect([meus[0].unidadeId, meus[0].tipo, meus[0].detalhe]).toEqual([loja, 'gestao', 'Coifa pingando — manter, concluir ou excluir?']);
    // Uma vez por pedido: a segunda rodada não repete.
    avisos.length = 0;
    await manut.promoverAntigos();
    expect(avisos.filter((a) => a.tenantId === T)).toHaveLength(0);
  });
});

describe('a manutenção antiga só roda na nuvem (ERR-075)', () => {
  it('no servidor da loja a rotina não chama a promoção; na nuvem chama', async () => {
    const chamadas: string[] = [];
    const u = undefined as any;
    const svc = new JobsService(u, u, u, u, { promoverAntigos: async () => (chamadas.push('promoveu'), 0) } as any, u, u, u);
    const antes = process.env.EDGE_MODE;
    try {
      process.env.EDGE_MODE = 'true';
      await svc.promoverManutencaoAntiga();
      expect(chamadas).toEqual([]);
      delete process.env.EDGE_MODE;
      await svc.promoverManutencaoAntiga();
      expect(chamadas).toEqual(['promoveu']);
    } finally {
      if (antes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = antes;
    }
  });
});
