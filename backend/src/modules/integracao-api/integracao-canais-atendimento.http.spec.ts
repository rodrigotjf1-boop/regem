import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AtendimentoIntegracaoService } from './atendimento-integracao.service';
import { ESCOPOS_COM_CARIMBO } from './escopos';
import { IntegracaoApiController } from './integracao-api.controller';
import { ESCOPOS_KEY, IntegracaoTokenGuard, type IntegracaoCtxData } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS CANAIS DA CENTRAL DE ATENDIMENTO PELA PORTA (mig 398, pedido Z12 do Liame), contra o Postgres real, pela guarda de
// verdade da porta (`IntegracaoTokenGuard`) e pelo serviço da rota.
//
// O banco do CI é montado como servidor de loja: as tabelas só da nuvem sobem num schema SÓ DESTE TESTE, na frente do
// `public`, sem chave estrangeira (LIC-088) — as da porta (295, 303, 323, 374 e a 398, com a conferência dela) e as duas
// contas da Meta, tiradas das migrations de verdade (377 e 386: as colunas como estão na nuvem, V6).
//
// O que se prova:
//   • o console dá o escopo novo ao Liame e a mais ninguém;
//   • a resposta: só o id e o @ do Instagram e o id da página — nunca o acesso, o nome da página, mensagem ou cliente;
//   • é da EMPRESA do token (a outra loja dela vê o mesmo; outra empresa só vê as dela); sem conta, listas vazias;
//     desconectar tira a conta na hora;
//   • sem o escopo, 403; só o escopo novo abre só esta rota e não liga o carimbador das vendas (V51);
//   • a loja apagada e o acesso revogado não leem nada (V75).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-canais-atendimento.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/** O `create table` de UMA tabela da migration, como vai para a nuvem, sem as chaves estrangeiras (LIC-088). */
function tabelaDaMigration(arquivo: string, tabela: string): string {
  const s = mig(arquivo);
  const ini = s.indexOf(`create table if not exists ${tabela} (`);
  if (ini < 0) throw new Error(`${tabela} não está na ${arquivo}`);
  const fim = s.indexOf('\n);', ini);
  return s.slice(ini, fim + 3).replace(/\s+references\s+\w+\s*\(\s*id\s*\)(\s+on\s+delete\s+(cascade|set null))?/gi, '');
}

const ESCOPOS_LIAME = ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'atendimento.canais.ler'];
const IG = '17841400000000001';
const PAGINA = '100000000000001';
const IG_OUTRA = '17841400000000099';

/** Todo nome de campo de um JSON, em qualquer profundidade. */
function nomesDosCampos(v: unknown, achados = new Set<string>()): Set<string> {
  if (Array.isArray(v)) for (const x of v) nomesDosCampos(x, achados);
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      achados.add(k);
      nomesDosCampos(x, achados);
    }
  }
  return achados;
}

