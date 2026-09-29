import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { TelemetriaBridge } from '../../../common/telemetria-bridge';
import { decifrar } from '../../../common/cifra-segredo';
import { calcularTributosAprox } from '../tributos-aproximados';
import { URL_API_IBPT } from './ibpt-api';
import { IbptService } from './ibpt.service';
import { gravarTabelaIbpt, hojeNaUf, statusIbpt, tabelaIbptDaNota } from './ibpt-tabela';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Token do IBPT do LOJISTA (mig 292) no Postgres de verdade (V6), com o webservice do IBPT FALSO
// (o `fetch` global é interceptado só para a URL do IBPT). A tabela do IBPT é global e as specs
// rodam em paralelo no mesmo banco: aqui só entra a UF RR, que nenhuma outra spec usa, e o
// sincronismo do servidor da loja roda limitado a ela (LIC-084).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ibpt-token.spec: sem TEST_PG_URL — token do IBPT contra o Postgres PULADO');

jest.setTimeout(120_000);

const TOKEN = 'TokenDoLojistaNoIbpt_0123456789abcdefWXYZ';
const CNPJ = '11222333000181';
const UF = 'RR';

const dia = (base: string, n: number) => {
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const br = (iso: string) => iso.split('-').reverse().join('/');

descrever('token do IBPT do lojista (Postgres com todas as migrations)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const hoje = hojeNaUf(UF);
  const auditoria = { registrar: jest.fn(async () => undefined) };
  const svc = new IbptService(db, auditoria as any);
  const ambiente = {
    SEGREDOS_CHAVE: process.env.SEGREDOS_CHAVE,
    EDGE_MODE: process.env.EDGE_MODE,
    CLOUD_API: process.env.CLOUD_API,
    SYNC_TOKEN: process.env.SYNC_TOKEN,
  };
  let empresaA = '';
  let empresaB = '';

  // ---- o IBPT de mentira
  const ibpt = {
    modo: 'ok' as 'ok' | 'fora',
    tokenBom: TOKEN,
    chamadas: [] as string[],
    aliquotas: {
      '21069090': { Nacional: 13.45, Importado: 15.45, Estadual: 30, Municipal: 0 },
      '22021000': { Nacional: 17.05, Importado: 19.05, Estadual: 31, Municipal: 0 },
      '19059090': { Nacional: 10, Importado: 12, Estadual: 32, Municipal: 0 },
      '04061010': { Nacional: 8, Importado: 9, Estadual: 33, Municipal: 0 },
    } as Record<string, any>,
  };
  const fetchReal = globalThis.fetch;
  let espia: jest.SpyInstance;

  async function ibptFalso(url: string): Promise<Response> {
    const u = new URL(url);
    const p = Object.fromEntries(u.searchParams);
    ibpt.chamadas.push(p.codigo);
    if (ibpt.modo === 'fora') throw new TypeError(`fetch failed ${url}`);
    if (p.token !== ibpt.tokenBom || p.cnpj !== CNPJ)
      return new Response(JSON.stringify({ Message: 'Dados da requisição inválidos.' }), { status: 400 });
    const a = ibpt.aliquotas[p.codigo];
    if (!a || p.uf !== UF) return new Response(null, { status: 404 });
    return new Response(
      JSON.stringify({
        Codigo: p.codigo, UF: p.uf, EX: 0, Descricao: 'x', Tipo: '0', ...a,
        VigenciaInicio: br(dia(hoje, -5)), VigenciaFim: br(dia(hoje, 30)),
        Chave: 'PROP01', Versao: '26.2.B', Fonte: 'IBPT/empresometro.com.br',
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const credencial = async (tenant: string) =>
    (await q(`select * from fiscal_credencial where tenant_id = $1 and unidade_id is null`, [tenant])).rows[0];
  const proprias = async (tenant: string) =>
    (await q(`select v.*, (select count(*) from ibpt_aliquota a where a.versao_id = v.id)::int as n
                from ibpt_versao v where tenant_id = $1 order by vigencia_inicio`, [tenant])).rows;

  // O disparo depois de salvar o token corre em segundo plano: espera ele terminar.
  async function esperarTabelaPropria(tenant: string) {
    for (let i = 0; i < 100; i++) {
      const s: any = await svc.situacaoDaLoja(tenant, null);
      if (s.emUso === 'propria' && (svc as any).atualizandoPropria.size === 0) return s;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    throw new Error('a tabela própria não ficou pronta');
  }

  beforeAll(async () => {
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    delete process.env.EDGE_MODE;
    espia = jest.spyOn(globalThis, 'fetch').mockImplementation(async (entrada: any, init?: any) =>
      String(entrada).startsWith(URL_API_IBPT) ? ibptFalso(String(entrada)) : fetchReal(entrada, init),
    );
    await q(`delete from ibpt_versao where uf = $1`, [UF]);
    empresaA = (await q(`insert into empresa (nome) values ('Teste token IBPT A') returning id`)).rows[0].id;
    empresaB = (await q(`insert into empresa (nome) values ('Teste token IBPT B') returning id`)).rows[0].id;
    // A: emitente da REDE (sem loja) — como a tela grava. B: sem token, mesma UF.
    await q(`insert into fiscal_config (tenant_id, uf, cnpj) values ($1, $2, $3)`, [empresaA, UF, CNPJ]);
    await q(`insert into fiscal_config (tenant_id, uf, cnpj) values ($1, $2, '99888777000166')`, [empresaB, UF]);
    for (const ncm of ['2202.10.00', '19059090'])
      await q(
        `insert into produto (tenant_id, nome, ncm, cfop, csosn, origem, unidade_trib) values ($1, $2, $3, '5102', '102', '0', 'UN')`,
        [empresaA, `Produto ${ncm}`, ncm],
      );
    // A tabela da DISTRIBUIÇÃO (a que o console recebe), com alíquotas diferentes das do IBPT falso.
    await gravarTabelaIbpt(db, {
      uf: UF, versao: '26.2.B', chave: 'DIST01', fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: dia(hoje, -5), vigenciaFim: dia(hoje, 30),
      linhas: ['21069090', '22021000', '19059090', '04061010'].map((ncm) => ({
        ncm, ex: '', nacionalFederal: 5, importadosFederal: 6, estadual: 20, municipal: 0,
      })),
    }, 'teste');
  });

  afterAll(async () => {
    espia?.mockRestore();
    for (const [k, v] of Object.entries(ambiente)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    TelemetriaBridge.registrar(null as any);
    await q(`delete from ibpt_versao where uf = $1`, [UF]);
    for (const t of [empresaA, empresaB]) if (t) await q('delete from empresa where id = $1', [t]);
    await pool.end();
  }, 60_000);

  it('sem token nada muda: vale a tabela da Regem', async () => {
    const s: any = await svc.situacaoDaLoja(empresaA, null);
    expect(s).toMatchObject({
      uf: UF, cnpj: CNPJ, protecaoConfigurada: true, servidorLocal: false, emUso: 'regem', tabelaPropria: null,
      tabelaRegem: { versao: '26.2.B', chave: 'DIST01' },
      token: { configurado: false, final: null, status: null },
    });
    // Os NCMs dos produtos + o da linha da taxa de serviço.
    expect(s.ncms).toBe(3);
  });

  it('token com formato impossível é recusado sem chamar o IBPT; token que o IBPT recusa não é guardado', async () => {
    ibpt.chamadas = [];
    await expect(svc.salvarToken(empresaA, null, null, 'curto')).rejects.toThrow('Token inválido');
    expect(ibpt.chamadas).toEqual([]);
    await expect(svc.salvarToken(empresaA, null, null, 'OutroTokenQueNaoEhDaEmpresa_12345678')).rejects.toThrow(
      `O IBPT recusou este token para o CNPJ ${CNPJ}`,
    );
    expect(ibpt.chamadas).toEqual(['21069090']);
    expect((await credencial(empresaA))?.ibpt_token_cifrado ?? null).toBeNull();
    expect(auditoria.registrar).not.toHaveBeenCalled();
  });

  it('token bom: guarda CIFRADO, audita sem o token, e a tabela própria nasce sozinha', async () => {
    ibpt.chamadas = [];
    const r: any = await svc.salvarToken(empresaA, null, null, `  ${TOKEN}  `);
    expect(r.token).toMatchObject({ configurado: true, escopo: 'rede', final: 'WXYZ', status: 'ok' });
    expect(JSON.stringify(r)).not.toContain(TOKEN);

    const c = await credencial(empresaA);
    expect(c.ibpt_token_cifrado).not.toContain(TOKEN);
    expect(decifrar(c.ibpt_token_cifrado)).toBe(TOKEN);
    expect(c.ibpt_token_final).toBe('WXYZ');

    expect(auditoria.registrar).toHaveBeenCalledTimes(1);
    expect(auditoria.registrar.mock.calls[0]).toEqual([
      expect.objectContaining({ tenantId: empresaA, acao: 'cadastrou_token_ibpt', detalhe: { unidadeId: null, final: 'WXYZ', status: 'ok' } }),
    ]);
    expect(JSON.stringify(auditoria.registrar.mock.calls)).not.toContain(TOKEN);

    const s = await esperarTabelaPropria(empresaA);
    expect(s).toMatchObject({ emUso: 'propria', ncmsSemPropria: 0, tabelaPropria: { versao: '26.2.B', chave: 'PROP01', linhas: 3 } });
    // Sonda ao salvar + sonda do job + só os NCMs que faltavam (o da sonda já entrou).
    expect(ibpt.chamadas.sort()).toEqual(['19059090', '21069090', '21069090', '22021000']);
    const [v] = await proprias(empresaA);
    expect(v).toMatchObject({ tenant_id: empresaA, uf: UF, versao: '26.2.B', chave: 'PROP01', n: 3, importada_por: 'ibpt-api' });
  });

  it('emissão: a própria quando cobre TODOS os NCMs da nota; senão a da Regem inteira — nunca mistura', async () => {
    const propria = await tabelaIbptDaNota(db, UF, ['22021000', '1905.90.90'], hoje, empresaA);
    expect(propria).toMatchObject({ chave: 'PROP01', propria: true });
    expect(propria!.aliquotas['22021000']).toEqual({ nacionalFederal: 17.05, importadosFederal: 19.05, estadual: 31, municipal: 0 });
    expect(calcularTributosAprox([{ ncm: '22021000', base: 10 }], propria!).resumo).toMatchObject({ chave: 'PROP01', propria: true });

    // 04061010 não está na própria (nenhum produto tinha): a nota INTEIRA usa a da Regem.
    const mista = await tabelaIbptDaNota(db, UF, ['22021000', '04061010'], hoje, empresaA);
    expect(mista).toMatchObject({ chave: 'DIST01' });
    expect(mista!.propria).toBeUndefined();
    expect(mista!.aliquotas['22021000']).toEqual({ nacionalFederal: 5, importadosFederal: 6, estadual: 20, municipal: 0 });
    expect(calcularTributosAprox([{ ncm: '22021000', base: 10 }], mista!).resumo.propria).toBeUndefined();

    // Outra empresa (sem token) e a chamada sem empresa ficam na da Regem.
    expect(await tabelaIbptDaNota(db, UF, ['22021000'], hoje, empresaB)).toMatchObject({ chave: 'DIST01' });
    expect(await tabelaIbptDaNota(db, UF, ['22021000'], hoje)).toMatchObject({ chave: 'DIST01' });

    // O console da distribuição só enxerga a tabela da distribuição.
    expect((await statusIbpt(db, hoje, [UF]))[0].vigente).toMatchObject({ chave: 'DIST01', tenantId: null });
  });

  it('rodada seguinte: só a sonda; produto novo → consulta só o NCM novo', async () => {
    ibpt.chamadas = [];
    expect((await svc.atualizarTabelasProprias([empresaA])).atualizadas).toEqual([`${empresaA} ${UF} 26.2.B`]);
    expect(ibpt.chamadas).toEqual(['21069090']);

    await q(
      `insert into produto (tenant_id, nome, ncm, cfop, csosn, origem, unidade_trib) values ($1, 'Queijo', '04061010', '5102', '102', '0', 'UN')`,
      [empresaA],
    );
    ibpt.chamadas = [];
    await svc.atualizarTabelasProprias([empresaA]);
    expect(ibpt.chamadas).toEqual(['21069090', '04061010']);
    expect(await svc.situacaoDaLoja(empresaA, null)).toMatchObject({ emUso: 'propria', ncms: 4, ncmsSemPropria: 0 });
    expect((await proprias(empresaA))[0]).toMatchObject({ n: 4, linhas: 4 });
  });

  it('IBPT fora do ar: marca "erro", não insiste e a tabela própria fica', async () => {
    ibpt.modo = 'fora';
    try {
      await svc.atualizarTabelasProprias([empresaA]);
    } finally {
      ibpt.modo = 'ok';
    }
    const c = await credencial(empresaA);
    expect(c.ibpt_status).toBe('erro');
    expect(c.ibpt_mensagem).toBe('Sem conexão com o IBPT. Tento de novo amanhã.');
    expect(c.ibpt_mensagem).not.toContain(TOKEN);
    expect(await proprias(empresaA)).toHaveLength(1);
  });

  it('token recusado no job: marca "inválido", avisa a telemetria da empresa e a tabela vigente fica', async () => {
    const avisos: any[] = [];
    TelemetriaBridge.registrar((tenantId, dto) => avisos.push({ tenantId, ...dto }));
    ibpt.tokenBom = 'OutroTokenAgora_quando_o_lojista_trocou_no_site';
    try {
      await svc.atualizarTabelasProprias([empresaA]);
    } finally {
      ibpt.tokenBom = TOKEN;
    }
    const c = await credencial(empresaA);
    expect(c.ibpt_status).toBe('invalido');
    expect(c.ibpt_mensagem).toContain(`CNPJ ${CNPJ}`);
    expect(avisos).toEqual([expect.objectContaining({ tenantId: empresaA, tipo: 'ibpt_token_invalido', origem: 'fiscal' })]);
    expect(JSON.stringify(avisos)).not.toContain(TOKEN);
    expect(await proprias(empresaA)).toHaveLength(1);
    // Volta a funcionar na rodada seguinte, sozinho.
    await svc.atualizarTabelasProprias([empresaA]);
    expect((await credencial(empresaA)).ibpt_status).toBe('ok');
  });

  it('servidor da loja: recebe a tabela própria pelo token de sync e apaga a cópia quando a nuvem diz 404', async () => {
    // NUVEM: o pacote é da empresa do token de sync.
    const pacote: any = await svc.pacotePropriaParaLoja(empresaA, 'rr', '');
    expect(pacote).toMatchObject({ uf: UF, versao: '26.2.B', chave: 'PROP01', tenantId: empresaA });
    expect(pacote.linhas).toHaveLength(4);
    const tenho = `26.2.B|PROP01|${dia(hoje, 30)}|4`;
    expect(await svc.pacotePropriaParaLoja(empresaA, UF, tenho)).toBe('igual');
    expect(await svc.pacotePropriaParaLoja(empresaB, UF, '')).toBeNull();

    // LOJA: o banco é o mesmo, então a própria sai antes e volta pela "nuvem" falsa.
    await q(`delete from ibpt_versao where tenant_id = $1`, [empresaA]);
    let semPropria = false;
    const pedidos: string[] = [];
    const servidor: Server = createServer((req, res) => {
      const u = new URL(req.url ?? '/', 'http://x');
      pedidos.push(`${u.pathname}?${u.searchParams.get('tenho')} ${req.headers['x-sync-token']}`);
      if (u.pathname === `/api/v1/fiscal/ibpt/${UF}`) return void res.writeHead(204).end();
      if (u.pathname !== `/api/v1/fiscal/ibpt/${UF}/propria` || semPropria) return void res.writeHead(404).end('{}');
      if (u.searchParams.get('tenho') === tenho) return void res.writeHead(204).end();
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(pacote));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-de-sync-da-loja';
      expect((await svc.sincronizarDaNuvem([UF])).atualizadas).toEqual([`${UF} 26.2.B (própria)`]);
      expect(await proprias(empresaA)).toEqual([expect.objectContaining({ tenant_id: empresaA, chave: 'PROP01', n: 4, importada_por: 'nuvem' })]);
      expect(pedidos).toContain(`/api/v1/fiscal/ibpt/${UF}/propria? token-de-sync-da-loja`);
      // Nada mudou: a loja diz o que tem (com o número de linhas) e recebe 204.
      expect((await svc.sincronizarDaNuvem([UF])).atualizadas).toEqual([]);
      expect(pedidos.at(-1)).toBe(`/api/v1/fiscal/ibpt/${UF}/propria?${tenho} token-de-sync-da-loja`);
      // Token removido na nuvem → 404 → a loja volta à tabela da Regem.
      semPropria = true;
      await svc.sincronizarDaNuvem([UF]);
      expect(await proprias(empresaA)).toEqual([]);
      expect(await tabelaIbptDaNota(db, UF, ['22021000'], hoje, empresaA)).toMatchObject({ chave: 'DIST01' });
      // No servidor da loja o token não se mexe e o job da nuvem não roda (ERR-075); a tela avisa.
      expect(await svc.situacaoDaLoja(empresaA, null)).toMatchObject({ servidorLocal: true, emUso: 'regem' });
      await expect(svc.salvarToken(empresaA, null, null, TOKEN)).rejects.toThrow('na nuvem');
      await expect(svc.removerToken(empresaA, null, null)).rejects.toThrow('na nuvem');
      expect(await svc.atualizarTabelasProprias([empresaA])).toEqual({ atualizadas: [] });
    } finally {
      delete process.env.EDGE_MODE;
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });

  it('remover o token: some o token e a tabela própria; a loja volta à da Regem', async () => {
    await svc.atualizarTabelasProprias([empresaA]); // refaz a própria (o teste anterior apagou)
    expect(await proprias(empresaA)).toHaveLength(1);
    auditoria.registrar.mockClear();
    const s: any = await svc.removerToken(empresaA, null, null);
    expect(s).toMatchObject({ emUso: 'regem', tabelaPropria: null, token: { configurado: false } });
    expect(await proprias(empresaA)).toEqual([]);
    const c = await credencial(empresaA);
    expect([c.ibpt_token_cifrado, c.ibpt_token_final, c.ibpt_status]).toEqual([null, null, null]);
    expect(auditoria.registrar).toHaveBeenCalledWith(
      expect.objectContaining({ acao: 'removeu_token_ibpt', detalhe: { unidadeId: null, final: 'WXYZ' } }),
    );
    await expect(svc.removerToken(empresaA, null, null)).rejects.toThrow('Não há token');
    // A tabela da Regem nunca é tocada.
    expect(await tabelaIbptDaNota(db, UF, ['22021000'], hoje, empresaA)).toMatchObject({ chave: 'DIST01' });
  });
});
