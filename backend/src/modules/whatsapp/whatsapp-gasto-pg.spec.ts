import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { WhatsappGastoService } from './whatsapp-gasto.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O GASTO DO WHATSAPP OFICIAL (G1, mig 445) contra o Postgres real, com a Meta simulada (a resposta de cada consulta sai
// do intervalo pedido, como a Meta faz): quem é lido (as contas oficiais de empresa viva, uma vez a cada 30 min), a
// primeira leitura (o mês de meia em meia hora, a carga dos meses anteriores por dia, dentro de um ano, e o gasto por
// modelo), a releitura (só desde ontem, o dia que a Meta corrigiu é TROCADO e não somado), duas leituras juntas sem
// duplicar, a falha da Meta virando o motivo, e o resumo da tela (totais, tipos, filtro de número, franquia, meses, "De
// onde veio" com a campanha) sem misturar empresas. As tabelas do gasto e as duas da nuvem que o resumo lê (números e
// campanha, em versão mínima) sobem num schema SÓ DESTE TESTE (LIC-088: nada de reaplicar a cadeia só-nuvem — ERR-451).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('whatsapp-gasto-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = join(__dirname, '../../../../database/migrations/445_whatsapp_gasto.sql');
const s = (iso: string) => Date.parse(iso) / 1000;
const AGORA = new Date('2026-11-19T00:30:00Z'); // 18/11, 21:30 em São Paulo
const DEPOIS = new Date('2026-11-19T01:05:00Z'); // 35 minutos depois
const NUM_P = '552199992210';
const NUM_M = '552199997731';

type Ponto = { waba: string; ini: string; gran: 'HALF_HOUR' | 'DAILY'; numero: string; cat: string; tipo: string; n: number; c: number };

