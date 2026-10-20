import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Reflector } from '@nestjs/core';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { IntegracaoApiController } from '../integracao-api/integracao-api.controller';
import { IntegracaoTokenGuard } from '../integracao-api/integracao-token.guard';
import { IntegracaoTokenService } from '../integracao-api/integracao-token.service';
import { WebhookIntegracaoService } from '../integracao-api/webhook-integracao.service';
import { GogemAvisoService } from './gogem-aviso.service';
import { GogemPublishService } from './gogem-publish.service';
import { registroDoGogem } from './credencial-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FASE 2 DA CREDENCIAL PRÓPRIA DO GOGEM — o cancelamento e o "Publicar" ASSINADOS (Standard
// Webhooks), contra o Postgres real e um RECEPTOR local que faz o papel da nuvem do GoGeM e confere
// a assinatura como o contrato manda (`docs/integracao-gogem/AVISOS-ASSINADOS.md` §3), com uma
// implementação à parte da do Regem.
//
// O que se prova: sem registro, NADA muda (mesmo endereço, mesmo `X-Sync-Token`, mesmo corpo); com o
// registro que o próprio GoGeM faz pelo token da loja, sai assinado no endereço dele, com o
// `webhook-id` fixo entre tentativas e o `X-Sync-Token` junto (até a fase 4); 404 no endereço
// registrado espera 6 h em vez de virar estorno manual; token revogado volta ao caminho de antes; o
// registro de uma loja não serve a outra; e registrar solta a fila que esperava pelo GoGeM.
//
// Como as specs da integração: o banco do CI é de LOJA, e as migrations só da nuvem (295, 296, 303,
// 304 e 323) sobem num schema só deste teste, na frente do `public`, sem FK para tabela
// compartilhada (LIC-088/ERR-109). As tabelas que a 296 enche de gatilho são cópias no schema.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aviso-assinado.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES_DA_296 = ['pedido_externo', 'comanda', 'comanda_item', 'cliente'];
const ESCOPOS_TOTEM = ['totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar'];
const ESTORNO_FEITO = { status: 'cancelado', pedidoId: 'p-1', estorno: { feito: true, meio: 'pix', valorCentavos: 1990, refundId: 'r-1', mensagem: 'ok' } };

type Recebido = { caminho: string; cabecalhos: IncomingHttpHeaders; corpo: string };
type Resposta = { status: number; corpo?: unknown };

describe('no servidor da loja o registro nem é consultado (a tabela é só da nuvem — V1)', () => {
  it('devolve null sem tocar no banco', async () => {
    const antes = process.env.EDGE_MODE;
    process.env.EDGE_MODE = 'true';
    try {
      const db = { execute: () => Promise.reject(new Error('não podia consultar')) };
      await expect(registroDoGogem(db, randomUUID(), randomUUID())).resolves.toBeNull();
    } finally {
      if (antes === undefined) delete process.env.EDGE_MODE;
      else process.env.EDGE_MODE = antes;
    }
  });
});