descrever('API de integração — canais da Central de atendimento (Liame)', () => {
  const SCHEMA = `teste_integracao_canais_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 4 });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const guarda = new IntegracaoTokenGuard(tokensSvc, new Reflector());
  const svc = new AtendimentoIntegracaoService(db);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  type Emp = { tenant: string; loja: string; loja2: string; presidente: string };
  let E: Emp; // a empresa com o Instagram e o Messenger conectados (duas lojas)
  let F: Emp; // outra empresa, com o Instagram dela
  let G: Emp; // uma empresa sem conta conectada

  async function empresa(nome: string): Promise<Emp> {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, 'Centro', 'matriz') returning id`, [e.id]);
    const [u2] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, 'Bairro', 'filial') returning id`, [e.id]);
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente', $2) returning id`, [e.id, f.id]);
    return { tenant: e.id, loja: u.id, loja2: u2.id, presidente: c.id };
  }

  const emitir = (emp: Emp, cliente: string, escopos: string[], loja: string = emp.loja) =>
    tokensSvc.emitir(
      { tenantId: emp.tenant, unidadeId: loja, cliente, autorizadoPor: emp.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    ) as Promise<{ id: string; token: string }>;

  function contexto(metodo: string, token: string) {
    const req: any = { headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.1', originalUrl: `/api/v1/${metodo}`, url: `/api/v1/${metodo}` };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => (IntegracaoApiController.prototype as any)[metodo],
        getClass: () => IntegracaoApiController,
      } as any,
    };
  }

  async function recusa(p: Promise<unknown>) {
    try {
      await p;
      return 'passou';
    } catch (e: any) {
      return e instanceof ProblemaException ? e.getStatus() : e instanceof UnauthorizedException ? 401 : `erro: ${e?.message}`;
    }
  }

  /** A rota como ela responde: a guarda de verdade monta o acesso, o serviço lê. */
  async function canais(token: string): Promise<any> {
    const { ctx, req } = contexto('canaisDoAtendimento', token);
    await guarda.canActivate(ctx);
    return svc.canais(req.integracao as IntegracaoCtxData);
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API de integração é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    const aplicar = (sqlDaMigration: string) => repetirNaCorridaDeCatalogo(() => pool.query(sqlDaMigration));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    await aplicar(mig('323_integracao_gogem.sql'));
    await aplicar(mig('374_integracao_orzuni_catalogo_ifood.sql'));
    // A 398 como vai para a nuvem — a conferência dela, linha a linha — e de novo (idempotente).
    const r = (await aplicar(mig('398_integracao_canais_atendimento.sql'))) as unknown as any[];
    const conferencia = r[r.length - 1].rows;
    expect(conferencia).toHaveLength(4);
    if (conferencia.some((l: any) => !l.ok)) throw new Error(`conferência da 398: ${JSON.stringify(conferencia)}`);
    await aplicar(mig('398_integracao_canais_atendimento.sql'));
    // As contas da Meta, com as colunas como estão na nuvem.
    await aplicar(tabelaDaMigration('377_instagram_direct.sql', 'instagram_conta'));
    await aplicar(tabelaDaMigration('386_messenger.sql', 'messenger_conta'));

    E = await empresa('Brasa');
    F = await empresa('Outra');
    G = await empresa('Sem conta');
    await q(
      `insert into instagram_conta (tenant_id, ig_user_id, usuario, nome, token_cifrado, permissoes)
       values ($1, $2, 'brasa.burger', 'Brasa Burger', 'SEGREDO-DO-INSTAGRAM', 'instagram_business_manage_messages')`,
      [E.tenant, IG],
    );
    await q(
      `insert into messenger_conta (tenant_id, pagina_id, pagina_nome, token_cifrado) values ($1, $2, 'Página da Brasa', 'SEGREDO-DO-MESSENGER')`,
      [E.tenant, PAGINA],
    );
    await q(`insert into instagram_conta (tenant_id, ig_user_id, usuario, token_cifrado) values ($1, $2, null, 'SEGREDO-DA-OUTRA')`, [F.tenant, IG_OUTRA]);
  });

  afterAll(async () => {
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await pool.end();
  }, 60_000);

  it('o console dá o escopo novo ao Liame e a mais ninguém', async () => {
    const ok = await emitir(E, 'liame', ESCOPOS_LIAME);
    const [t] = await q(`select cliente, escopos from integracao_token_loja where id = $1`, [ok.id]);
    expect(t).toEqual({ cliente: 'liame', escopos: ESCOPOS_LIAME });
    await expect(emitir(E, 'farol', ['catalogo.ler', 'atendimento.canais.ler'])).rejects.toThrow(/não vale para o Farol: atendimento\.canais\.ler/);
    await expect(emitir(E, 'orzuni', ['catalogo.ler', 'atendimento.canais.ler'])).rejects.toThrow(/não vale para o Orzuni: atendimento\.canais\.ler/);
    await expect(emitir(E, 'gogem', ['totem.catalogo.ler', 'atendimento.canais.ler'])).rejects.toThrow(/não vale para o GoGeM: atendimento\.canais\.ler/);
  });

  it('as contas conectadas da empresa: só o id e o @ — nunca o acesso, o nome da página, mensagem ou cliente', async () => {
    const { token } = await emitir(E, 'liame', ESCOPOS_LIAME);
    const r = await canais(token);
    expect(r).toEqual({ instagram: [{ ig_user_id: IG, usuario: 'brasa.burger' }], messenger: [{ pagina_id: PAGINA }] });
    expect([...nomesDosCampos(r)].sort()).toEqual(['ig_user_id', 'instagram', 'messenger', 'pagina_id', 'usuario']);
    expect(JSON.stringify(r)).not.toMatch(/SEGREDO|Página da Brasa|Brasa Burger|instagram_business/);
  });

  it('é da EMPRESA do token: a outra loja dela vê as mesmas contas; outra empresa só vê as dela (sem o @, null)', async () => {
    const daOutraLoja = (await emitir(E, 'liame', ESCOPOS_LIAME, E.loja2)).token;
    expect(await canais(daOutraLoja)).toEqual({ instagram: [{ ig_user_id: IG, usuario: 'brasa.burger' }], messenger: [{ pagina_id: PAGINA }] });
    const daOutraEmpresa = (await emitir(F, 'liame', ESCOPOS_LIAME)).token;
    expect(await canais(daOutraEmpresa)).toEqual({ instagram: [{ ig_user_id: IG_OUTRA, usuario: null }], messenger: [] });
  });

  it('sem conta conectada: listas vazias; desconectar tira a conta na hora', async () => {
    expect(await canais((await emitir(G, 'liame', ESCOPOS_LIAME)).token)).toEqual({ instagram: [], messenger: [] });
    const { token } = await emitir(E, 'liame', ESCOPOS_LIAME);
    await q(`delete from messenger_conta where tenant_id = $1`, [E.tenant]);
    try {
      expect(await canais(token)).toEqual({ instagram: [{ ig_user_id: IG, usuario: 'brasa.burger' }], messenger: [] });
    } finally {
      await q(`insert into messenger_conta (tenant_id, pagina_id, pagina_nome, token_cifrado) values ($1, $2, 'Página da Brasa', 'SEGREDO-DO-MESSENGER')`, [
        E.tenant,
        PAGINA,
      ]);
    }
  });

  it('sem o escopo: 403; só o escopo novo abre só esta rota e não liga o carimbador das vendas (V51)', async () => {
    const semEle = (await emitir(E, 'liame', ['pedidos.ler'])).token;
    expect(await recusa(guarda.canActivate(contexto('canaisDoAtendimento', semEle).ctx))).toBe(403);

    const soEle = await emitir(E, 'liame', ['atendimento.canais.ler']);
    // TODAS as rotas com escopo da porta (lista fechada: rota nova com escopo entra sozinha aqui) — só esta passa.
    const leituras = Object.getOwnPropertyNames(IntegracaoApiController.prototype).filter(
      (m) => m !== 'constructor' && (Reflect.getMetadata(ESCOPOS_KEY, (IntegracaoApiController.prototype as any)[m]) ?? []).length > 0,
    );
    expect(leituras).toContain('canaisDoAtendimento');
    const resultado = Object.fromEntries(
      await Promise.all(leituras.map(async (m) => [m, await recusa(guarda.canActivate(contexto(m, soEle.token).ctx))])),
    );
    for (const [m, r] of Object.entries(resultado)) expect([m, r]).toEqual([m, m === 'canaisDoAtendimento' ? 'passou' : 403]);

    // O carimbador das vendas só liga para o acesso com escopo de venda, cliente ou cupom (a mesma condição dele).
    expect(ESCOPOS_COM_CARIMBO).not.toContain('atendimento.canais.ler');
    const [c] = await q(`select escopos && $2::text[] as liga from integracao_token_loja where id = $1`, [soEle.id, [...ESCOPOS_COM_CARIMBO]]);
    expect(c.liga).toBe(false);
  });

  it('a loja apagada e o acesso revogado não leem nada (V75)', async () => {
    const daLoja2 = (await emitir(E, 'liame', ESCOPOS_LIAME, E.loja2)).token;
    await q(`update unidade set deleted_at = now() where id = $1`, [E.loja2]);
    try {
      expect(await recusa(canais(daLoja2))).toBe(401);
    } finally {
      await q(`update unidade set deleted_at = null where id = $1`, [E.loja2]);
    }
    const revogado = await emitir(E, 'liame', ESCOPOS_LIAME);
    await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [revogado.id]);
    expect(await recusa(canais(revogado.token))).toBe(401);
  });
});
