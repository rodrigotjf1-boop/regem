import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TelemetriaBridge } from '../../../common/telemetria-bridge';
import { IbptService } from './ibpt.service';
import {
  gravarTabelaIbpt,
  hojeNaUf,
  podarVersoesIbpt,
  statusIbpt,
  tabelaIbptDaNota,
  versaoVigente,
} from './ibpt-tabela';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Tabela do IBPT no Postgres de verdade (V6). A tabela é GLOBAL (sem empresa) e as specs rodam em
// paralelo no mesmo banco: aqui só entram UFs que nenhuma outra spec usa (AC, AP, TO), e o
// verificador roda limitado a elas (LIC-084).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ibpt.spec: sem TEST_PG_URL — tabela do IBPT contra o Postgres PULADA');

jest.setTimeout(120_000);

const dia = (base: string, n: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Uma UF inteira de mentira: `n` NCMs, fora os que o teste lê.
function linhas(n: number, fixo: { ncm: string; nf: number; es: number }[] = []) {
  const l = fixo.map((f) => ({ ncm: f.ncm, ex: '', nacionalFederal: f.nf, importadosFederal: f.nf + 10, estadual: f.es, municipal: 0 }));
  for (let i = 0; l.length < n; i++)
    l.push({ ncm: String(10000000 + i), ex: '', nacionalFederal: 5, importadosFederal: 9, estadual: 12, municipal: 0 });
  return l;
}

descrever('tabela do IBPT (Postgres com todas as migrations)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const hoje = hojeNaUf(null);
  const edgeAntes = process.env.EDGE_MODE;
  const cloudAntes = process.env.CLOUD_API;
  const tokenAntes = process.env.SYNC_TOKEN;
  let tenant = '';

  beforeAll(async () => {
    await q(`delete from ibpt_versao where uf in ('AC','AP','TO')`);
    tenant = (await q(`insert into empresa (nome) values ('Teste IBPT') returning id`)).rows[0].id;
    // Uma loja com fiscal em cada UF — é o que faz o verificador se importar com elas (a config é
    // uma por empresa + loja).
    for (const uf of ['AC', 'AP', 'TO']) {
      const loja = (await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [tenant, `Loja ${uf}`])).rows[0].id;
      await q(`insert into fiscal_config (tenant_id, unidade_id, uf) values ($1, $2, $3)`, [tenant, loja, uf]);
    }
  });

  afterAll(async () => {
    for (const [k, v] of [['EDGE_MODE', edgeAntes], ['CLOUD_API', cloudAntes], ['SYNC_TOKEN', tokenAntes]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    TelemetriaBridge.registrar(null as any);
    await q(`delete from ibpt_versao where uf in ('AC','AP','TO')`);
    if (tenant) await q('delete from empresa where id = $1', [tenant]);
    await pool.end();
  }, 60_000);

  it('grava em lote e é idempotente: reenviar a mesma versão (vigência estendida) troca as linhas', async () => {
    const t = {
      uf: 'AC', versao: '26.2.A', chave: 'AAA111', fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: dia(hoje, -30), vigenciaFim: dia(hoje, 3),
      linhas: linhas(9000, [{ ncm: '21069090', nf: 13.45, es: 20 }]),
    };
    const a = await gravarTabelaIbpt(db, t, 'teste');
    expect(a.nova).toBe(true);
    expect(a.versao).toMatchObject({ uf: 'AC', versao: '26.2.A', linhas: 9000, vigenciaFim: dia(hoje, 3) });
    const n = async (id: string) => Number((await q('select count(*) from ibpt_aliquota where versao_id = $1', [id])).rows[0].count);
    expect(await n(a.versao.id)).toBe(9000);
    // O IBPT estende a vigência de uma versão sem trocar a chave: a mesma linha, vigência nova.
    const b = await gravarTabelaIbpt(db, { ...t, vigenciaFim: dia(hoje, 4), linhas: linhas(8000, [{ ncm: '21069090', nf: 13.45, es: 20 }]) }, 'teste');
    expect(b.nova).toBe(false);
    expect(b.versao.id).toBe(a.versao.id);
    expect(b.versao.vigenciaFim).toBe(dia(hoje, 4));
    expect(await n(a.versao.id)).toBe(8000);
  });

  it('vigências sobrepostas: vale a MAIS RECENTE que inclui o dia; nenhuma = sem tabela', async () => {
    // 26.2.A (acima) vai até hoje+4; a 26.2.B começa hoje-2 e vai até hoje+40.
    await gravarTabelaIbpt(db, {
      uf: 'AC', versao: '26.2.B', chave: 'BBB222', fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: dia(hoje, -2), vigenciaFim: dia(hoje, 40),
      linhas: linhas(6000, [{ ncm: '21069090', nf: 14, es: 20 }, { ncm: '22021000', nf: 17.05, es: 18 }]),
    }, 'teste');
    expect((await versaoVigente(db, 'AC', hoje))?.versao).toBe('26.2.B');
    expect((await versaoVigente(db, 'AC', dia(hoje, -10)))?.versao).toBe('26.2.A');
    expect(await versaoVigente(db, 'AC', dia(hoje, 41))).toBeNull();
    expect(await versaoVigente(db, 'AP', hoje)).toBeNull();
  });

  it('a emissão recebe só os NCMs da nota (sem exceção de TIPI), da versão vigente', async () => {
    const t = await tabelaIbptDaNota(db, 'ac', ['2106.90.90', '22021000', '99999999', null], hoje);
    expect(t).toMatchObject({ versao: '26.2.B', chave: 'BBB222', fonte: 'IBPT/empresometro.com.br' });
    expect(Object.keys(t!.aliquotas).sort()).toEqual(['21069090', '22021000']);
    expect(t!.aliquotas['21069090']).toEqual({ nacionalFederal: 14, importadosFederal: 24, estadual: 20, municipal: 0 });
    expect(await tabelaIbptDaNota(db, 'AP', ['21069090'], hoje)).toBeNull();
    expect(await tabelaIbptDaNota(db, null, ['21069090'], hoje)).toBeNull();
  });

  it('poda: versão vencida há mais de 60 dias sai, com as linhas', async () => {
    const velha = await gravarTabelaIbpt(db, {
      uf: 'AC', versao: '25.2.A', chave: 'OLD000', fonte: 'IBPT', vigenciaInicio: dia(hoje, -120), vigenciaFim: dia(hoje, -61), linhas: linhas(10),
    }, 'teste');
    expect(await podarVersoesIbpt(db, 'AC', hoje)).toBe(1);
    expect((await q('select count(*) from ibpt_aliquota where versao_id = $1', [velha.versao.id])).rows[0].count).toBe('0');
    expect(await versaoVigente(db, 'AC', hoje)).not.toBeNull(); // as vigentes ficam
  });

  it('servidor da loja: baixa a tabela da UF dele da nuvem só quando muda', async () => {
    const svc = new IbptService(db, { registrar: jest.fn() } as any);
    // A NUVEM (o mesmo serviço, sem EDGE_MODE) monta o pacote da TO a partir do banco dela.
    delete process.env.EDGE_MODE;
    await gravarTabelaIbpt(db, {
      uf: 'TO', versao: '26.2.B', chave: 'TOK333', fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: dia(hoje, -5), vigenciaFim: dia(hoje, 30), linhas: linhas(1200, [{ ncm: '21069090', nf: 11, es: 18 }]),
    }, 'teste');
    const pacote: any = await svc.pacoteParaLoja('to', '');
    expect(pacote).toMatchObject({ uf: 'TO', versao: '26.2.B', chave: 'TOK333' });
    expect(pacote.linhas).toHaveLength(1200);
    expect(await svc.pacoteParaLoja('TO', `26.2.B|TOK333|${dia(hoje, 30)}`)).toBe('igual');
    expect(await svc.pacoteParaLoja('AP', '')).toBeNull();
    await expect(svc.pacoteParaLoja('XX', '')).rejects.toThrow('UF inválida');

    // Nuvem falsa servindo esse pacote; o banco da "loja" é o mesmo, então a TO sai dele antes.
    await q(`delete from ibpt_versao where uf = 'TO'`);
    const pedidos: string[] = [];
    const servidor: Server = createServer((req, res) => {
      pedidos.push(`${req.url} token=${req.headers['x-sync-token']}`);
      const u = new URL(req.url ?? '/', 'http://x');
      if (u.pathname !== '/api/v1/fiscal/ibpt/TO') return void res.writeHead(404).end('{}');
      if (u.searchParams.get('tenho') === `26.2.B|TOK333|${dia(hoje, 30)}`) return void res.writeHead(204).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(pacote));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-da-loja';
      const primeira = await svc.sincronizarDaNuvem(['TO']);
      expect(primeira.atualizadas).toEqual(['TO 26.2.B']);
      // Primeira vez: a loja não tem nada ("tenho" vazio) e se identifica com o token de sync.
      expect(pedidos.find((p) => p.includes('/fiscal/ibpt/TO'))).toBe('/api/v1/fiscal/ibpt/TO?tenho= token=token-da-loja');
      expect((await versaoVigente(db, 'TO', hojeNaUf('TO')))?.chave).toBe('TOK333');
      // Na segunda vez ela diz o que tem, e a nuvem responde "nada mudou".
      const segunda = await svc.sincronizarDaNuvem(['TO']);
      expect(segunda.atualizadas).toEqual([]);
      expect(pedidos.filter((p) => p.includes('/fiscal/ibpt/TO?')).at(-1)).toContain(encodeURIComponent(`26.2.B|TOK333|${dia(hoje, 30)}`));
    } finally {
      delete process.env.EDGE_MODE;
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });

  it('pacote cortado pela rede não substitui a tabela boa da loja', async () => {
    const svc = new IbptService(db, { registrar: jest.fn() } as any);
    const cortado = { uf: 'TO', versao: '26.2.C', chave: 'TOK444', fonte: 'IBPT', vigenciaInicio: dia(hoje, -1), vigenciaFim: dia(hoje, 60), linhas: [['21069090', '', 1, 1, 1, 0]] };
    const servidor: Server = createServer((req, res) => {
      if (!String(req.url).startsWith('/api/v1/fiscal/ibpt/TO')) return void res.writeHead(404).end('{}');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(cortado));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-da-loja';
      expect((await svc.sincronizarDaNuvem(['TO'])).atualizadas).toEqual([]);
      expect((await versaoVigente(db, 'TO', hojeNaUf('TO')))?.chave).toBe('TOK333');
    } finally {
      delete process.env.EDGE_MODE;
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });

  it('verificador (nuvem): vencendo sem a próxima e sem tabela viram aviso na telemetria; em dia, não', async () => {
    // AC: a 26.2.B vale até hoje+40 (em dia). Para "vencer logo", uma UF só com versão acabando.
    await q(`delete from ibpt_versao where uf = 'AC'`);
    await gravarTabelaIbpt(db, {
      uf: 'AC', versao: '26.2.A', chave: 'AAA111', fonte: 'IBPT', vigenciaInicio: dia(hoje, -30), vigenciaFim: dia(hoje, 3), linhas: linhas(10),
    }, 'teste');
    const avisos: any[] = [];
    TelemetriaBridge.registrar((tenantId, dto) => avisos.push({ tenantId, ...dto }));
    const svc = new IbptService(db, { registrar: jest.fn() } as any);
    const st = await svc.verificarVigencias(['AC', 'AP', 'TO']);
    const porUf = Object.fromEntries(st.map((s) => [s.uf, s]));
    expect(porUf.AC).toMatchObject({ situacao: 'vence_logo', lojas: 1, diasParaVencer: 3 });
    expect(porUf.AP).toMatchObject({ situacao: 'sem_tabela', lojas: 1, vigente: null });
    expect(porUf.TO).toMatchObject({ situacao: 'ok' });
    expect(avisos.map((a) => a.tipo).sort()).toEqual(['ibpt_sem_tabela', 'ibpt_vence_logo']);
    expect(avisos.every((a) => a.tenantId === null && a.origem === 'fiscal')).toBe(true);
    expect(avisos.find((a) => a.tipo === 'ibpt_vence_logo').mensagem).toContain('AC');

    // Com a PRÓXIMA já enviada, a troca é sozinha — não há o que avisar.
    await gravarTabelaIbpt(db, {
      uf: 'AC', versao: '26.2.B', chave: 'BBB222', fonte: 'IBPT', vigenciaInicio: dia(hoje, 2), vigenciaFim: dia(hoje, 45), linhas: linhas(10),
    }, 'teste');
    const depois = (await statusIbpt(db, hoje, ['AC']))[0];
    expect(depois).toMatchObject({ situacao: 'ok', proxima: { versao: '26.2.B' } });

    // No servidor da loja o verificador não roda (ERR-075).
    process.env.EDGE_MODE = 'true';
    try {
      expect(await svc.verificarVigencias(['AC'])).toEqual([]);
    } finally {
      delete process.env.EDGE_MODE;
    }
  });
});
