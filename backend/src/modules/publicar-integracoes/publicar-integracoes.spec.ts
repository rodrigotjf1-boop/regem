import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { cifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { PublicarIntegracoesService } from './publicar-integracoes.service';
import { PublicarIntegracoesLojaController } from './publicar-integracoes.controller';
import {
  linhaDoGogemPublicado,
  linhaDoIfood,
  linhaDoLeitor,
  ordenarLinhas,
  podePublicar,
  resumoDoPublicar,
} from './publicar-integracoes.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "PUBLICAR NAS INTEGRAÇÕES" (Cadastros › Cardápio — pedido do dono de 06/11/2026): a situação de cada integração que
// usa o cardápio e o "Publicar" (GoGeM na hora; quem lê pela porta recebe o pedido de ler de novo; o iFood só mostra a
// fila, que já vai sozinha). Contra Postgres (TEST_PG_URL): a fila do iFood é a da 370 (no `public`, como a spec do
// Orzuni); as tabelas de token, aviso e mudança do cardápio (só nuvem, 295/304/316) são cópias MÍNIMAS num schema só
// deste teste, com as colunas conferidas na nuvem em 06/11/2026 — sem FK e sem gatilho em tabela compartilhada.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('publicar-integracoes.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const ENV = {
  ORZUNI_LIGADO: 'true',
  ORZUNI_MCP_URL: 'https://orzuni.exemplo.test/v1/mcp',
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
};

describe('regras do "Publicar nas integrações" (sem banco)', () => {
  it('iFood: em dia, a caminho e com problema — com o motivo de cada item', () => {
    expect(linhaDoIfood({ aCaminho: 0, comProblema: 0, problemas: [] })).toMatchObject({ tom: 'ok', modo: 'automatico' });
    expect(linhaDoIfood({ aCaminho: 0, comProblema: 0, problemas: [] }).frase).toMatch(/Tudo em dia/);
    const caminho = linhaDoIfood({ aCaminho: 2, comProblema: 0, problemas: [] });
    expect(caminho.tom).toBe('atencao');
    expect(caminho.frase).toMatch(/2 envios a caminho/);
    const prob = linhaDoIfood({
      aCaminho: 1,
      comProblema: 1,
      problemas: [{ nome: 'X-Burguer', situacao: 'feito', resultado: 'nao_encontrado', oQue: 'preco' }],
    });
    expect(prob.tom).toBe('problema');
    expect(prob.frase).toMatch(/1 envio a caminho\. 1 item com problema/);
    expect(prob.detalhes).toEqual(['X-Burguer (preço): o código PDV não existe no iFood desta loja']);
  });

  it('GoGeM: o resultado do publicar em palavras; a recusa vira a frase do serviço', () => {
    expect(linhaDoGogemPublicado({ ok: true, alterados: 3 }).frase).toBe('Publicado: 3 produtos atualizados no totem.');
    expect(linhaDoGogemPublicado({ ok: true, alterados: 0 }).frase).toBe('Publicado: o totem já estava em dia.');
    expect(linhaDoGogemPublicado({ ok: true }).frase).toMatch(/recebeu o pedido/);
    expect(linhaDoGogemPublicado({ erro: 'O GoGeM ainda não se identificou' })).toMatchObject({ tom: 'problema', frase: 'O GoGeM ainda não se identificou' });
  });

  it('quem lê pela porta: avisado sozinho, sem aviso, pausado; o botão só faz algo com GoGeM ou aviso', () => {
    const farol = { cliente: 'farol', comAviso: true, pausado: false, ultimoAviso: null };
    expect(linhaDoLeitor(farol)).toMatchObject({ rotulo: 'Farol', tom: 'ok' });
    expect(linhaDoLeitor(farol, true).frase).toMatch(/Pedido para ler de novo/);
    expect(linhaDoLeitor({ ...farol, comAviso: false }).frase).toMatch(/Lê o cardápio direto/);
    expect(linhaDoLeitor({ ...farol, comAviso: false, pausado: true }).tom).toBe('problema');
    expect(linhaDoLeitor({ ...farol, cliente: 'app_x' }).rotulo).toBe('Aplicativo parceiro');
    const ifood = linhaDoIfood({ aCaminho: 0, comProblema: 0, problemas: [] });
    expect(podePublicar([ifood], [])).toBe(false);
    expect(podePublicar([ifood], [{ ...farol, comAviso: false }])).toBe(false);
    expect(podePublicar([ifood], [farol])).toBe(true);
    expect(podePublicar([ifood, linhaDoGogemPublicado({ ok: true })], [])).toBe(true);
    expect(ordenarLinhas([linhaDoLeitor(farol), linhaDoGogemPublicado({ ok: true }), ifood]).map((l) => l.chave)).toEqual([
      'ifood',
      'gogem',
      'porta:farol',
    ]);
    expect(resumoDoPublicar([linhaDoGogemPublicado({ erro: 'x' })])).toBe('Publicado, menos em: GoGeM (totem).');
    expect(resumoDoPublicar([linhaDoGogemPublicado({ ok: true })])).toBe('Publicado nas integrações.');
  });
});

