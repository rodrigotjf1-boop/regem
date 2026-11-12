import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { chaveDoServidor } from './vigia.regras';
import { VigiaService } from './vigia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O VIGIA DO SERVIDOR DA LOJA (mig 413), contra o Postgres real. O que se prova: o problema ABRE um episódio e a volta
// seguinte só soma; o que some FECHA e o que volta abre OUTRO; a gravidade e a evidência acompanham; servidor sem sinal
// só ganha o episódio do sinal e os outros dele ficam como estavam; duas voltas cruzadas deixam UM episódio (o índice
// único, não a sorte); o servidor desativado tem os episódios encerrados; a credencial de integração e a empresa de fora
// da volta não são tocadas.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('vigia-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('o vigia do servidor da loja (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const FORA = randomUUID(); // outra empresa, que a volta do teste não inclui
  let loja: string;
  const svc = new VigiaService(db);
  const AGORA = new Date();
  const haMin = (m: number, de: Date = AGORA) => new Date(de.getTime() - m * 60_000);

  const saudeBoa = () => ({
    servicos: { pg: 'Running', api: 'Running', web: 'Running', sync: 'Running', impressao: 'Running' },
    backup: { ok: true, horas: 5, erro: null },
    bancoFalhasChecksum: 0,
    bancoPctTransacoes: 3,
    relogioDesvioS: 1,
    syncFalhandoDesde: null,
    impressorasSemResponder: [],
    impressorasComAviso: [],
    // o que as regras NÃO leem (não pode chegar à evidência)
    rede: { ip: '192.168.0.77' },
    presenca: [{ nome: 'PC DO FULANO' }],
  });

  /** Um servidor de loja (ou outro equipamento) com o último sinal dele. */
  async function servidor(o: { tenant?: string; ativo?: boolean; integrador?: string | null; tipo?: string; semLoja?: boolean } = {}): Promise<string> {
    const tenant = o.tenant ?? T;
    const [{ id }] = await q(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, integrador)
       values ($1, $2, $3, 'Servidor de teste', $4, $5, $6) returning id`,
      [tenant, tenant === T && !o.semLoja ? loja : null, o.tipo ?? 'servidor_local', `tok-${randomUUID()}`, o.ativo ?? true, o.integrador ?? null],
    );
    await sinal(id, {}, { tenant });
    return id as string;
  }
  /** Grava o último sinal do servidor (como a batida faz: uma linha por servidor). */
  async function sinal(equipamentoId: string, saude: any = {}, o: { tenant?: string; haMin?: number; discoMb?: number | null; semSaude?: boolean } = {}) {
    await q(
      `insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, estado, disco_livre_mb, saude, recebido_em)
       values ($1, $2, null, '1.30.13', 'sync_ok', $3, $4::jsonb, $5)
       on conflict (equipamento_id) do update set disco_livre_mb = excluded.disco_livre_mb, saude = excluded.saude, recebido_em = excluded.recebido_em`,
      [equipamentoId, o.tenant ?? T, o.discoMb === undefined ? 50_000 : o.discoMb, o.semSaude ? null : JSON.stringify({ ...saudeBoa(), ...saude }), haMin(o.haMin ?? 1)],
    );
  }
  const parado = { servicos: { pg: 'Stopped', api: 'Running', web: 'Running', sync: 'Running', impressao: 'Running' } };
  const episodios = (equipamentoId: string) =>
    q(`select * from vigia_incidente where equipamento_id = $1 order by primeira_em, id`, [equipamentoId]);
  const volta = (agora: Date = AGORA) => svc.volta([T], agora);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    // A 413 é só da nuvem: o banco do CI é o de uma loja (ERR-273). Duas vezes: a migration é idempotente.
    for (let i = 0; i < 2; i++)
      await repetirNaCorridaDeCatalogo(async () => {
        const c = await pool.connect();
        try {
          await c.query('begin');
          await c.query(comTravaDaEmpresa(readFileSync(MIG('413_vigia_incidente.sql'), 'utf8')));
          await c.query('commit');
        } catch (e) {
          await c.query('rollback').catch(() => {});
          throw e;
        } finally {
          c.release();
        }
      });
    await q(`insert into empresa (id, nome) values ($1, 'teste vigia'), ($2, 'teste vigia (de fora)')`, [T, FORA]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
  });
  afterAll(async () => {
    for (const t of ['vigia_incidente', 'edge_status', 'equipamento', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, FORA]]).catch(() => {});
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, FORA]]).catch(() => {});
    await pool.end();
  });

  it('servidor saudável não abre nada', async () => {
    const s = await servidor();
    const r = await volta();
    expect(r.comErro).toBe(0);
    expect(await episodios(s)).toEqual([]);
  });

  it('o problema ABRE um episódio (com a loja do servidor); a volta seguinte só soma', async () => {
    const s = await servidor();
    await sinal(s, parado);
    const r1 = await volta();
    expect(r1.abertos).toBeGreaterThanOrEqual(1);
    let [e, ...resto] = await episodios(s);
    expect(resto).toEqual([]);
    expect(e).toMatchObject({
      tenant_id: T, unidade_id: loja, equipamento_id: s, regra: 'servico_parado', chave: chaveDoServidor(s, 'servico', 'pg'),
      gravidade: 'critico', publico: 'distribuicao', situacao: 'aberto', vezes: 1, fechado_em: null,
    });
    expect(e.evidencia).toEqual({ servico: 'pg', estado: 'Stopped', restaurando: false });
    await volta();
    [e, ...resto] = await episodios(s);
    expect(resto).toEqual([]);
    expect(e).toMatchObject({ situacao: 'aberto', vezes: 2 });
    expect(new Date(e.ultima_em).getTime()).toBeGreaterThanOrEqual(new Date(e.primeira_em).getTime());
  });

  it('o que some FECHA como recuperado; o que volta abre OUTRO episódio', async () => {
    const s = await servidor();
    await sinal(s, parado);
    await volta();
    await sinal(s);
    const r = await volta();
    expect(r.recuperados).toBeGreaterThanOrEqual(1);
    let lista = await episodios(s);
    expect(lista).toHaveLength(1);
    expect(lista[0].situacao).toBe('recuperado');
    expect(lista[0].fechado_em).not.toBeNull();
    await volta(); // recuperado não reabre nem soma
    expect((await episodios(s))[0]).toMatchObject({ situacao: 'recuperado', vezes: 1 });
    await sinal(s, parado);
    await volta();
    lista = await episodios(s);
    expect(lista.map((x) => x.situacao).sort()).toEqual(['aberto', 'recuperado']);
  });

  it('a gravidade e a evidência acompanham o episódio aberto; a evidência não leva a rede nem os PCs', async () => {
    const s = await servidor();
    await sinal(s, { bancoPctTransacoes: 60 });
    await volta();
    expect((await episodios(s))[0]).toMatchObject({ regra: 'banco_em_risco', gravidade: 'atencao' });
    await sinal(s, { bancoPctTransacoes: 85 });
    await volta();
    const [e, ...resto] = await episodios(s);
    expect(resto).toEqual([]);
    expect(e).toMatchObject({ gravidade: 'critico', vezes: 2 });
    expect(Number(e.evidencia.pctTransacoes)).toBe(85);
    expect(JSON.stringify(e.evidencia)).not.toContain('192.168.0.77');
    expect(JSON.stringify(e.evidencia)).not.toContain('FULANO');
  });

  it('sem sinal: só o episódio do sinal; os outros ficam como estavam, e a volta do sinal decide com o dado novo', async () => {
    const s = await servidor();
    await sinal(s, {}, { discoMb: 100 });
    await volta();
    expect((await episodios(s)).map((x) => [x.regra, x.situacao, x.vezes])).toEqual([['disco_baixo', 'aberto', 1]]);
    // o servidor some: a saúde guardada continua dizendo "disco baixo", mas é dado velho
    await sinal(s, {}, { discoMb: 100, haMin: 30 });
    await volta();
    let lista = await episodios(s);
    expect(lista.map((x) => [x.regra, x.situacao, x.vezes]).sort()).toEqual([
      ['disco_baixo', 'aberto', 1], // nem somou, nem fechou
      ['servidor_sem_sinal', 'aberto', 1],
    ]);
    const mudo = lista.find((x) => x.regra === 'servidor_sem_sinal');
    expect(mudo).toMatchObject({ gravidade: 'critico', publico: 'ambos', chave: chaveDoServidor(s) });
    expect(mudo.evidencia.minutosSemSinal).toBe(30);
    // voltou, e o disco foi liberado
    await sinal(s);
    await volta();
    lista = await episodios(s);
    expect(lista.map((x) => [x.regra, x.situacao]).sort()).toEqual([
      ['disco_baixo', 'recuperado'],
      ['servidor_sem_sinal', 'recuperado'],
    ]);
  });

  it('servidor sem a saúde rica: o disco (que vem na raiz da batida) ainda é vigiado', async () => {
    const s = await servidor();
    await sinal(s, {}, { discoMb: 500, semSaude: true });
    await volta();
    expect((await episodios(s)).map((x) => x.regra)).toEqual(['disco_baixo']);
  });

  it('duas voltas cruzadas deixam UM episódio: a segunda espera a primeira e só soma', async () => {
    const s = await servidor();
    await sinal(s, parado);
    // A "outra volta" abre o episódio numa transação que ainda não fechou: a linha é invisível para a volta do teste.
    const outra = await pool.connect();
    let cruzou = false;
    try {
      await outra.query('begin');
      const [{ pid }] = (await outra.query('select pg_backend_pid() as pid')).rows;
      await outra.query(
        `insert into vigia_incidente (tenant_id, unidade_id, equipamento_id, regra, chave, gravidade, publico, evidencia)
         values ($1, $2, $3, 'servico_parado', $4, 'critico', 'distribuicao', '{}'::jsonb)`,
        [T, loja, s, chaveDoServidor(s, 'servico', 'pg')],
      );
      const daVolta = volta();
      // Espera a volta ficar presa ATRÁS desta transação (V72: pela sessão presa atrás DESTA conexão, não por qualquer espera).
      for (let i = 0; i < 100 && !cruzou; i++) {
        const [{ n }] = await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [pid]);
        cruzou = n > 0;
        if (!cruzou) await new Promise((r) => setTimeout(r, 50));
      }
      await outra.query('commit');
      await daVolta;
    } catch (e) {
      await outra.query('rollback').catch(() => {});
      throw e;
    } finally {
      outra.release();
    }
    expect(cruzou).toBe(true);
    const lista = await episodios(s);
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ situacao: 'aberto', vezes: 2 });
  });

  it('o servidor desativado tem os episódios ENCERRADOS (não sobra "aberto" eterno) e sai da vigia', async () => {
    const s = await servidor();
    await sinal(s, parado);
    await volta();
    await q(`update equipamento set ativo = false where id = $1`, [s]);
    const r = await volta();
    expect(r.encerrados).toBeGreaterThanOrEqual(1);
    let lista = await episodios(s);
    expect(lista).toHaveLength(1);
    expect(lista[0].situacao).toBe('encerrado');
    expect(lista[0].fechado_em).not.toBeNull();
    await volta(); // desativado: não abre de novo
    lista = await episodios(s);
    expect(lista).toHaveLength(1);
  });

  it('a credencial de integração e o que não é servidor de loja ficam fora', async () => {
    const credencial = await servidor({ integrador: 'gogem' });
    const kds = await servidor({ tipo: 'kds' });
    await sinal(credencial, parado);
    await sinal(kds, parado);
    await volta();
    expect(await episodios(credencial)).toEqual([]);
    expect(await episodios(kds)).toEqual([]);
  });

  it('a volta limitada às empresas do teste não toca a empresa de fora (nem abre, nem fecha)', async () => {
    const deFora = await servidor({ tenant: FORA });
    await sinal(deFora, parado, { tenant: FORA });
    const [{ id: aberto }] = await q(
      `insert into vigia_incidente (tenant_id, equipamento_id, regra, chave, gravidade, publico)
       values ($1, $2, 'disco_baixo', $3, 'critico', 'distribuicao') returning id`,
      [FORA, deFora, chaveDoServidor(deFora)],
    );
    await volta();
    const lista = await q(`select id, regra, situacao from vigia_incidente where tenant_id = $1`, [FORA]);
    expect(lista).toEqual([{ id: aberto, regra: 'disco_baixo', situacao: 'aberto' }]); // nada novo, nada fechado
    // e a volta da empresa de fora, sozinha, enxerga o servidor dela
    const r = await svc.volta([FORA], AGORA);
    expect(r.servidores).toBe(1);
    expect((await q(`select regra, situacao from vigia_incidente where tenant_id = $1 order by regra`, [FORA])).map((x) => [x.regra, x.situacao])).toEqual([
      ['disco_baixo', 'recuperado'],
      ['servico_parado', 'aberto'],
    ]);
  });
});
