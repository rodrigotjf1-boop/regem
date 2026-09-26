import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { EdgeService } from './edge.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Atualização do servidor local CONTRA UM POSTGRES DE VERDADE (V6: SQL em string só quebra
// rodando no banco).
//  • update-check escolhe o release pelas colunas da migration 270 (piloto, %, pausa, recolhido);
//  • a TRAVA DE OPERAÇÃO (caixa aberto / pedido em produção) — a mesma regra na API
//    (EdgeService.operacaoEmAndamento) e no sync-daemon (instalação agendada).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('atualizacao-edge.spec: sem TEST_PG_URL — testes da atualização contra o Postgres PULADOS');

const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const T = randomUUID();
const LOJA = randomUUID();
const OUTRA = randomUUID();
const V = `9${Math.floor(Math.random() * 900) + 100}`; // versões só deste teste: 9xxx.0.0

jest.setTimeout(60_000);

// O SQL da trava no sync-daemon (ESM, com $1 = loja) — lido do arquivo, é o que roda na loja.
function sqlDoDaemon(): string {
  const fonte = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs'), 'utf8');
  const m = /async function atualizacaoAgendada\(\)[\s\S]*?pool\.query\(\s*`([\s\S]*?)`/.exec(fonte);
  if (!m) throw new Error('SQL da trava não encontrado no sync-daemon.mjs');
  return m[1];
}

descrever('atualização do servidor local (Postgres com todas as migrations)', () => {
  let pool: Pool;
  let svc: EdgeService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const antesUnidade = process.env.EDGE_UNIDADE_ID;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new EdgeService(drizzle(pool) as any);
    // edge_release é só da nuvem (124/156/270 são @cloud-only): cria aqui como na nuvem.
    for (const f of ['124_edge_release_comando.sql', '156_edge_release_assinatura.sql', '270_edge_release_distribuicao_escalonada.sql'])
      await q(readFileSync(join(MIG, f), 'utf8'));
    await q(`insert into empresa (id, nome) values ($1,'teste atualizacao')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja'),($2,$3,'Outra')`, [LOJA, OUTRA, T]);
  });

  afterAll(async () => {
    if (antesUnidade === undefined) delete process.env.EDGE_UNIDADE_ID;
    else process.env.EDGE_UNIDADE_ID = antesUnidade;
    if (!pool) return;
    await q(`delete from edge_release where versao like $1`, [`${V}.%`]);
    await q(`delete from producao_pedido where tenant_id = $1`, [T]);
    await q(`delete from caixa_sessao where tenant_id = $1`, [T]);
    await q(`delete from unidade where tenant_id = $1`, [T]);
    await q(`delete from empresa where id = $1`, [T]);
    await pool.end();
  });

  const publicar = (versao: string, o: { percentual?: number; piloto?: string[]; pausado?: boolean; recolhido?: boolean } = {}) =>
    q(`insert into edge_release (versao, url, sha256, assinatura, assinatura_v2, expira_em, percentual, lojas_piloto, pausado, recolhido)
       values ($1, $2, $3, 's1', 's2', now() + interval '30 days', $4, $5::uuid[], $6, $7)`,
      [versao, `https://x/${versao}.zip`, 'e'.repeat(64), o.percentual ?? 100, o.piloto ?? [], !!o.pausado, !!o.recolhido]);
  const checar = async (tenant: string | null, atual = `${V}.0.0`) => {
    (EdgeService as any).cacheReleases = null;
    return svc.atualizacao(atual, tenant);
  };

  it('update-check: piloto recebe a nova, a loja comum e o anônimo não (0%)', async () => {
    await publicar(`${V}.1.0`, { percentual: 0, piloto: [T] });
    const piloto = await checar(T);
    expect(piloto).toMatchObject({ atualizar: true, ultima: `${V}.1.0`, assinaturaV2: 's2' });
    expect(piloto.expiraEm).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await checar(randomUUID())).atualizar).toBe(false);
    expect((await checar(null)).atualizar).toBe(false);
  });

  it('update-check: recolher tira a oferta e avisa quem já está na versão', async () => {
    await q(`update edge_release set recolhido = true where versao = $1`, [`${V}.1.0`]);
    expect((await checar(T)).atualizar).toBe(false);
    expect((await checar(T, `${V}.1.0`)).versaoAtualRecolhida).toBe(true);
  });

  // ERR-110: o atualizar.ps1 da 1.29.x aborta em "Parando serviços" com qualquer pacote — a
  // tela ficava em 45% e cada clique deixava uma pasta de backup. Essa loja vai pelo instalador.
  it('update-check: servidor na 1.29.x não recebe pacote nem com release em 100%', async () => {
    await publicar(`${V}.2.0`);
    expect(await checar(T)).toMatchObject({ atualizar: true, ultima: `${V}.2.0`, soInstalador: false });
    for (const tenant of [T, null]) {
      expect(await checar(tenant, '1.29.0')).toMatchObject({
        atualizar: false,
        ultima: '1.29.0',
        soInstalador: true,
        url: null,
        sha256: null,
        assinatura: null,
        assinaturaV2: null,
      });
    }
  });

  it('trava de operação: API e daemon enxergam o mesmo caixa aberto e pedido em produção', async () => {
    process.env.EDGE_UNIDADE_ID = LOJA;
    const daemon = async (loja: string | null) => (await q(sqlDoDaemon(), [loja])).rows[0];
    // Banco do CI é compartilhado: compara por DIFERENÇA a partir da linha de base.
    const base = await svc.operacaoEmAndamento();
    const baseD = await daemon(LOJA);
    expect(baseD.caixas).toBe(base.caixasAbertos);
    expect(baseD.pedidos).toBe(base.pedidosEmProducao);

    // caixa esquecido aberto há 2 dias NÃO trava; caixa da OUTRA loja também não
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status, aberta_em) values ($1,$2,'aberta', now() - interval '2 days')`, [T, LOJA]);
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status) values ($1,$2,'aberta')`, [T, OUTRA]);
    expect((await svc.operacaoEmAndamento()).caixasAbertos).toBe(base.caixasAbertos);
    expect((await daemon(LOJA)).caixas).toBe(base.caixasAbertos);

    // caixa aberto agora e pedido em preparo DESTA loja travam; pedido pronto não
    await q(`insert into caixa_sessao (tenant_id, unidade_id, status) values ($1,$2,'aberta')`, [T, LOJA]);
    await q(`insert into producao_pedido (tenant_id, unidade_id, status) values ($1,$2,'preparo')`, [T, LOJA]);
    await q(`insert into producao_pedido (tenant_id, unidade_id, status) values ($1,$2,'pronto')`, [T, LOJA]);
    const api = await svc.operacaoEmAndamento();
    expect(api.caixasAbertos).toBe(base.caixasAbertos + 1);
    expect(api.pedidosEmProducao).toBe(base.pedidosEmProducao + 1);
    const d = await daemon(LOJA);
    expect(d.caixas).toBe(api.caixasAbertos);
    expect(d.pedidos).toBe(api.pedidosEmProducao);
  });
});

