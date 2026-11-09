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
import { EquipamentoService } from '../equipamento/equipamento.service';
import { CatalogoSyncController } from '../produto/catalogo-sync.controller';
import { CatalogoIntegracaoService } from './catalogo-integracao.service';
import { CredencialDoTotemGuard } from './credencial-totem.guard';
import { IntegracaoApiController } from './integracao-api.controller';
import { ESCOPOS_KEY, IntegracaoTokenGuard, type IntegracaoCtxData } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ORZUNI LÊ O CATÁLOGO COM O PREÇO DO iFOOD (mig 374), contra o Postgres real, pela guarda de verdade da porta
// (`IntegracaoTokenGuard`) e pelo serviço do catálogo.
//
// O banco do CI é montado como servidor de loja: as tabelas só da nuvem (295, 303, 323, 374) sobem num schema SÓ DESTE
// TESTE, na frente do `public`, sem chave estrangeira para empresa/unidade (LIC-088). O catálogo (produto, opção,
// adicionais) é o do `public`, com uma empresa só desta spec, apagada no fim.
//
// O que se prova:
//   • o console dá ao Orzuni só o catálogo e o preço do iFood, sempre por loja; ninguém mais recebe o preço do iFood;
//   • com `catalogo.ifood.ler`: o preço do produto e da opção REUTILIZÁVEL em centavos (até o maior valor da coluna),
//     o "está no iFood", e null onde não há preço (produto sem preço, opção só do produto);
//   • sem ela (o Farol): nem o NOME dos campos sai, e nenhum campo de dinheiro (ERR-166);
//   • a versão: o preço do iFood muda a do Orzuni e não a do Farol;
//   • só `catalogo.ifood.ler`, sem `catalogo.ler`: 403 no catálogo (o escopo não abre rota sozinho);
//   • o acesso do Orzuni NÃO abre o `/sync/catalogo` do totem nem as outras leituras da porta (vendas, clientes, fichas…).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-orzuni.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

const ESCOPOS_ORZUNI = ['catalogo.ler', 'catalogo.ifood.ler'];
const ESCOPOS_FAROL = ['catalogo.ler', 'fichas.ler', 'producao.ler'];
const NOME_DE_DINHEIRO = /pre[cç]o|custo|margem|cmv|valor|markup|delta|centavo|venda/i;
/** O corpo sem o que é sorteado a cada rodada (uuids e a hora ISO): a conferência de "nenhum valor de dinheiro" por
 *  dígitos não pode casar com eles — "…-6915-4550-…" num uuid já derrubou o CI do #875 (ERR-414, família do ERR-408). */
const semSorteio = (s: string) =>
  s.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, 'UUID').replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, 'DATA');

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