descrever('avisos assinados ao GoGeM — fase 2 (Postgres real + receptor)', () => {
  const SCHEMA = `teste_aviso_assinado_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 6 });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const auditoria = { registrar: async (a: any) => void auditorias.push(a) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const guardDaApi = new IntegracaoTokenGuard(tokensSvc, new Reflector());
  const webhooks = new WebhookIntegracaoService(db, auditoria);
  const avisos = new GogemAvisoService(db, auditoria);
  const publicar = new GogemPublishService(db);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const ENVS = ['EDGE_MODE', 'SEGREDOS_CHAVE', 'GOGEM_CLOUD_URL', 'GOGEM_PUBLISH_URL', 'INTEGRACAO_GOGEM_WEBHOOK_URLS'];
  const original: Record<string, string | undefined> = Object.fromEntries(ENVS.map((k) => [k, process.env[k]]));

  // ───────────────────────────── o receptor (faz o papel da nuvem do GoGeM) ─────────────────────────────

  const recebidos: Recebido[] = [];
  let responder: (r: Recebido) => Resposta = (r) => ({ status: 200, corpo: r.caminho.endsWith('/publicar') ? { alterados: 3 } : ESTORNO_FEITO });
  let receptor: Server;
  let raiz = '';
  let baseAvisos = '';

  function subirReceptor(): Promise<void> {
    receptor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d) => partes.push(d));
      req.on('end', () => {
        const r: Recebido = { caminho: req.url ?? '', cabecalhos: req.headers, corpo: Buffer.concat(partes).toString('utf8') };
        recebidos.push(r);
        let resp: Resposta = { status: 200, corpo: { alterados: 3 } };
        try {
          // O "Publicar" responde `{ alterados }` nos dois caminhos: o de hoje (`/publicar`) e o assinado.
          const ehPublicar = r.caminho.endsWith('/sync/regem/publicar') || r.corpo.includes('"catalogo.publicar"');
          resp = ehPublicar ? { status: 200, corpo: { alterados: 3 } } : responder(r);
        } catch {
          resp = { status: 500 };
        }
        res.writeHead(resp.status, { 'content-type': 'application/json' });
        res.end(resp.corpo === undefined ? '' : JSON.stringify(resp.corpo));
      });
    });
    return new Promise((ok) =>
      receptor.listen(0, '127.0.0.1', () => {
        raiz = `http://127.0.0.1:${(receptor.address() as any).port}/api/v1`;
        baseAvisos = `${raiz}/sync/regem/avisos/`;
        ok();
      }),
    );
  }

  /** A assinatura conferida como o GoGeM confere (§3 do contrato), à parte da do Regem. */
  function assinaturaConfere(r: Recebido, segredo: string): boolean {
    const id = String(r.cabecalhos['webhook-id'] ?? '');
    const ts = String(r.cabecalhos['webhook-timestamp'] ?? '');
    const chave = Buffer.from(segredo.slice('whsec_'.length), 'base64');
    const esperado = `v1,${createHmac('sha256', chave).update(`${id}.${ts}.${r.corpo}`).digest('base64')}`;
    const agora = Math.floor(Date.now() / 1000);
    const assinaturas = String(r.cabecalhos['webhook-signature'] ?? '').split(' ');
    return !!id && Math.abs(agora - Number(ts)) < 300 && assinaturas.includes(esperado);
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // o aviso ao GoGeM e o registro são da NUVEM
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    await subirReceptor();
    process.env.GOGEM_CLOUD_URL = raiz;
    process.env.GOGEM_PUBLISH_URL = `${raiz}/sync/regem/publicar`;
    process.env.INTEGRACAO_GOGEM_WEBHOOK_URLS = baseAvisos;

    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES_DA_296) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    const aplicar = (s: string) => repetirNaCorridaDeCatalogo(() => pool.query(s));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(mig('296_integracao_versao_vendas.sql'));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    await aplicar(mig('304_integracao_webhook.sql'));
    await aplicar(mig('323_integracao_gogem.sql'));
    const onde = await q(
      `select c.relname, s.nspname from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where c.oid in (to_regclass('integracao_webhook'), to_regclass('integracao_token_loja'))`,
    );
    if (onde.length !== 2 || onde.some((x) => x.nspname !== SCHEMA)) {
      throw new Error(`as tabelas do teste não estão na frente do public: ${JSON.stringify(onde)}`);
    }
  });

  afterAll(async () => {
    for (const k of ENVS) {
      if (original[k] === undefined) delete process.env[k];
      else process.env[k] = original[k];
    }
    for (const id of empresas) {
      for (const t of ['aviso_integracao', 'equipamento', 'colaborador', 'funcao', 'unidade']) {
        await q(`delete from public.${t} where tenant_id = $1`, [id]).catch(() => {});
      }
      await q(`delete from public.empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await pool.end();
    await new Promise((ok) => receptor?.close(ok));
  });

  beforeEach(() => {
    recebidos.length = 0;
    auditorias.length = 0;
    responder = () => ({ status: 200, corpo: ESTORNO_FEITO });
  });

  // ───────────────────────────── montagem ─────────────────────────────

  async function empresa(lojas = ['Loja A', 'Loja B']) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`Aviso assinado ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, $2, $3) returning id`, [e.id, l, i === 0 ? 'matriz' : 'filial']);
      ids.push(u.id);
    }
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente Aviso', $2) returning id`, [e.id, f.id]);
    return { tenant: e.id as string, lojas: ids, presidente: c.id as string };
  }
  type Emp = Awaited<ReturnType<typeof empresa>>;

  /** O token antigo: o `servidor_local` que o GoGeM marcou (mig 290). */
  async function credencialAntiga(e: Emp) {
    const token = randomBytes(24).toString('hex');
    await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, integrador_visto_em)
       values ($1, null, 'Integração GoGeM', 'servidor_local', $2, true, 'gogem', now())`,
      [e.tenant, token],
    );
    return token;
  }

  /**
   * O GoGeM liga os avisos da loja como o contrato manda (§2): com o token `rgm_it_` da loja, passando
   * pelo guard de verdade da API de integração, `PUT /integracao/webhook` com o endereço e o segredo dele.
   */
  async function ligarAvisos(e: Emp, loja: string, conexao = `integ_${randomUUID().slice(0, 8)}`) {
    const t = (await tokensSvc.emitir(
      { tenantId: e.tenant, unidadeId: loja, cliente: 'gogem', autorizadoPor: e.presidente, escopos: ESCOPOS_TOTEM, evidencia: 'teste' },
      dist,
    )) as { id: string; token: string };
    const req: any = { headers: { authorization: `Bearer ${t.token}` }, ip: '10.0.0.1' };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => IntegracaoApiController.prototype.registrarWebhook,
      getClass: () => IntegracaoApiController,
    };
    await expect(guardDaApi.canActivate(ctx)).resolves.toBe(true); // o token do GoGeM alcança a rota de registro
    const segredo = `whsec_${randomBytes(32).toString('base64')}`;
    const url = `${baseAvisos}${conexao}`;
    const estado = await webhooks.registrar(req.integracao, { url, segredo });
    expect(estado.url).toBe(url);
    return { tokenId: t.id, segredo, caminho: new URL(url).pathname };
  }

  /** Um cancelamento de venda do totem já gravado na fila (como `gravarAvisoCancelamentoTotem` grava). */
  async function aviso(e: Emp, loja: string | null) {
    const chave = `totem-${randomUUID().slice(0, 8)}`;
    const corpo = { idempotencyKey: chave, regemComandaId: randomUUID(), motivo: 'Cliente desistiu' };
    const [a] = await q(
      `insert into aviso_integracao (tenant_id, unidade_id, destino, tipo, chave, corpo, referencia_tipo, referencia_id)
       values ($1, $2, 'gogem', 'pedido_cancelado', $3, $4::jsonb, 'comanda', $5) returning id`,
      [e.tenant, loja, chave, JSON.stringify(corpo), corpo.regemComandaId],
    );
    return { id: a.id as string, corpo };
  }
  const linhaDoAviso = async (id: string) => (await q(`select * from aviso_integracao where id = $1`, [id]))[0];
  const naVez = (id: string) => q(`update aviso_integracao set proxima_tentativa_em = now() - interval '1 second' where id = $1`, [id]);

  // ───────────────────────────── os casos ─────────────────────────────

  it('sem registro: exatamente o caminho de hoje (endereço, X-Sync-Token, corpo, sem assinatura)', async () => {
    const e = await empresa();
    const token = await credencialAntiga(e);
    const a = await aviso(e, e.lojas[0]);
    const op = await avisos.enviarAgora(a.id);
    expect(op.situacao).toBe('solicitado');
    expect(recebidos).toHaveLength(1);
    const [r] = recebidos;
    expect(r.caminho).toBe('/api/v1/sync/regem/pedido-cancelado');
    expect(r.cabecalhos['x-sync-token']).toBe(token);
    expect(r.cabecalhos['webhook-signature']).toBeUndefined();
    expect(JSON.parse(r.corpo)).toEqual(a.corpo);
    expect((await linhaDoAviso(a.id)).status).toBe('entregue');
  });

  it('com registro: assinado no endereço do GoGeM, X-Sync-Token junto, corpo do contrato', async () => {
    const e = await empresa();
    const token = await credencialAntiga(e);
    const lig = await ligarAvisos(e, e.lojas[0]);
    const a = await aviso(e, e.lojas[0]);
    const op = await avisos.enviarAgora(a.id);
    expect(op.situacao).toBe('solicitado');
    expect(recebidos).toHaveLength(1);
    const [r] = recebidos;
    expect(r.caminho).toBe(lig.caminho);
    expect(assinaturaConfere(r, lig.segredo)).toBe(true);
    expect(r.cabecalhos['webhook-id']).toBe(`aviso_${a.id}`);
    expect(r.cabecalhos['x-sync-token']).toBe(token); // até a fase 4
    expect(r.cabecalhos['content-type']).toBe('application/json');
    const corpo = JSON.parse(r.corpo);
    expect(corpo).toEqual({
      tipo: 'pedido.cancelado',
      contrato: 1,
      loja_id: e.lojas[0],
      cancelado_em: new Date((await linhaDoAviso(a.id)).created_at).toISOString(),
      pedido: a.corpo,
    });
    expect((await linhaDoAviso(a.id)).status).toBe('entregue');
    const aud = auditorias.find((x) => x.acao === 'aviso_gogem_entregue');
    expect(aud?.detalhe).toMatchObject({ assinado: true, http: 200 });
    // O GET do GoGeM mostra o último envio.
    const [w] = await q(`select ultimo_status_http, entregues::int as entregues, ultimo_envio_em is not null as enviou from integracao_webhook where token_id = $1`, [lig.tokenId]);
    expect(w).toEqual({ ultimo_status_http: 200, entregues: 1, enviou: true });
  });

  it('estorno que falhou no Mercado Pago: sai de novo com o MESMO webhook-id, assinatura nova e válida', async () => {
    const e = await empresa();
    await credencialAntiga(e);
    const lig = await ligarAvisos(e, e.lojas[0]);
    const a = await aviso(e, e.lojas[0]);
    responder = () => ({ status: 200, corpo: { status: 'cancelado', estorno: { feito: false, meio: 'credito', valorCentavos: 1990, mensagem: 'MP fora' } } });
    expect((await avisos.enviarAgora(a.id)).situacao).toBe('pendente');
    expect((await linhaDoAviso(a.id)).status).toBe('pendente');
    responder = () => ({ status: 200, corpo: ESTORNO_FEITO });
    await naVez(a.id);
    await avisos.rodarFila(20, [e.tenant]);
    expect(recebidos).toHaveLength(2);
    expect(recebidos.map((r) => r.cabecalhos['webhook-id'])).toEqual([`aviso_${a.id}`, `aviso_${a.id}`]);
    for (const r of recebidos) expect(assinaturaConfere(r, lig.segredo)).toBe(true);
    expect((await linhaDoAviso(a.id)).status).toBe('entregue');
  });

  it('404 no endereço registrado: espera 6 h com a integração — nunca vira estorno manual', async () => {
    const e = await empresa();
    await credencialAntiga(e);
    await ligarAvisos(e, e.lojas[0]);
    const a = await aviso(e, e.lojas[0]);
    responder = () => ({ status: 404, corpo: { message: 'Cannot POST' } });
    const op = await avisos.enviarAgora(a.id);
    expect(op.situacao).toBe('integracao_recusou');
    expect(op.mensagem).toContain('endereço de aviso que o GoGeM registrou');
    const [l] = await q(
      `select status, ultimo_status_http, extract(epoch from (proxima_tentativa_em - now()))::int as em_seg from aviso_integracao where id = $1`,
      [a.id],
    );
    expect([l.status, l.ultimo_status_http]).toEqual(['aguardando_integracao', 404]);
    expect(l.em_seg).toBeGreaterThan(5 * 3600);
    // Quem perguntar de novo (outro processo já com o aviso) lê a mesma situação.
    const de_novo = await avisos.enviarAgora(a.id);
    expect(de_novo.mensagem).toContain('endereço de aviso que o GoGeM registrou');
    expect(recebidos).toHaveLength(1);
  });

  it('com registro e sem o token antigo: sai assinado, sem X-Sync-Token (já é o jeito da fase 4)', async () => {
    const e = await empresa();
    const lig = await ligarAvisos(e, e.lojas[0]);
    const a = await aviso(e, e.lojas[0]);
    expect((await avisos.enviarAgora(a.id)).situacao).toBe('solicitado');
    expect(recebidos).toHaveLength(1);
    expect(assinaturaConfere(recebidos[0], lig.segredo)).toBe(true);
    expect(recebidos[0].cabecalhos['x-sync-token']).toBeUndefined();
  });

  it('o registro solta na hora o cancelamento que esperava pelo GoGeM', async () => {
    const e = await empresa();
    const a = await aviso(e, e.lojas[0]);
    // Sem credencial nenhuma: o aviso espera (6 h) — como hoje.
    expect((await avisos.enviarAgora(a.id)).situacao).toBe('pendente');
    expect((await linhaDoAviso(a.id)).status).toBe('aguardando_integracao');
    expect(recebidos).toHaveLength(0);
    const lig = await ligarAvisos(e, e.lojas[0]);
    const [l] = await q(`select status, proxima_tentativa_em <= now() as na_vez from aviso_integracao where id = $1`, [a.id]);
    expect(l).toEqual({ status: 'pendente', na_vez: true });
    await avisos.rodarFila(20, [e.tenant]);
    expect(recebidos).toHaveLength(1);
    expect(assinaturaConfere(recebidos[0], lig.segredo)).toBe(true);
    expect((await linhaDoAviso(a.id)).status).toBe('entregue');
  });

  it('token do GoGeM revogado: o registro deixa de valer e o aviso volta ao caminho de antes', async () => {
    const e = await empresa();
    const token = await credencialAntiga(e);
    const lig = await ligarAvisos(e, e.lojas[0]);
    await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [lig.tokenId]);
    const a = await aviso(e, e.lojas[0]);
    await avisos.enviarAgora(a.id);
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].caminho).toBe('/api/v1/sync/regem/pedido-cancelado');
    expect(recebidos[0].cabecalhos['x-sync-token']).toBe(token);
    expect(recebidos[0].cabecalhos['webhook-signature']).toBeUndefined();
  });

  it('o registro de uma loja não serve a outra; aviso sem loja com dois registros não chuta', async () => {
    const e = await empresa();
    await credencialAntiga(e);
    const ligB = await ligarAvisos(e, e.lojas[1]);
    const daA = await aviso(e, e.lojas[0]);
    await avisos.enviarAgora(daA.id);
    expect(recebidos.map((r) => r.caminho)).toEqual(['/api/v1/sync/regem/pedido-cancelado']); // a loja A não registrou

    recebidos.length = 0;
    const daB = await aviso(e, e.lojas[1]);
    await avisos.enviarAgora(daB.id);
    expect(recebidos.map((r) => r.caminho)).toEqual([ligB.caminho]);
    expect(JSON.parse(recebidos[0].corpo).loja_id).toBe(e.lojas[1]);

    recebidos.length = 0;
    await ligarAvisos(e, e.lojas[0]);
    const semLoja = await aviso(e, null);
    await avisos.enviarAgora(semLoja.id);
    expect(recebidos.map((r) => r.caminho)).toEqual(['/api/v1/sync/regem/pedido-cancelado']);
  });

  it('empresa de uma loja: aviso sem loja usa o único registro', async () => {
    const e = await empresa(['Única']);
    const lig = await ligarAvisos(e, e.lojas[0]);
    const a = await aviso(e, null);
    await avisos.enviarAgora(a.id);
    expect(recebidos.map((r) => r.caminho)).toEqual([lig.caminho]);
    expect(JSON.parse(recebidos[0].corpo).loja_id).toBe(e.lojas[0]);
  });

  it('"Publicar no GoGeM": assinado para o registro da loja em uso; sem registro, o de hoje', async () => {
    const e = await empresa();
    const token = await credencialAntiga(e);
    const lig = await ligarAvisos(e, e.lojas[0]);

    await expect(publicar.publicar(e.tenant, e.lojas[0])).resolves.toEqual({ ok: true, alterados: 3 });
    expect(recebidos).toHaveLength(1);
    const [r] = recebidos;
    expect(r.caminho).toBe(lig.caminho);
    expect(assinaturaConfere(r, lig.segredo)).toBe(true);
    expect(String(r.cabecalhos['webhook-id'])).toMatch(/^publicar_[0-9a-f-]{36}$/);
    expect(r.cabecalhos['x-sync-token']).toBe(token);
    const corpo = JSON.parse(r.corpo);
    expect(corpo).toMatchObject({ tipo: 'catalogo.publicar', contrato: 1, loja_id: e.lojas[0] });
    expect(Number.isFinite(Date.parse(corpo.pedido_em))).toBe(true);

    // Dois cliques, dois ids (sem repetição: quem repete é o atendente).
    await publicar.publicar(e.tenant, e.lojas[0]);
    expect(new Set(recebidos.map((x) => x.cabecalhos['webhook-id'])).size).toBe(2);

    recebidos.length = 0;
    await expect(publicar.publicar(e.tenant, e.lojas[1])).resolves.toEqual({ ok: true, alterados: 3 });
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].caminho).toBe('/api/v1/sync/regem/publicar');
    expect(recebidos[0].corpo).toBe('{}');
    expect(recebidos[0].cabecalhos['x-sync-token']).toBe(token);
    expect(recebidos[0].cabecalhos['webhook-signature']).toBeUndefined();
  });

  it('"Publicar" com registro e sem o token antigo: sai assinado; sem nenhum dos dois, o erro de hoje', async () => {
    const e = await empresa();
    await expect(publicar.publicar(e.tenant, e.lojas[0])).rejects.toThrow('O GoGeM ainda não se identificou');
    expect(recebidos).toHaveLength(0);
    await ligarAvisos(e, e.lojas[0]);
    await expect(publicar.publicar(e.tenant, e.lojas[0])).resolves.toEqual({ ok: true, alterados: 3 });
    expect(recebidos[0].cabecalhos['x-sync-token']).toBeUndefined();
  });
});
