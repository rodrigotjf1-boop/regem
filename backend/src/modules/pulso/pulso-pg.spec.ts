import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hojeISO } from '../../common/data';
import { somarDias } from '../perfil-cliente/calendario-regra';
import { lerConfigPulso } from './pulso.regras';
import { PulsoService } from './pulso.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O Regem lê o Pulso (F7 parte 4; mig 470) contra o Postgres, com o DMS ID e o Pulso SIMULADOS (nenhuma chamada de rede).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pulso-pg.spec: sem TEST_PG_URL — PULADO');

const MIG_470 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '470_pulso_eventos_e_clima.sql');
const ligacaoDeTeste = () => {
  const corpo = randomBytes(32).toString('base64url');
  return `dms_lg_pulso_${corpo}_${createHash('sha256').update(corpo, 'utf8').digest('base64url').slice(0, 6)}`;
};
const CFG = lerConfigPulso({
  NODE_ENV: 'test',
  PULSO_URL: 'https://pulso.teste/v1',
  PULSO_LIGACAO: ligacaoDeTeste(),
  DMS_ID_EMISSOR: 'https://id.teste',
  HUB_APLICATIVO: 'aplicativoregem01',
  HUB_SEGREDO: 'um-segredo-de-teste-comprido',
});

/** O DMS ID e o Pulso de mentira: anota cada chamada (método, caminho, consulta, cabeçalhos, corpo). */
function pulsoFalso(resp: { mudancas?: any[]; clima?: (m: string) => any; status?: number } = {}) {
  const chamadas: any[] = [];
  let pagina = 0;
  const buscar = (async (alvo: any, init: any = {}) => {
    const u = new URL(String(alvo));
    const cab = init.headers ?? {};
    let corpo: any;
    try {
      corpo = init.body ? JSON.parse(String(init.body)) : undefined;
    } catch {
      corpo = String(init.body); // o pedido de token vai em x-www-form-urlencoded
    }
    chamadas.push({ metodo: init.method ?? 'GET', caminho: u.pathname, consulta: Object.fromEntries(u.searchParams), cab, corpo });
    const json = (status: number, corpo: any) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
    if (u.hostname === 'id.teste') return json(200, { access_token: 'token-de-teste', expires_in: 300 });
    if (resp.status) return json(resp.status, { type: 'https://dev.dmstecnologias.com/erros/integracao-parada', title: 'parada', status: resp.status, detail: 'x' });
    if (u.pathname === '/v1/eventos/mudancas') return json(200, (resp.mudancas ?? [])[pagina++] ?? { eventos: [], proxima_versao: Number(u.searchParams.get('desde_versao')), tem_mais: false });
    if (u.pathname === '/v1/interesses') return json(200, { municipios: JSON.parse(String(init.body)).municipios, temas: [], ramos: ['bares_restaurantes'], municipios_pendentes: [], municipios_recusados: [] });
    if (u.pathname === '/v1/clima') return json(200, resp.clima ? resp.clima(u.searchParams.get('municipio') as string) : { dias: [] });
    return json(404, {});
  }) as unknown as typeof fetch;
  return { buscar, chamadas };
}

const evento = (n: number, extra: any = {}) => ({
  id: randomUUID(),
  chave: `feriado:regra:teste-${n}:2026`,
  tipo: 'feriado',
  nome: `Feriado ${n}`,
  dia_inteiro: true,
  inicio: '2026-12-25',
  fim: '2026-12-25',
  fuso: 'America/Sao_Paulo',
  janela: { antes_min: 0, depois_min: 0 },
  abrangencia: [{ nivel: 'nacional', valor: 'BR' }],
  situacao: 'ativo',
  detalhes: { grupo: 'feriado' },
  versao: n,
  fonte: { id: 'lei', confianca: 'lei' },
  credito: null,
  ...extra,
});