descrever('"Publicar nas integrações" (Postgres real)', () => {
  const SCHEMA = `teste_publicar_${process.pid}_${Date.now()}`;
  const publico = new Pool({ connectionString: URL_PG, max: 2 });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 6 });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  let gogemChamadas: Array<[string, string | null]> = [];
  let gogemResposta: () => Promise<any> = async () => ({ ok: true, alterados: 3 });
  const gogem = {
    publicar: async (t: string, u: string | null) => {
      gogemChamadas.push([t, u]);
      return gogemResposta();
    },
  } as any;
  const svc = new PublicarIntegracoesService(db, gogem, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const envAntes: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of [...Object.keys(ENV), 'SEGREDOS_CHAVE', 'EDGE_MODE', 'CLOUD_API', 'SYNC_TOKEN']) envAntes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.EDGE_MODE;
    if (!process.env.SEGREDOS_CHAVE) process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    // A fila do iFood (370/371/399/400/403), no `public`, pela conexão sem schema próprio — como a spec do Orzuni (ERR-377).
    for (const n of ['370_orzuni_envio.sql', '371_orzuni_ocultar_pausa.sql', '399_onde_vende_sem_ocultar_no_ifood.sql', '400_orzuni_nome_descricao_codigo.sql', '403_opcao_pausa_por_canal.sql']) {
      const texto = readFileSync(join(MIGS, n), 'utf8');
      await repetirNaCorridaDeCatalogo(() => publico.query(comTravaDaEmpresa(texto)));
    }
    // As só-nuvem da porta: cópias mínimas (colunas como na nuvem), sem FK para empresa/unidade.
    await publico.query(`create schema ${SCHEMA}`);
    await publico.query(`
      create table ${SCHEMA}.integracao_token_loja (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid, cliente text not null,
        prefixo text not null default 'rgm_it_teste', escopos text[] not null, expira_em timestamptz, revogado_em timestamptz);
      create table ${SCHEMA}.integracao_webhook (
        token_id uuid primary key, tenant_id uuid not null, unidade_id uuid, cliente text not null,
        url text not null default 'https://farol.exemplo.test/avisos', segredo_cifrado text not null default 'v1:x',
        registrado_em timestamptz not null default now(), ultimo_envio_em timestamptz, ultimo_status_http integer,
        entregues bigint not null default 0, pausado_em timestamptz, motivo_pausa text);
      create table ${SCHEMA}.integracao_retrato_mudanca (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, unidade_id uuid, recurso text not null,
        criado_em timestamptz not null default clock_timestamp(),
        constraint ck_integracao_retrato_mudanca_recurso check (recurso in ('catalogo', 'fichas')));`);
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      for (const t of ['orzuni_envio', 'orzuni_ligacao', 'opcao', 'produto', 'entitlement', 'equipamento', 'unidade'])
        await publico.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await publico.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await publico.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await pool.end();
    await publico.end();
  }, 120_000);

  beforeEach(() => {
    auditados.length = 0;
    gogemChamadas = [];
    gogemResposta = async () => ({ ok: true, alterados: 3 });
  });

  async function empresa(lojas = 2) {
    const t = (await q(`insert into empresa (nome) values ('teste publicar integracoes') returning id`))[0].id as string;
    empresas.push(t);
    const us: string[] = [];
    for (let i = 0; i < lojas; i++) us.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    return { t, us };
  }
  const direito = (t: string) =>
    q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || 'ifood_pelo_orzuni')::uuid, $2, 'ifood_pelo_orzuni', true)`, [t, t]);
  const ligar = (t: string, u: string) =>
    q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo) values ($1, $2, $3, 'dms_lg_orzuni_teste')`, [
      t,
      u,
      cifrar(`dms_lg_orzuni_${randomBytes(12).toString('base64url')}`),
    ]);
  const envio = (t: string, u: string, tipo: string, ref: string, situacao: string, resultado: string | null = null) =>
    q(`insert into orzuni_envio (tenant_id, unidade_id, tipo, ref_id, situacao, resultado, enviado_em) values ($1,$2,$3,$4,$5,$6, now())`, [
      t,
      u,
      tipo,
      ref,
      situacao,
      resultado,
    ]);
  const produto = async (t: string, nome: string) =>
    (await q(`insert into produto (tenant_id, nome, preco_venda) values ($1, $2, 10) returning id`, [t, nome]))[0].id as string;
  const token = async (t: string, u: string | null, cliente: string, escopos: string[], extra: Record<string, any> = {}) => {
    const id = (await q(`insert into integracao_token_loja (tenant_id, unidade_id, cliente, escopos) values ($1,$2,$3,$4) returning id`, [t, u, cliente, escopos]))[0]
      .id as string;
    if (extra.revogado) await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [id]);
    return id;
  };
  const aviso = (tokenId: string, t: string, u: string | null, cliente: string, extra: { pausado?: boolean; ultimo?: boolean } = {}) =>
    q(`insert into integracao_webhook (token_id, tenant_id, unidade_id, cliente, pausado_em, ultimo_envio_em) values ($1,$2,$3,$4,$5,$6)`, [
      tokenId,
      t,
      u,
      cliente,
      extra.pausado ? new Date() : null,
      extra.ultimo ? new Date() : null,
    ]);
  const gogemMarcado = (t: string, u: string | null) =>
    q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, integrador_visto_em)
       values ($1,$2,'GoGeM','servidor_local',$3,true,'gogem', now())`, [t, u, randomBytes(24).toString('hex')]);

  it('empresa sem integração do cardápio: nenhuma linha, nada a publicar (o botão não aparece)', async () => {
    const { t, us } = await empresa();
    // O Liame lê pedidos e cupons — não o cardápio: não conta.
    const liame = await token(t, us[0], 'liame', ['pedidos.ler', 'cupons.ler']);
    await aviso(liame, t, us[0], 'liame');
    const s = await svc.situacao(t, us[0]);
    expect(s).toEqual({ linhas: [], podePublicar: false, semConexao: false });
  });

  it('iFood: conta a caminho e com problema DA LOJA, com nome e motivo; sem loja, a empresa toda', async () => {
    const { t, us } = await empresa();
    const [p1, p2, p3, p4] = [await produto(t, 'X-Burguer'), await produto(t, 'X-Salada'), await produto(t, 'Batata'), await produto(t, 'Suco')];
    const o1 = (await q(`insert into opcao (tenant_id, nome, codigo_pdv) values ($1, 'Bacon', '501') returning id`, [t]))[0].id as string;
    await direito(t);
    await ligar(t, us[0]);
    await ligar(t, us[1]);
    await envio(t, us[0], 'preco_item', p1, 'pendente');
    await envio(t, us[0], 'preco_item', p2, 'feito', 'nao_encontrado');
    await envio(t, us[0], 'status_opcao', o1, 'desistiu');
    await envio(t, us[0], 'status_item', p3, 'feito', 'aplicado');
    await envio(t, us[1], 'preco_item', p4, 'feito', 'recusado');

    const loja1 = await svc.situacao(t, us[0]);
    expect(loja1.linhas.map((l) => l.chave)).toEqual(['ifood']);
    expect(loja1.podePublicar).toBe(false); // o iFood já vai sozinho
    expect(loja1.linhas[0].tom).toBe('problema');
    expect(loja1.linhas[0].frase).toMatch(/1 envio a caminho\. 2 itens com problema/);
    expect([...(loja1.linhas[0].detalhes ?? [])].sort()).toEqual([
      'Bacon (pausa): não enviado (o iFood não respondeu por 24 h)',
      'X-Salada (preço): o código PDV não existe no iFood desta loja',
    ]);
    const todas = await svc.situacao(t, null);
    expect(todas.linhas[0].frase).toMatch(/1 envio a caminho\. 3 itens com problema/);
    const loja2 = await svc.situacao(t, us[1]);
    expect(loja2.linhas[0].detalhes).toEqual(['Suco (preço): recusado pelo iFood']);
  });

  it('iFood: sem o envio ligado, sem o direito ou sem ligação viva da loja, a linha não aparece', async () => {
    const { t, us } = await empresa();
    await ligar(t, us[0]);
    expect((await svc.situacao(t, us[0])).linhas).toEqual([]); // sem direito
    await direito(t);
    expect((await svc.situacao(t, us[0])).linhas.map((l) => l.chave)).toEqual(['ifood']);
    expect((await svc.situacao(t, us[1])).linhas).toEqual([]); // a outra loja não tem ligação
    await q(`update orzuni_ligacao set revogada_em = now() where tenant_id = $1`, [t]);
    expect((await svc.situacao(t, us[0])).linhas).toEqual([]);
    await q(`update orzuni_ligacao set revogada_em = null where tenant_id = $1`, [t]);
    delete process.env.ORZUNI_LIGADO;
    try {
      expect((await svc.situacao(t, us[0])).linhas).toEqual([]);
    } finally {
      process.env.ORZUNI_LIGADO = 'true';
    }
  });

  it('GoGeM marcado: aparece, e o Publicar chama o GoGeM com a loja em uso; a recusa vira a frase', async () => {
    const { t, us } = await empresa();
    await gogemMarcado(t, null);
    const s = await svc.situacao(t, us[0]);
    expect(s.linhas.map((l) => l.chave)).toEqual(['gogem']);
    expect(s.podePublicar).toBe(true);
    expect(gogemChamadas).toEqual([]); // ler não publica

    const r = await svc.publicar(t, us[0]);
    expect(gogemChamadas).toEqual([[t, us[0]]]);
    expect(r.linhas[0]).toMatchObject({ chave: 'gogem', tom: 'ok', frase: 'Publicado: 3 produtos atualizados no totem.' });
    expect(r.resumo).toBe('Publicado nas integrações.');

    gogemResposta = async () => {
      throw new BadRequestException('Não foi possível conectar ao GoGeM (ENOTFOUND api.gogem.com.br).');
    };
    const falha = await svc.publicar(t, us[0]);
    expect(falha.linhas[0]).toMatchObject({ tom: 'problema', frase: 'Não foi possível conectar ao GoGeM (ENOTFOUND api.gogem.com.br).' });
    expect(falha.resumo).toBe('Publicado, menos em: GoGeM (totem).');
  });

  it('Farol (lê cardápio e fichas): avisado sozinho; o Publicar anota catálogo e fichas na fila da 316, da loja em uso', async () => {
    const { t, us } = await empresa();
    const tk = await token(t, us[0], 'farol', ['catalogo.ler', 'fichas.ler', 'producao.ler']);
    await aviso(tk, t, us[0], 'farol', { ultimo: true });
    const s = await svc.situacao(t, us[0]);
    expect(s.linhas.map((l) => [l.chave, l.tom])).toEqual([['porta:farol', 'ok']]);
    expect(s.linhas[0].frase).toMatch(/Avisado sozinho .* Último aviso: /);
    expect(s.podePublicar).toBe(true);
    // A outra loja não tem o Farol.
    expect((await svc.situacao(t, us[1])).linhas).toEqual([]);

    const r = await svc.publicar(t, us[0]);
    expect(r.linhas[0].frase).toMatch(/Pedido para ler de novo enviado/);
    const fila = await q(`select unidade_id, recurso from integracao_retrato_mudanca where tenant_id = $1 order by recurso`, [t]);
    expect(fila).toEqual([
      { unidade_id: us[0], recurso: 'catalogo' },
      { unidade_id: us[0], recurso: 'fichas' },
    ]);
  });

  it('a régua da porta: token revogado não conta; aviso pausado vira problema; sem aviso, nada se anota', async () => {
    const { t, us } = await empresa();
    const revogado = await token(t, us[0], 'farol', ['catalogo.ler'], { revogado: true });
    await aviso(revogado, t, us[0], 'farol');
    expect((await svc.situacao(t, us[0])).linhas).toEqual([]);

    const pausado = await token(t, us[0], 'parceiro_x', ['fichas.ler']);
    await aviso(pausado, t, us[0], 'parceiro_x', { pausado: true });
    const s = await svc.situacao(t, us[0]);
    expect(s.linhas).toEqual([expect.objectContaining({ chave: 'porta:parceiro_x', rotulo: 'Aplicativo parceiro', tom: 'problema' })]);
    expect(s.podePublicar).toBe(false);
    await svc.publicar(t, us[0]);
    expect(await q(`select 1 from integracao_retrato_mudanca where tenant_id = $1`, [t])).toEqual([]);
  });

  it('uma fonte que falha vira "não deu para ler" e as outras seguem (V37)', async () => {
    const { t, us } = await empresa();
    await gogemMarcado(t, null);
    const espiao = jest.spyOn(svc, 'leitoresDaPorta').mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '57014' }));
    try {
      const s = await svc.situacao(t, us[0]);
      expect(s.linhas.map((l) => [l.chave, l.tom])).toEqual([
        ['gogem', 'neutro'],
        ['porta-erro', 'problema'],
      ]);
    } finally {
      espiao.mockRestore();
    }
  });

  it('publicar pela tela audita quem publicou e o resultado de cada integração', async () => {
    const { t, us } = await empresa();
    await gogemMarcado(t, null);
    const ator = { id: randomUUID(), perfil: 'gerente' };
    await svc.publicarDaTela(t, us[0], ator);
    expect(auditados).toEqual([
      expect.objectContaining({
        tenantId: t,
        unidadeId: us[0],
        atorId: ator.id,
        atorPerfil: 'gerente',
        acao: 'publicou_nas_integracoes',
        detalhe: { resultados: [{ integracao: 'gogem', tom: 'ok' }] },
      }),
    ]);
  });

  it('servidor da loja: pede à nuvem; resposta de outra empresa, erro ou rede fora = sem conexão (e o Publicar recusa)', async () => {
    const { t } = await empresa(1);
    process.env.CLOUD_API = 'https://nuvem.exemplo.test/api/v1';
    process.env.SYNC_TOKEN = 'token-de-sync-teste';
    const json = (corpo: any, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
    const pedidos: Array<{ url: string; init: any }> = [];
    const ok = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      return json({ tenantId: t, linhas: [{ chave: 'gogem' }], podePublicar: true, semConexao: false });
    }) as any;
    const u = randomUUID();
    const r = await svc.pelaNuvem(t, u, 'GET', ok);
    expect(r).toEqual({ linhas: [{ chave: 'gogem' }], podePublicar: true, semConexao: false });
    expect(pedidos[0].url).toBe(`https://nuvem.exemplo.test/api/v1/integracoes/loja/publicar?unidade=${u}`);
    expect(pedidos[0].init.headers['x-sync-token']).toBe('token-de-sync-teste');
    await svc.pelaNuvem(t, null, 'POST', ok);
    expect(pedidos[1]).toMatchObject({ url: 'https://nuvem.exemplo.test/api/v1/integracoes/loja/publicar', init: { method: 'POST', body: '{}' } });

    const outra = (async () => json({ tenantId: randomUUID(), linhas: [] })) as any;
    expect((await svc.pelaNuvem(t, null, 'GET', outra)).semConexao).toBe(true);
    const erro = (async () => json({}, 500)) as any;
    expect((await svc.pelaNuvem(t, null, 'GET', erro)).semConexao).toBe(true);
    const caiu = (async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }) as any;
    expect((await svc.pelaNuvem(t, null, 'GET', caiu)).semConexao).toBe(true);

    process.env.EDGE_MODE = 'true';
    const espiao = jest.spyOn(svc, 'pelaNuvem').mockResolvedValueOnce({ linhas: [], podePublicar: false, semConexao: true, resumo: '' } as any);
    try {
      await expect(svc.publicarDaTela(t, null, { id: null, perfil: 'gerente' })).rejects.toBeInstanceOf(ServiceUnavailableException);
      expect(auditados).toEqual([]); // nada publicado, nada auditado
    } finally {
      espiao.mockRestore();
      delete process.env.EDGE_MODE;
    }
  });

  it('rota da nuvem para a loja: a loja pedida precisa ser da empresa do token', async () => {
    const a = await empresa(1);
    const b = await empresa(1);
    const ctl = new PublicarIntegracoesLojaController(svc);
    const ctx = { tenantId: a.t, unidadeId: null, equipamentoId: randomUUID(), token: 'x' };
    await expect(ctl.situacao(ctx, b.us[0])).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.situacao(ctx, 'nao-e-uuid')).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctl.situacao(ctx, a.us[0])).resolves.toMatchObject({ tenantId: a.t, linhas: [] });
    await q(`update unidade set deleted_at = now() where id = $1`, [a.us[0]]);
    await expect(ctl.publicar(ctx, a.us[0])).rejects.toBeInstanceOf(BadRequestException);
  });
});