descrever('API de integração — Orzuni (catálogo com o preço do iFood)', () => {
  const SCHEMA = `teste_integracao_orzuni_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 4 });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const guardDaApi = new IntegracaoTokenGuard(tokensSvc, new Reflector());
  const guardDoTotem = new CredencialDoTotemGuard(new EquipamentoService(db, auditoria as any), db);
  const catalogoSvc = new CatalogoIntegracaoService(db);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  type Emp = { tenant: string; loja: string; presidente: string };
  let E: Emp;
  const id: Record<string, string> = {};

  async function ins(tabela: string, linha: Record<string, unknown>): Promise<string> {
    const colunas = Object.keys(linha);
    const [r] = await q(
      `insert into ${tabela} (${colunas.join(', ')}) values (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      colunas.map((c) => linha[c]),
    );
    return r.id as string;
  }

  const emitir = (cliente: string, escopos: string[], loja: string | null = E.loja) =>
    tokensSvc.emitir(
      { tenantId: E.tenant, ...(loja ? { unidadeId: loja } : {}), cliente, autorizadoPor: E.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    ) as Promise<{ id: string; token: string }>;

  function contexto(controller: any, metodo: string, token: string) {
    const req: any = { headers: { authorization: `Bearer ${token}` }, ip: '10.0.0.1', originalUrl: `/api/v1/${metodo}`, url: `/api/v1/${metodo}` };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => controller.prototype[metodo],
        getClass: () => controller,
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

  /** O catálogo como a rota devolve: a guarda de verdade monta o acesso, o serviço lê. */
  async function catalogo(token: string, versao?: string): Promise<any> {
    const { ctx, req } = contexto(IntegracaoApiController, 'catalogo', token);
    await guardDaApi.canActivate(ctx);
    return catalogoSvc.catalogo(req.integracao as IntegracaoCtxData, { versao });
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API de integração é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    const aplicar = (sqlDaMigration: string) => repetirNaCorridaDeCatalogo(() => pool.query(sqlDaMigration));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    await aplicar(mig('323_integracao_gogem.sql'));
    // A 374 como vai para a nuvem — a conferência dela, linha a linha — e de novo (idempotente).
    const r = (await aplicar(mig('374_integracao_orzuni_catalogo_ifood.sql'))) as unknown as any[];
    const conferencia = r[r.length - 1].rows;
    expect(conferencia).toHaveLength(4);
    if (conferencia.some((l: any) => !l.ok)) throw new Error(`conferência da 374: ${JSON.stringify(conferencia)}`);
    await aplicar(mig('374_integracao_orzuni_catalogo_ifood.sql'));

    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`Orzuni teste ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, 'Loja única', 'matriz') returning id`, [e.id]);
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente Orzuni', $2) returning id`, [e.id, f.id]);
    E = { tenant: e.id, loja: u.id, presidente: c.id };

    // O cadastro: preço do Regem e preço do iFood diferentes, de propósito.
    const t = E.tenant;
    id.cat = await ins('categoria_produto', { tenant_id: t, nome: 'Burgers', ordem: 1 });
    id.pXb = await ins('produto', {
      tenant_id: t, codigo: 'XB', nome: 'X-Burger', categoria_id: id.cat, tipo: 'simples', preco_venda: '32.90',
      preco_ifood: '45.50', no_ifood: true,
    });
    id.pRef = await ins('produto', { tenant_id: t, codigo: 'REF', nome: 'Refrigerante', categoria_id: id.cat, tipo: 'simples', preco_venda: '7.00' });
    // O maior valor que a coluna guarda (numeric(12,2)): os centavos passam do inteiro de 32 bits.
    id.pCaro = await ins('produto', {
      tenant_id: t, codigo: 'CARO', nome: 'Banquete', categoria_id: id.cat, tipo: 'simples', preco_venda: '1.00',
      preco_ifood: '9999999999.99', no_ifood: true,
    });
    id.opBacon = await ins('opcao', { tenant_id: t, nome: 'Bacon', codigo_pdv: 'AD-BAC', tipo: 'simples', preco_ifood: '4.00' });
    id.opOvo = await ins('opcao', { tenant_id: t, nome: 'Ovo', codigo_pdv: 'AD-OVO', tipo: 'simples' });
    id.etapa = await ins('complemento', { tenant_id: t, nome: 'Adicionais', min: 0, max: 3 });
    id.grupo = await ins('complemento_grupo', {
      tenant_id: t, produto_id: id.pXb, nome: 'Adicionais', tipo: 'adicionar', min: 0, max: 3, ordem: 0, origem_complemento_id: id.etapa,
    });
    const op = (ordem: number, linha: Record<string, unknown>) =>
      ins('complemento_opcao', { tenant_id: t, grupo_id: id.grupo, ordem, preco_delta: '3.50', ...linha });
    id.coBacon = await op(0, { nome: 'Bacon', codigo_pdv: 'AD-BAC', origem_opcao_id: id.opBacon });
    id.coOvo = await op(1, { nome: 'Ovo', codigo_pdv: 'AD-OVO', origem_opcao_id: id.opOvo });
    id.coSoDoProduto = await op(2, { nome: 'Cebola crispy', codigo_pdv: 'AD-CEB' });
  });

  afterAll(async () => {
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await pool.end();
  }, 60_000);

  it('o console dá ao Orzuni só o catálogo e o preço do iFood, sempre por loja; ninguém mais recebe o preço do iFood', async () => {
    const ok = await emitir('orzuni', ESCOPOS_ORZUNI);
    expect(ok.token).toMatch(/^rgm_it_/);
    const [t] = await q(`select cliente, escopos, unidade_id from integracao_token_loja where id = $1`, [ok.id]);
    expect(t).toEqual({ cliente: 'orzuni', escopos: ESCOPOS_ORZUNI, unidade_id: E.loja });
    await expect(emitir('orzuni', [...ESCOPOS_ORZUNI, 'pedidos.ler'])).rejects.toThrow(/não vale para o Orzuni: pedidos\.ler/);
    await expect(emitir('orzuni', ESCOPOS_ORZUNI, null)).rejects.toThrow(/unidadeId/);
    await expect(emitir('farol', [...ESCOPOS_FAROL, 'catalogo.ifood.ler'])).rejects.toThrow(/não vale para o Farol: catalogo\.ifood\.ler/);
    await expect(emitir('liame', ['pedidos.ler', 'catalogo.ifood.ler'])).rejects.toThrow(/não vale para o Liame: catalogo\.ifood\.ler/);
    await expect(emitir('gogem', ['totem.catalogo.ler', 'catalogo.ifood.ler'])).rejects.toThrow(/não vale para o GoGeM: catalogo\.ifood\.ler/);
  });

  it('com catalogo.ifood.ler: o preço do iFood em centavos (produto e opção reutilizável) e o "está no iFood"; null onde não há preço', async () => {
    const { token } = await emitir('orzuni', ESCOPOS_ORZUNI);
    const r = await catalogo(token);
    expect(r.atualizado).toBe(true);
    const produto = (codigo: string) => r.produtos.find((p: any) => p.codigo === codigo);
    expect(produto('XB')).toMatchObject({ preco_ifood_centavos: 4550, no_ifood: true });
    expect(produto('REF')).toMatchObject({ preco_ifood_centavos: null, no_ifood: false });
    expect(produto('CARO')).toMatchObject({ preco_ifood_centavos: 999999999999, no_ifood: true });
    const opcoes = produto('XB').adicionais[0].opcoes.map((o: any) => [o.codigo, o.opcao_id, o.preco_ifood_centavos]);
    expect(opcoes).toEqual([
      ['AD-BAC', id.opBacon, 400],
      ['AD-OVO', id.opOvo, null], // a opção reutilizável sem preço no iFood
      ['AD-CEB', null, null], // a opção criada só neste produto não tem preço do iFood
    ]);
    // O preço do Regem (e o acréscimo do adicional) continuam fora: só o do iFood entra.
    const nomes = [...nomesDosCampos(r)];
    expect(nomes.filter((n) => NOME_DE_DINHEIRO.test(n)).sort()).toEqual(['preco_ifood_centavos']);
    expect(semSorteio(JSON.stringify(r))).not.toMatch(/32\.9|3\.5|"7(\.0+)?"/);
  });

  it('sem catalogo.ifood.ler (o Farol): nem o nome dos campos do iFood sai, e nenhum campo de dinheiro', async () => {
    const { token } = await emitir('farol', ESCOPOS_FAROL);
    const r = await catalogo(token);
    expect(r.produtos.map((p: any) => p.codigo).sort()).toEqual(['CARO', 'REF', 'XB']);
    const nomes = [...nomesDosCampos(r)];
    expect(nomes).not.toContain('preco_ifood_centavos');
    expect(nomes).not.toContain('no_ifood');
    expect(nomes.filter((n) => NOME_DE_DINHEIRO.test(n))).toEqual([]);
    expect(semSorteio(JSON.stringify(r))).not.toMatch(/4550|45\.5|9999999999/);
  });

  it('a versão: mudar o preço do iFood muda a do Orzuni e não a do Farol', async () => {
    const orzuni = (await emitir('orzuni', ESCOPOS_ORZUNI)).token;
    const farol = (await emitir('farol', ESCOPOS_FAROL)).token;
    const vO = (await catalogo(orzuni)).versao;
    const vF = (await catalogo(farol)).versao;
    expect(vO).not.toBe(vF); // os campos do iFood fazem parte do retrato do Orzuni
    expect(await catalogo(orzuni, vO)).toEqual({ versao: vO, atualizado: false });

    await q(`update produto set preco_ifood = 47.00 where id = $1`, [id.pXb]);
    try {
      const depois = await catalogo(orzuni, vO);
      expect(depois.atualizado).toBe(true);
      expect(depois.versao).not.toBe(vO);
      expect(depois.produtos.find((p: any) => p.codigo === 'XB').preco_ifood_centavos).toBe(4700);
      expect(await catalogo(farol, vF)).toEqual({ versao: vF, atualizado: false });
      // O preço da opção também muda a versão do Orzuni.
      await q(`update opcao set preco_ifood = 4.50 where id = $1`, [id.opBacon]);
      expect((await catalogo(orzuni, depois.versao)).atualizado).toBe(true);
      expect(await catalogo(farol, vF)).toEqual({ versao: vF, atualizado: false });
    } finally {
      await q(`update produto set preco_ifood = 45.50 where id = $1`, [id.pXb]);
      await q(`update opcao set preco_ifood = 4.00 where id = $1`, [id.opBacon]);
    }
  });

  it('só catalogo.ifood.ler, sem catalogo.ler: o catálogo responde 403 (o escopo não abre rota sozinho)', async () => {
    const { token } = await emitir('orzuni', ['catalogo.ifood.ler']);
    expect(await recusa(guardDaApi.canActivate(contexto(IntegracaoApiController, 'catalogo', token).ctx))).toBe(403);
  });

  it('o acesso do Orzuni não abre o /sync/catalogo do totem nem as outras leituras da porta', async () => {
    const { token } = await emitir('orzuni', ESCOPOS_ORZUNI);
    expect(await recusa(guardDoTotem.canActivate(contexto(CatalogoSyncController, 'catalogo', token).ctx))).toBe(403);
    // TODAS as rotas com escopo da porta (lista fechada: rota nova com escopo entra sozinha aqui) — só o catálogo passa.
    const leituras = Object.getOwnPropertyNames(IntegracaoApiController.prototype).filter(
      (m) => m !== 'constructor' && (Reflect.getMetadata(ESCOPOS_KEY, (IntegracaoApiController.prototype as any)[m]) ?? []).length > 0,
    );
    expect(leituras.length).toBeGreaterThanOrEqual(10);
    const resultado = Object.fromEntries(
      await Promise.all(leituras.map(async (m) => [m, await recusa(guardDaApi.canActivate(contexto(IntegracaoApiController, m, token).ctx))])),
    );
    for (const [m, r] of Object.entries(resultado)) expect([m, r]).toEqual([m, m === 'catalogo' ? 'passou' : 403]);
  });
});