descrever('o Regem lê o Pulso (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas do Pulso (470) num schema SÓ DESTE TESTE (LIC-088): elas não têm empresa — a leitura dos eventos grava fora de
  // transação; os municípios (configuração fiscal e módulo, do public) vão numa transação desfeita.
  const SCHEMA = `teste_pulso_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    await pool.query(readFileSync(MIG_470, 'utf8'));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  async function naTransacao(f: (c: PoolClient, q: (s: string, p?: any[]) => Promise<any[]>) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await f(c, (s, p = []) => c.query(s, p).then((r) => r.rows));
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  it('eventos: a leitura incremental grava, anda o cursor junto, o retirado entra como retirado e a versão velha não sobrescreve', async () => {
    const svc = new PulsoService(drizzle(pool as any) as any);
    const a = evento(1);
    const b = evento(2);
    const f = pulsoFalso({
      mudancas: [
        { eventos: [a, b], proxima_versao: 2, tem_mais: true },
        { eventos: [evento(3), { id: b.id, chave: b.chave, situacao: 'retirado', versao: 4 }], proxima_versao: 4, tem_mais: false },
      ],
    });
    expect(await svc.lerEventos(CFG, f.buscar)).toBe(4);
    expect(await q(`select versao, erro from pulso_estado`)).toEqual([{ versao: '4', erro: null }]);
    expect(await q(`select chave, situacao, versao::int from pulso_evento order by versao`)).toEqual([
      { chave: a.chave, situacao: 'ativo', versao: 1 },
      { chave: 'feriado:regra:teste-3:2026', situacao: 'ativo', versao: 3 },
      { chave: b.chave, situacao: 'retirado', versao: 4 },
    ]);
    // O token e a ligação em cada chamada ao Pulso; o cursor de uma página para a outra.
    const doPulso = f.chamadas.filter((c) => c.caminho.startsWith('/v1/'));
    expect(doPulso.map((c) => c.consulta.desde_versao)).toEqual(['0', '2']);
    expect(doPulso.every((c) => c.cab.authorization === 'Bearer token-de-teste' && c.cab['DMS-Ligacao'] === CFG.ligacao)).toBe(true);
    const doToken = f.chamadas.find((c) => c.caminho === '/token');
    expect(doToken).toBeDefined();

    // Logo de novo: a vez está reservada (5 h) — nada sai.
    expect(await svc.lerEventos(CFG, pulsoFalso().buscar)).toBe(0);
    // Liberada a vez, uma versão VELHA do mesmo evento não sobrescreve a nova.
    await q(`update pulso_estado set eventos_lidos_em = null, versao = 0`);
    await svc.lerEventos(CFG, pulsoFalso({ mudancas: [{ eventos: [{ ...a, nome: 'velho', versao: 0 }], proxima_versao: 4, tem_mais: false }] }).buscar);
    expect(await q(`select nome from pulso_evento where id = $1`, [a.id])).toEqual([{ nome: 'Feriado 1' }]);

    // O Pulso parado (503): nada quebra; o erro fica no estado.
    await q(`update pulso_estado set eventos_lidos_em = null`);
    expect(await svc.lerEventos(CFG, pulsoFalso({ status: 503 }).buscar)).toBe(0);
    expect((await q(`select erro from pulso_estado`))[0].erro).toMatch(/503/);
  });

  it('interesses: só os municípios das empresas com o módulo ligado, somados, sem nada de loja; repete só quando a lista muda', () =>
    naTransacao(async (c, tq) => {
      const svc = new PulsoService(drizzle(c as any) as any);
      const empresa = async (municipio: number, ligado: boolean) => {
        const t = (await tq(`insert into empresa (nome) values ('teste pulso') returning id`))[0].id as string;
        await tq(`insert into fiscal_config (tenant_id, codigo_municipio) values ($1, $2)`, [t, municipio]);
        if (ligado) await tq(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'perfil_cliente', true)`, [t]);
        return t;
      };
      await empresa(3304557, true);
      await empresa(3304557, true); // a mesma cidade, outra empresa: entra uma vez
      await empresa(3550308, false); // módulo desligado: fora
      await tq(`update pulso_estado set interesses_hash = null, interesses_em = null`);
      const f = pulsoFalso();
      expect(await svc.mandarInteresses(CFG, f.buscar)).toBe(true);
      const put = f.chamadas.find((x) => x.caminho === '/v1/interesses');
      expect(put.metodo).toBe('PUT');
      expect(put.corpo.municipios).toContain('3304557');
      expect(put.corpo.municipios).not.toContain('3550308');
      expect(put.corpo.ramos).toEqual(['bares_restaurantes']);
      expect(Object.keys(put.corpo).sort()).toEqual(['municipios', 'ramos', 'temas']); // nada de empresa, loja ou cliente
      // A mesma lista no dia seguinte: não manda de novo.
      const f2 = pulsoFalso();
      expect(await svc.mandarInteresses(CFG, f2.buscar)).toBe(false);
      expect(f2.chamadas.some((x) => x.caminho === '/v1/interesses')).toBe(false);
      // Uma cidade nova: manda a lista inteira de novo.
      await empresa(3106200, true);
      const f3 = pulsoFalso();
      expect(await svc.mandarInteresses(CFG, f3.buscar)).toBe(true);
      expect(f3.chamadas.find((x) => x.caminho === '/v1/interesses').corpo.municipios).toEqual(expect.arrayContaining(['3106200', '3304557']));
    }));

  it('clima: 16 dias de cada município, e a chuva que se previa na véspera só para amanhã', () =>
    naTransacao(async (c, tq) => {
      const svc = new PulsoService(drizzle(c as any) as any);
      const t = (await tq(`insert into empresa (nome) values ('teste clima') returning id`))[0].id as string;
      await tq(`insert into fiscal_config (tenant_id, codigo_municipio) values ($1, 3304557)`, [t]);
      await tq(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'perfil_cliente', true)`, [t]);
      await tq(`update pulso_estado set clima_lido_em = null`);
      const hoje = hojeISO();
      const amanha = somarDias(hoje, 1);
      // Hoje já tinha a véspera de ontem (sem chuva); a leitura nova não apaga.
      await tq(`insert into clima_municipio_dia (municipio, dia, chuva_prevista, chuva_na_vespera) values (3304557, $1::date, false, false)`, [hoje]);
      const f = pulsoFalso({
        clima: () => ({
          municipio: { ibge: '3304557', nome: 'Rio de Janeiro', uf: 'RJ', vigiado: true },
          dias: Array.from({ length: 16 }, (_, i) => ({ dia: somarDias(hoje, i), chuva_prevista: i % 2 === 1, inmet: { resumo: `d${i}` }, cptec: null })),
        }),
      });
      expect(await svc.lerClimaDosMunicipios(CFG, f.buscar)).toBeGreaterThanOrEqual(16);
      const pedido = f.chamadas.find((x) => x.caminho === '/v1/clima');
      expect(pedido.consulta).toEqual({ municipio: '3304557', de: hoje, ate: somarDias(hoje, 15) });
      const dias = await tq(`select to_char(dia, 'YYYY-MM-DD') as dia, chuva_prevista, chuva_na_vespera, inmet ->> 'resumo' as resumo
                               from clima_municipio_dia where municipio = 3304557 and dia between $1::date and $2::date order by dia`, [hoje, somarDias(hoje, 15)]);
      expect(dias).toHaveLength(16);
      expect(dias[0]).toEqual({ dia: hoje, chuva_prevista: false, chuva_na_vespera: false, resumo: 'd0' });
      expect(dias[1]).toEqual({ dia: amanha, chuva_prevista: true, chuva_na_vespera: true, resumo: 'd1' });
      expect(dias.slice(2).every((d: any) => d.chuva_na_vespera === null)).toBe(true);
      // A mesma volta de novo: a vez está reservada (20 h).
      expect(await svc.lerClimaDosMunicipios(CFG, pulsoFalso().buscar)).toBe(0);
    }));
});