// Sem release na tabela, a oferta vem do env (compat) — a trava da versão mínima vale ali também.
describe('update-check pelo env: servidor na 1.29.x não recebe pacote (ERR-110)', () => {
  const CHAVES = ['EDGE_LATEST_VERSION', 'EDGE_UPDATE_URL', 'EDGE_UPDATE_SHA256', 'EDGE_UPDATE_SIG'] as const;
  const antes: Record<string, string | undefined> = {};
  beforeAll(() => {
    for (const k of CHAVES) antes[k] = process.env[k];
    process.env.EDGE_LATEST_VERSION = '1.31.0';
    process.env.EDGE_UPDATE_URL = 'https://x/regem-edge-1.31.0.zip';
    process.env.EDGE_UPDATE_SHA256 = 'f'.repeat(64);
    process.env.EDGE_UPDATE_SIG = 's1';
  });
  afterAll(() => {
    for (const k of CHAVES) {
      if (antes[k] === undefined) delete process.env[k];
      else process.env[k] = antes[k];
    }
    (EdgeService as any).cacheReleases = null;
  });

  it('1.29.x fica sem oferta; 1.30.0 recebe', async () => {
    const svc = new EdgeService({ execute: async () => ({ rows: [] }) } as any);
    (EdgeService as any).cacheReleases = null;
    expect(await svc.atualizacao('1.29.0', null)).toMatchObject({ atualizar: false, soInstalador: true, url: null, sha256: null, assinatura: null });
    (EdgeService as any).cacheReleases = null;
    expect(await svc.atualizacao('1.30.0', null)).toMatchObject({
      atualizar: true,
      soInstalador: false,
      ultima: '1.31.0',
      url: 'https://x/regem-edge-1.31.0.zip',
    });
  });
});