descrever('gasto do WhatsApp oficial (Postgres)', () => {
  const SCHEMA = `teste_gasto_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool, { schema }) as any;
  const q = async (t: string, p: any[] = []) => (await pool.query(t, p)).rows;
  const empresas: string[] = [];
  let A = '';
  let B = '';
  let C = '';
  let D = '';
  const WABA_P = `waba-p-${randomUUID().slice(0, 8)}`;
  const WABA_M = `waba-m-${randomUUID().slice(0, 8)}`;
  const WABA_C = `waba-c-${randomUUID().slice(0, 8)}`;
  const WABA_D = `waba-d-${randomUUID().slice(0, 8)}`;
  const WABA_X = `waba-x-${randomUUID().slice(0, 8)}`;

  // A Meta simulada: os pontos de cada conta; a consulta devolve os do intervalo pedido, na granularidade pedida.
  let pontos: Ponto[] = [];
  const falhas = new Set<string>();
  class GastoDeTeste extends WhatsappGastoService {
    chamadas: string[] = [];
    protected async getMeta(caminho: string): Promise<{ status: number; json: any }> {
      this.chamadas.push(caminho);
      const waba = caminho.split(/[/?]/)[0];
      if (falhas.has(waba)) return { status: 400, json: { error: { message: 'Unsupported get request', code: 100, fbtrace_id: 'Zz9' } } };
      const dec = decodeURIComponent(caminho);
      const m = /pricing_analytics\.start\((\d+)\)\.end\((\d+)\)\.granularity\((\w+)\)/.exec(dec);
      if (m) {
        const [ini, fim, gran] = [Number(m[1]), Number(m[2]), m[3]];
        const data_points = pontos
          .filter((p) => p.waba === waba && p.gran === gran && s(p.ini) >= ini && s(p.ini) < fim)
          .map((p) => ({ start: s(p.ini), end: s(p.ini) + (p.gran === 'DAILY' ? 86400 : 1800), phone_number: p.numero, pricing_category: p.cat, pricing_type: p.tipo, volume: p.n, cost: p.c }));
        return { status: 200, json: { currency: 'BRL', pricing_analytics: { data: [{ data_points }] }, id: waba } };
      }
      if (caminho.includes('/message_templates?')) {
        const data = waba === WABA_M ? [{ id: '111', name: 'sexta_do_burger', category: 'MARKETING' }] : waba === WABA_P ? [{ id: '222', name: 'pedido_saiu_para_entrega', category: 'UTILITY' }] : [];
        return { status: 200, json: { data } };
      }
      if (caminho.includes('/template_analytics?')) {
        const qs = new URLSearchParams(caminho.split('?')[1]);
        const ids: string[] = JSON.parse(qs.get('template_ids') ?? '[]');
        const todos = [
          { template_id: '111', start: s('2026-11-14T00:00:00Z'), end: s('2026-11-15T00:00:00Z'), delivered: 412, cost: [{ type: 'amount_spent', value: 132.54 }] },
          { template_id: '222', start: s('2026-11-17T00:00:00Z'), end: s('2026-11-18T00:00:00Z'), delivered: 10, cost: [{ type: 'amount_spent', value: 0.35 }] },
        ];
        const ini = Number(qs.get('start'));
        return { status: 200, json: { data: [{ data_points: todos.filter((t) => ids.includes(t.template_id) && t.start >= ini) }] } };
      }
      return { status: 404, json: { error: { message: 'caminho desconhecido no teste' } } };
    }
    protected async ligarMetricas(): Promise<void> {}
  }
  const gasto = new GastoDeTeste(db);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    await admin.query(`create schema ${SCHEMA}`);
    // As duas tabelas da nuvem que o resumo lê, mínimas e sem FK para tabela compartilhada (LIC-088).
    await q(`create table whatsapp_numero (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid,
               papel text not null, provedor text not null default 'evolution', numero text, phone_id text, waba_id text,
               status text not null default 'desconectado')`);
    await q(`create table campanha (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, template_nome text,
               criado_em timestamptz not null default now())`);
    // A migration, com a trava da empresa na frente (ERR-377), no schema do teste (o primeiro do caminho).
    const conf: any = await repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        const r = await c.query(comTravaDaEmpresa(readFileSync(MIG, 'utf8')));
        await c.query('commit');
        return r;
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
    const linhas = (Array.isArray(conf) ? conf[conf.length - 1] : conf).rows as { objeto: string; ok: boolean }[];
    expect(linhas.filter((l) => !l.ok)).toEqual([]);

    const nova = async (nome: string) => {
      const id = (await q(`insert into empresa (nome) values ($1) returning id`, [nome]))[0].id as string;
      empresas.push(id);
      return id;
    };
    A = await nova('teste gasto — dois números oficiais');
    B = await nova('teste gasto — conexão por QR Code');
    C = await nova('teste gasto — empresa apagada');
    D = await nova('teste gasto — outra empresa');
    await q(`update empresa set deleted_at = now() where id = $1`, [C]);
    await q(`insert into whatsapp_numero (tenant_id, papel, provedor, numero, phone_id, waba_id, status) values
               ($1, 'principal', 'cloud', '+55 21 99999-2210', 'ph-p', $2, 'conectado'),
               ($1, 'marketing', 'cloud', '+55 21 99999-7731', 'ph-m', $3, 'conectado'),
               ($4, 'principal', 'evolution', '+55 21 98888-0000', null, null, 'conectado'),
               ($5, 'principal', 'cloud', '+55 21 97777-0000', 'ph-c', $6, 'conectado'),
               ($7, 'principal', 'cloud', '+55 21 96666-1111', 'ph-d', $8, 'conectado')`, [A, WABA_P, WABA_M, B, C, WABA_C, D, WABA_D]);
    // A configuração do cardápio da empresa A aponta a mesma conta do principal: a lista não repete a conta.
    await q(`insert into cardapio_config (tenant_id, token, ativo, provedor, wa_cloud_waba_id) values ($1, $2, true, 'cloud', $3)`, [A, `tk-${randomUUID().slice(0, 10)}`, WABA_P]);
    await q(`insert into campanha (tenant_id, template_nome, criado_em) values ($1, 'sexta_do_burger', '2026-11-14T21:00:00Z')`, [A]);

    pontos = [
      { waba: WABA_P, ini: '2026-11-10T15:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 60, c: 2.1 },
      { waba: WABA_P, ini: '2026-11-17T12:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 10, c: 0.35 },
      { waba: WABA_P, ini: '2026-11-18T13:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'AUTHENTICATION', tipo: 'REGULAR', n: 1, c: 0.035 }, // some na releitura
      { waba: WABA_P, ini: '2026-11-18T14:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'SERVICE', tipo: 'FREE_CUSTOMER_SERVICE', n: 900, c: 0 },
      { waba: WABA_P, ini: '2026-11-18T23:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'SERVICE', tipo: 'REGULAR', n: 100, c: 3.5 },
      { waba: WABA_P, ini: '2026-11-19T00:00:00Z', gran: 'HALF_HOUR', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 2, c: 0.07 }, // 21:00 de 18/11
      { waba: WABA_M, ini: '2026-11-14T21:00:00Z', gran: 'HALF_HOUR', numero: NUM_M, cat: 'MARKETING', tipo: 'REGULAR', n: 412, c: 132.54 },
      { waba: WABA_P, ini: '2026-10-15T00:00:00Z', gran: 'DAILY', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 100, c: 3.5 },
      { waba: WABA_P, ini: '2026-09-03T00:00:00Z', gran: 'DAILY', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 50, c: 1.75 },
      { waba: WABA_P, ini: '2025-11-05T00:00:00Z', gran: 'DAILY', numero: NUM_P, cat: 'UTILITY', tipo: 'REGULAR', n: 7, c: 9 }, // mais de um ano: a Meta não guarda
      { waba: WABA_D, ini: '2026-11-18T15:00:00Z', gran: 'HALF_HOUR', numero: '552196666111', cat: 'MARKETING', tipo: 'REGULAR', n: 1000, c: 321.7 },
    ];
  });

  afterAll(async () => {
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    if (empresas.length) {
      await admin.query(`delete from cardapio_config where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await admin.query(`delete from empresa where id = any($1::uuid[])`, [empresas]).catch(() => {});
    }
    await pool.end();
    await admin.end();
  });

  const gastoDe = async (t: string, waba: string) =>
    q(`select numero, dia::text as dia, categoria, tipo, mensagens, custo::float8 as custo from whatsapp_gasto
        where tenant_id = $1 and waba_id = $2 order by dia, categoria, tipo`, [t, waba]);

  it('quem é lido: as contas oficiais de empresa viva, sem repetir a conta, nem a conexão por QR Code', async () => {
    const contas = (await gasto.contasParaLer(AGORA)).filter((c) => empresas.includes(c.tenantId));
    expect(contas.map((c) => `${c.tenantId === A ? 'A' : c.tenantId === D ? 'D' : '?'}:${c.wabaId}`).sort()).toEqual([`A:${WABA_M}`, `A:${WABA_P}`, `D:${WABA_D}`].sort());
  });

  it('a primeira leitura: o mês de meia em meia hora, os meses anteriores por dia (dentro de um ano) e o gasto por modelo', async () => {
    for (const w of [WABA_P, WABA_M]) expect(await gasto.lerConta(A, w, AGORA)).toEqual({ ok: true });
    expect(await gasto.lerConta(D, WABA_D, AGORA)).toEqual({ ok: true });
    expect(await gastoDe(A, WABA_P)).toEqual([
      { numero: NUM_P, dia: '2026-09-03', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 50, custo: 1.75 },
      { numero: NUM_P, dia: '2026-10-15', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 100, custo: 3.5 },
      { numero: NUM_P, dia: '2026-11-10', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 60, custo: 2.1 },
      { numero: NUM_P, dia: '2026-11-17', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 10, custo: 0.35 },
      { numero: NUM_P, dia: '2026-11-18', categoria: 'AUTHENTICATION', tipo: 'REGULAR', mensagens: 1, custo: 0.035 },
      { numero: NUM_P, dia: '2026-11-18', categoria: 'SERVICE', tipo: 'FREE_CUSTOMER_SERVICE', mensagens: 900, custo: 0 },
      { numero: NUM_P, dia: '2026-11-18', categoria: 'SERVICE', tipo: 'REGULAR', mensagens: 100, custo: 3.5 },
      { numero: NUM_P, dia: '2026-11-18', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 2, custo: 0.07 },
    ]);
    // A carga pediu à Meta só o último ano (desde 19/11/2025), por dia.
    const diaria = gasto.chamadas.map((c) => decodeURIComponent(c)).find((c) => c.startsWith(WABA_P) && c.includes('granularity(DAILY)'))!;
    expect(diaria).toContain(`start(${s('2025-11-19T00:00:00Z')})`);
    expect(diaria).toContain(`end(${s('2026-11-01T00:00:00Z')})`);
    // A de meia em meia hora começou à meia-noite do dia 1º em São Paulo.
    const meia = gasto.chamadas.map((c) => decodeURIComponent(c)).filter((c) => c.startsWith(WABA_P) && c.includes('granularity(HALF_HOUR)'));
    expect(meia[0]).toContain(`start(${s('2026-11-01T03:00:00Z')})`);
    expect(meia[meia.length - 1]).toContain(`end(${s('2026-11-19T00:30:00Z')})`);
    const [lei] = await q(`select lido_em, erro, moeda, historico_ate::text as h, modelos_lidos_em from whatsapp_gasto_leitura where tenant_id = $1 and waba_id = $2`, [A, WABA_P]);
    expect(lei).toMatchObject({ erro: null, moeda: 'BRL', h: '2026-11-18' });
    expect(new Date(lei.lido_em).toISOString()).toBe(AGORA.toISOString());
    expect(lei.modelos_lidos_em).not.toBeNull();
    expect(await q(`select modelo_nome, dia::text as dia, mensagens, custo::float8 as custo from whatsapp_gasto_modelo where tenant_id = $1 order by modelo_nome`, [A])).toEqual([
      { modelo_nome: 'pedido_saiu_para_entrega', dia: '2026-11-17', mensagens: 10, custo: 0.35 },
      { modelo_nome: 'sexta_do_burger', dia: '2026-11-14', mensagens: 412, custo: 132.54 },
    ]);
    // Lida agora: a próxima volta (em menos de 25 minutos) não lê de novo.
    expect((await gasto.contasParaLer(AGORA)).filter((c) => c.tenantId === A)).toEqual([]);
  });

  it('a releitura: só desde ontem; o dia que a Meta corrigiu é trocado (não somado), o que ela tirou some, e o dia antigo fica', async () => {
    const p = pontos.find((x) => x.waba === WABA_P && x.cat === 'SERVICE' && x.tipo === 'REGULAR')!;
    p.n = 110;
    p.c = 3.85;
    pontos.find((x) => x.ini === '2026-11-10T15:00:00Z')!.n = 999; // fora do que se relê
    pontos = pontos.filter((x) => x.cat !== 'AUTHENTICATION'); // a Meta não devolve mais
    gasto.chamadas = [];
    expect(await gasto.lerConta(A, WABA_P, DEPOIS)).toEqual({ ok: true });
    const meia = gasto.chamadas.map((c) => decodeURIComponent(c)).filter((c) => c.includes('granularity('));
    expect(meia).toHaveLength(1);
    expect(meia[0]).toContain(`start(${s('2026-11-17T03:00:00Z')})`);
    expect(meia[0]).toContain('granularity(HALF_HOUR)');
    const linhas = await gastoDe(A, WABA_P);
    expect(linhas.find((l) => l.dia === '2026-11-18' && l.tipo === 'REGULAR' && l.categoria === 'SERVICE')).toMatchObject({ mensagens: 110, custo: 3.85 });
    expect(linhas.find((l) => l.dia === '2026-11-10')).toMatchObject({ mensagens: 60 });
    expect(linhas.find((l) => l.categoria === 'AUTHENTICATION')).toBeUndefined();
    expect(linhas).toHaveLength(7);
    // O gasto por modelo não foi relido (3 em 3 horas).
    expect(gasto.chamadas.some((c) => c.includes('template_analytics'))).toBe(false);
  });

  it('duas réplicas gravando o mesmo intervalo juntas: nada duplica nem quebra', async () => {
    const linhas = [{ numero: NUM_P, dia: '2026-11-18', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 2, custo: 0.07 }];
    const r = await Promise.allSettled(Array.from({ length: 4 }, () => gasto.gravarDias(D, WABA_D, '2026-11-18', '2026-11-18', linhas)));
    expect(r.filter((x) => x.status === 'rejected')).toEqual([]);
    expect(await gastoDe(D, WABA_D)).toEqual([{ numero: NUM_P, dia: '2026-11-18', categoria: 'UTILITY', tipo: 'REGULAR', mensagens: 2, custo: 0.07 }]);
    // volta o dado da empresa D como a Meta o deu
    expect(await gasto.lerConta(D, WABA_D, DEPOIS)).toEqual({ ok: true });
  });

  it('a Meta recusou: vira o motivo da leitura, a última leitura boa fica e nada é lançado', async () => {
    falhas.add(WABA_X);
    const r = await gasto.lerConta(A, WABA_X, AGORA);
    expect(r.ok).toBe(false);
    expect(r.erro).toBe('A Meta respondeu 400: Unsupported get request (código 100)');
    const [lei] = await q(`select lido_em, tentou_em, erro from whatsapp_gasto_leitura where tenant_id = $1 and waba_id = $2`, [A, WABA_X]);
    expect(lei.lido_em).toBeNull();
    expect(lei.erro).toContain('Unsupported get request');
    expect(lei.erro).not.toContain('Zz9');
    await q(`delete from whatsapp_gasto_leitura where waba_id = $1`, [WABA_X]);
  });

  it('o resumo da tela: totais, tipos, franquia, meses, "De onde veio" com a campanha — sem a outra empresa', async () => {
    const r: any = await gasto.resumo(A, {}, DEPOIS);
    expect(r.oficial).toBe(true);
    expect(r.periodo).toEqual({ tipo: 'mes', de: '2026-11-01', ate: '2026-11-18', mesCorrente: true });
    expect(r.total).toEqual({ custo: 138.91, mensagens: 1494, cobradas: 594 });
    expect(r.tipos.map((t: any) => [t.grupo, t.custo, t.cobradas, t.gratis])).toEqual([
      ['marketing', 132.54, 412, 0],
      ['utilidade', 2.52, 72, 0],
      ['atendimento', 3.85, 110, 900],
      ['autenticacao', 0, 0, 0],
    ]);
    expect(r.dias).toHaveLength(18);
    expect(r.dias.find((d: any) => d.dia === '2026-11-14')).toEqual({ dia: '2026-11-14', custo: 132.54, marketing: 132.54 });
    expect(r.projecao).toBeGreaterThan(138.91);
    expect(r.franquia).toEqual([{ numero: NUM_P, usadas: 1010, limite: 1000, papel: 'principal', final: '2210' }]);
    expect(r.meses).toEqual([
      { mes: '2026-10', custo: 3.5, cobradas: 100, mensagens: 100 },
      { mes: '2026-09', custo: 1.75, cobradas: 50, mensagens: 50 },
    ]);
    expect(r.deOndeVeio).toEqual([
      { nome: 'Sexta do burger', apoio: 'campanha de 14/11', grupo: 'marketing', mensagens: 412, custo: 132.54 },
      { nome: 'Pedido saiu para entrega', apoio: 'aviso do pedido', grupo: 'utilidade', mensagens: 10, custo: 0.35 },
      { nome: 'Respostas do robô e da equipe', apoio: '900 grátis · 110 cobradas', grupo: 'atendimento', mensagens: 1010, custo: 3.85 },
    ]);
    expect(r.numeros.map((n: any) => `${n.papel}:${n.final}`)).toEqual(['marketing:7731', 'principal:2210']);
    expect(r.leitura).toMatchObject({ erro: null, moeda: 'BRL', algumaLida: true, minutos: 30 });
    expect(r.leitura.lidoEm).toBe(AGORA.toISOString()); // a conta de marketing foi lida às 00:30Z: a mais antiga manda
    // Nada da empresa D (R$ 321,70) entrou.
    expect(JSON.stringify(r)).not.toContain('321.7');
  });

  it('o filtro de número: só o de marketing (pelo final, com ou sem o nono dígito) e o "De onde veio" da conta dele', async () => {
    const r: any = await gasto.resumo(A, { numero: '5521999997731' }, DEPOIS);
    expect(r.filtroNumero).toBe('5521999997731');
    expect(r.total.custo).toBe(132.54);
    expect(r.deOndeVeio.map((x: any) => x.nome)).toEqual(['Sexta do burger']);
    const outro: any = await gasto.resumo(A, { numero: '551133334444' }, DEPOIS); // não é da empresa: todos
    expect(outro.filtroNumero).toBeNull();
    expect(outro.total.custo).toBe(138.91);
  });

  it('o mês passado e o período inválido; a loja na conexão por QR Code não tem gasto', async () => {
    const r: any = await gasto.resumo(A, { periodo: 'passado' }, DEPOIS);
    expect(r.total.custo).toBe(3.5);
    expect(r.projecao).toBeNull();
    await expect(gasto.resumo(A, { periodo: 'outro', de: '2026-11-10', ate: '2026-11-03' }, DEPOIS)).rejects.toThrow('A data inicial vem depois da final.');
    expect(await gasto.resumo(B, {}, DEPOIS)).toEqual({ oficial: false });
  });

  it('"Tentar de novo" logo depois de uma leitura: espera 2 minutos', async () => {
    await expect(gasto.lerAgora(A, {}, new Date(DEPOIS.getTime() + 60_000))).rejects.toThrow('O Regem acabou de ler o gasto na Meta. Tente de novo em 2 minutos.');
  });
});
