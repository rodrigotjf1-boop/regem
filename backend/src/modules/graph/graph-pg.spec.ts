import { readFileSync } from 'fs';
import { join } from 'path';
import { createHash, randomBytes } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { decifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { gerarChave, montarChaveIdempotencia } from '../../dms/integracao-dms';
import { FotoDoClienteService } from '../cardapio/foto-do-cliente.service';
import { GraphCliqueService } from './graph-clique.service';
import { GraphFotoService } from './graph-foto.service';
import { GraphImagemService } from './graph-imagem.service';
import {
  MIMES_DO_AUDIO,
  MIMES_DO_MISTER_NO_GRAPH,
  PREFIXO_DA_CHAVE_DO_AUDIO,
  PREFIXO_DA_CHAVE_DO_MISTER,
  oQueOGraphOuviu,
  oQueOGraphViu,
} from '../mister/mister-midia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O DMS GRAPH NO REGEM (G5a; mig 450) contra o Postgres real (TEST_PG_URL), com um DMS ID e um DMS Graph de mentira (o
// `buscar` dos serviços): o clique de ponta a ponta (o pedido com `conta_empresa_id` e o CNPJ, a volta, o segredo
// cifrado, repetir gira, desligar avisa o Graph) e a foto pelo Graph (a chave da mensagem, a tradução, a franquia
// guardada, cada recusa e a demora caindo na IA da empresa dentro dos MESMOS 15 s, e a ligação desfeita lá).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('graph-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATION_450 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '450_graph_ligacao.sql');
const ORIGEM = 'https://graph.exemplo.test';
const MCP = `${ORIGEM}/mcp`;
const ENV: Record<string, string> = {
  GRAPH_LIGADO: 'true',
  GRAPH_MCP_URL: MCP,
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
  ROBO_FOTOS_IA: '1',
};
const VOLTA = 'https://app.dmsregem.com/integracoes/graph/volta';
const MES = '2026-11';

/** Um CNPJ inventado com os dígitos certos (o Graph confere; o banco o quer único). */
function cnpjDeTeste(): string {
  const base = Array.from(randomBytes(12), (b) => String(b % 10)).join('');
  const dv = (b: string) => {
    let soma = 0;
    let peso = b.length - 7;
    for (const c of b) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(base + d1)}`;
}

const json = (status: number, corpo: unknown, tipo = 'application/json') => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': tipo } });
const problema = (status: number, nome: string) => json(status, { type: `https://dms.exemplo/problemas/${nome}`, title: nome, status }, 'application/problem+json');
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever('o DMS Graph no Regem (Postgres real, Graph e DMS ID de mentira)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  /** A IA da empresa de reserva (o cartão diz se há): só o "tem acesso", de mentira. */
  let iaDeReserva = true;
  const iaFalsa = { temAcesso: async () => iaDeReserva } as any;
  const clique = new GraphCliqueService(db, auditoria, iaFalsa);
  const graphFoto = new GraphFotoService(db, auditoria);
  const empresas: string[] = [];
  const envAntes: Record<string, string | undefined> = {};

  // ── o DMS ID e o Graph de mentira ──────────────────────────────────────────────────────────────────────────────
  let tokensPedidos: URLSearchParams[] = [];
  let pedidos: any[] = [];
  let trocas: any[] = [];
  let desligados: string[] = [];
  let chamadasMcp: Array<{ args: any; ligacao: string | null; nome: string | null }> = [];
  let respostaDoPedido: () => Response = () => json(201, { request_uri: `urn:ietf:params:oauth:request_uri:gph_${randomBytes(32).toString('base64url')}`, expires_in: 600, authorization_endpoint: `${ORIGEM}/autorizar` });
  let segredosEntregues: string[] = [];
  let concedidasNaTroca: string[] = ['arquivos.analisar'];
  /** O que a porta MCP responde (o `result` do JSON-RPC, ou um Response pronto para as recusas HTTP). */
  let porta: (c: { args: any; ligacao: string | null }) => Promise<any> | any = () => sucesso();

  const sucesso = (doc: any = { tipo: 'Fotografia', titulo: 'Hambúrguer', contexto: 'Um hambúrguer sem a batata.', secoes: [] }, franquia = { mes: MES, usados: 87, total: 500 }) => {
    const sc = { tipoArquivo: 'imagem', resultados: [doc], franquia };
    return { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc };
  };
  const recusa = (codigo: string, extra: Record<string, unknown> = {}, frase = 'Recusado.') => ({
    isError: true,
    content: [{ type: 'text', text: frase }],
    structuredContent: { situacao: 'recusado', codigo, pode_repetir: false, ...extra },
  });

  const buscar = (async (url: any, init: any) => {
    const u = String(url);
    const cab = new Headers(init?.headers ?? {});
    if (u === `${ENV.DMS_ID_EMISSOR}/token`) {
      tokensPedidos.push(new URLSearchParams(String(init?.body ?? '')));
      return json(200, { access_token: 'token-de-teste', expires_in: 3600 });
    }
    if (cab.get('authorization') !== 'Bearer token-de-teste') return problema(401, 'token-invalido');
    if (u === `${ORIGEM}/v1/dms-id/autorizacao/pedido`) {
      pedidos.push(JSON.parse(String(init.body)));
      return respostaDoPedido();
    }
    if (u === `${ORIGEM}/v1/dms-id/autorizacao/token`) {
      const corpo = JSON.parse(String(init.body));
      trocas.push(corpo);
      // Como o Graph: o verificador tem de bater com o desafio do pedido, e a volta com a do pedido.
      const pedido = pedidos.at(-1);
      const confere = createHash('sha256').update(String(corpo?.code_verifier ?? ''), 'ascii').digest('base64url') === pedido?.code_challenge;
      if (!confere || corpo?.redirect_uri !== pedido?.redirect_uri) return problema(400, 'autorizacao-invalida');
      const { chave, prefixo } = gerarChave('lg', 'graph');
      segredosEntregues.push(chave);
      return json(200, { ligacao: chave, prefixo, conta_id: 'conta-graph-1', conta_nome: pedido.conta_nome, permissoes: concedidasNaTroca, segredo_em: new Date().toISOString() });
    }
    if (u === `${ORIGEM}/v1/dms-id/ligacao` && init?.method === 'DELETE') {
      desligados.push(cab.get('dms-ligacao') ?? '');
      return json(200, { ok: true, revogada_em: new Date().toISOString() });
    }
    if (u === MCP) {
      const corpo = JSON.parse(String(init.body));
      const c = { args: corpo.params?.arguments, ligacao: cab.get('dms-ligacao'), nome: cab.get('mcp-name') };
      chamadasMcp.push(c);
      const r = await porta(c);
      if (r instanceof Response) return r;
      return json(200, { jsonrpc: '2.0', id: corpo.id, result: r });
    }
    throw new Error(`endereço inesperado no teste: ${u}`);
  }) as typeof fetch;
  clique.buscar = buscar;
  graphFoto.buscar = buscar;

  beforeAll(async () => {
    for (const k of [...Object.keys(ENV), 'SEGREDOS_CHAVE', 'EDGE_MODE', 'APP_URL', 'GRAPH_EMPRESAS']) envAntes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.EDGE_MODE;
    delete process.env.APP_URL;
    if (!process.env.SEGREDOS_CHAVE) process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    // Só nuvem: o banco do CI é de loja (a 450 é pulada lá). Trava `empresa` primeiro (ERR-377). A conferência: tudo `ok`.
    const r = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIGRATION_450, 'utf8'))))) as unknown as any[];
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    if (conferencia.length !== 3 || conferencia.some((l: any) => l.ok !== true)) throw new Error(`conferência da 450: ${JSON.stringify(conferencia)}`);
    // Reaplicar não quebra (idempotente).
    await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIGRATION_450, 'utf8'))));
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      for (const t of ['graph_clique_pedido', 'graph_ligacao', 'colaborador'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  beforeEach(() => {
    process.env.GRAPH_LIGADO = 'true';
    delete process.env.GRAPH_EMPRESAS;
    iaDeReserva = true;
    tokensPedidos = [];
    pedidos = [];
    trocas = [];
    desligados = [];
    chamadasMcp = [];
    segredosEntregues = [];
    concedidasNaTroca = ['arquivos.analisar'];
    auditados.length = 0;
    porta = () => sucesso();
  });

  /** Uma empresa com o presidente (e-mail e CNPJ inventados e únicos). `cnpj: null` = sem CNPJ; `email: null` = sem e-mail. */
  async function empresa(o: { cnpj?: string | null; email?: string | null } = {}) {
    const cnpj = o.cnpj === undefined ? cnpjDeTeste() : o.cnpj;
    const t = (await q(`insert into empresa (nome, cnpj) values ('Casa do Hambúrguer', $1) returning id`, [cnpj]))[0].id as string;
    empresas.push(t);
    const email = o.email === undefined ? `dono-${randomBytes(6).toString('hex')}@exemplo.com.br` : o.email;
    const id = (await q(`insert into colaborador (tenant_id, nome, email) values ($1, 'Ana Presidente', $2) returning id`, [t, email]))[0].id as string;
    const ana = { colaboradorId: id, tenantId: t, categoria: 'presidente', nome: 'Ana Presidente' } as any;
    return { t, ana };
  }
  const codigo = () => `gph_ac_${randomBytes(32).toString('base64url')}`;

  /** O clique inteiro: iniciar → (página do Graph) → volta com o código. */
  async function ligar(ana: any) {
    await clique.iniciar(ana);
    const p = pedidos.at(-1);
    return clique.concluir(ana, { code: codigo(), state: String(p.state), iss: ORIGEM });
  }

  describe('o clique Regem → DMS Graph', () => {
    it('GRAPH_LIGADO desligado: a situação diz que não está ligado e as rotas recusam, sem chamar o Graph', async () => {
      const { ana } = await empresa();
      process.env.GRAPH_LIGADO = 'false';
      expect(await clique.situacao(ana)).toMatchObject({ ligado: false, ligacao: null, desligadaPeloGraphEm: null });
      await expect(clique.iniciar(ana)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/não está ligado/) });
      expect(await clique.concluir(ana, { code: codigo(), state: 'x'.repeat(43), iss: ORIGEM })).toEqual({ ligada: false, mensagem: expect.stringMatching(/não está ligado/) });
      await expect(clique.desligar(ana)).rejects.toMatchObject({ status: 409 });
      expect([pedidos, trocas, desligados, tokensPedidos]).toEqual([[], [], [], []]);
    });

    it('o caminho inteiro: o pedido leva a empresa (conta_empresa_id) e o CNPJ; a volta troca; o segredo fica CIFRADO; repetir gira', async () => {
      const { t, ana } = await empresa();
      const antes = await clique.situacao(ana);
      expect(antes).toMatchObject({ ligado: true, empresaNome: 'Casa do Hambúrguer', empresaTemCnpj: true, reservaIa: true, pronto: true, naNuvem: true, podeLigar: true, ligacao: null });
      iaDeReserva = false;
      expect((await clique.situacao(ana)).reservaIa).toBe(false);
      iaDeReserva = true;
      expect(antes.permissoes.map((x: any) => [x.id, x.necessaria, x.pago])).toEqual([
        ['arquivos.analisar', true, false],
        ['audio.ouvir', false, false],
        ['audio.falar', false, false],
        ['imagens.editar', false, true],
        ['imagens.criar', false, true],
      ]);
      expect(antes.legadoAte).toBe('2027-03-01');

      const { url } = await clique.iniciar(ana);
      const pagina = new URL(url);
      expect(`${pagina.origin}${pagina.pathname}`).toBe(`${ORIGEM}/autorizar`);
      expect(pagina.searchParams.get('client_id')).toBe(ENV.HUB_APLICATIVO);
      expect(pagina.searchParams.get('request_uri')).toMatch(/^urn:ietf:params:oauth:request_uri:gph_/);
      const [cnpj] = (await q(`select cnpj from empresa where id = $1`, [t])).map((r: any) => r.cnpj);
      const p = pedidos[0];
      expect(p).toMatchObject({
        response_type: 'code',
        client_id: ENV.HUB_APLICATIVO,
        redirect_uri: VOLTA,
        scope: 'arquivos.analisar audio.ouvir audio.falar imagens.editar imagens.criar',
        code_challenge_method: 'S256',
        conta_nome: 'Casa do Hambúrguer',
        conta_cnpj: cnpj,
        conta_empresa_id: t,
      });
      expect(p.conta_email).toMatch(/@exemplo\.com\.br$/);
      // O token do DMS ID: o destino é a porta do Graph, com tudo o que o Regem pode ter (na chamada vale a menor com a ligação).
      expect(tokensPedidos[0].get('resource')).toBe(MCP);
      expect(tokensPedidos[0].get('scope')).toBe('arquivos.analisar audio.ouvir audio.falar imagens.editar imagens.criar');
      // O pedido em curso: o state só pelo resumo; o verificador cifrado.
      const [guardado] = await q(`select estado_hash, verificador_cifrado, vence_em > now() + interval '9 minutes' as vale from graph_clique_pedido where tenant_id = $1`, [t]);
      expect(guardado.estado_hash).toBe(createHash('sha256').update(String(p.state), 'utf8').digest('hex'));
      expect(guardado.verificador_cifrado).toMatch(/^v1:/);
      expect(guardado.vale).toBe(true);

      const r = await clique.concluir(ana, { code: codigo(), state: String(p.state), iss: ORIGEM });
      expect(r).toEqual({ ligada: true, contaNome: 'Casa do Hambúrguer', permissoes: ['arquivos.analisar'] });
      const vivas = await q(`select * from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t]);
      expect(vivas).toHaveLength(1);
      expect(vivas[0].segredo_cifrado).toMatch(/^v1:/);
      expect(vivas[0].segredo_cifrado).not.toContain(segredosEntregues[0]);
      expect(decifrar(vivas[0].segredo_cifrado)).toBe(segredosEntregues[0]);
      expect(vivas[0]).toMatchObject({ conta_graph: 'conta-graph-1', criada_por: 'Ana Presidente', criada_por_id: ana.colaboradorId });
      expect(auditados.find((a) => a.acao === 'ligou_empresa_ao_graph')).toMatchObject({ tenantId: t, atorId: ana.colaboradorId, origem: 'clique', detalhe: { anterior: null } });
      expect((await clique.situacao(ana)).ligacao).toMatchObject({ contaNome: 'Casa do Hambúrguer', por: 'Ana Presidente', permissoes: ['arquivos.analisar'], franquia: null });
      // A mesma volta de novo: o pedido já foi gasto.
      expect(await clique.concluir(ana, { code: codigo(), state: String(p.state), iss: ORIGEM })).toMatchObject({ ligada: false, mensagem: expect.stringMatching(/não é de um pedido aberto por você/) });

      // Ligar de novo GIRA: a anterior sai ("troca") e só uma fica viva.
      expect(await ligar(ana)).toMatchObject({ ligada: true });
      const todas = await q(`select revogada_em, revogada_origem from graph_ligacao where tenant_id = $1 order by criada_em`, [t]);
      expect(todas.map((l: any) => [l.revogada_em !== null, l.revogada_origem])).toEqual([
        [true, 'troca'],
        [false, null],
      ]);
      expect(decifrar((await q(`select segredo_cifrado from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t]))[0].segredo_cifrado)).toBe(segredosEntregues[1]);
    });

    it('a volta só vale para quem começou, com o iss do Graph e o código gph_; recusado e vencido não ligam', async () => {
      const { t, ana } = await empresa();
      const outro = { ...ana, colaboradorId: (await q(`insert into colaborador (tenant_id, nome) values ($1, 'Outro') returning id`, [t]))[0].id };
      await clique.iniciar(ana);
      expect((await clique.concluir(outro, { code: codigo(), state: String(pedidos[0].state), iss: ORIGEM })).ligada).toBe(false);
      expect(await clique.concluir(ana, { code: codigo(), state: String(pedidos[0].state), iss: 'https://malicioso.example' })).toMatchObject({ ligada: false, mensagem: expect.stringMatching(/não veio do DMS Graph/) });
      await clique.iniciar(ana);
      expect(await clique.concluir(ana, { state: String(pedidos[1].state), error: 'access_denied', iss: ORIGEM })).toMatchObject({ ligada: false, mensagem: expect.stringMatching(/não autorizou/) });
      await clique.iniciar(ana);
      await q(`update graph_clique_pedido set vence_em = now() - interval '1 second' where tenant_id = $1 and concluido_em is null`, [t]);
      expect(await clique.concluir(ana, { code: codigo(), state: String(pedidos[2].state), iss: ORIGEM })).toMatchObject({ ligada: false, mensagem: expect.stringMatching(/venceu/) });
      await clique.iniciar(ana);
      expect((await clique.concluir(ana, { code: `orz_ac_${randomBytes(32).toString('base64url')}`, state: String(pedidos[3].state), iss: ORIGEM })).ligada).toBe(false);
      expect((await q(`select resultado from graph_clique_pedido where tenant_id = $1 order by criado_em`, [t])).map((r: any) => r.resultado)).toEqual(['erro', 'recusado', 'vencido', 'erro']);
      expect(await q(`select 1 from graph_ligacao where tenant_id = $1`, [t])).toEqual([]);
      expect(trocas).toEqual([]);
    });

    it('sem CNPJ válido ou sem o e-mail de quem pede: recusa ANTES de chamar o Graph; o Graph recusando o pedido não grava nada', async () => {
      const semCnpj = await empresa({ cnpj: null });
      // A janela sabe que falta o CNPJ (GR-8: o presidente informa ali) e o iniciar recusa apontando a janela.
      expect((await clique.situacao(semCnpj.ana)).empresaTemCnpj).toBe(false);
      await expect(clique.iniciar(semCnpj.ana)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/Informe o CNPJ da empresa nesta janela/) });
      const cnpjTorto = await empresa({ cnpj: `9${Array.from(randomBytes(13), (b) => String(b % 10)).join('')}`.slice(0, 13) + 'X' });
      await expect(clique.iniciar(cnpjTorto.ana)).rejects.toMatchObject({ status: 400 });
      const semEmail = await empresa({ email: null });
      await expect(clique.iniciar(semEmail.ana)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/e-mail/) });
      expect(pedidos).toEqual([]);
      const { t, ana } = await empresa();
      respostaDoPedido = () => problema(503, 'integracao-parada');
      await expect(clique.iniciar(ana)).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/pausou/) });
      respostaDoPedido = () => json(201, { request_uri: `urn:ietf:params:oauth:request_uri:orz_${'a'.repeat(43)}` });
      await expect(clique.iniciar(ana)).rejects.toMatchObject({ status: 502 });
      expect(await q(`select 1 from graph_clique_pedido where tenant_id = $1`, [t])).toEqual([]);
      respostaDoPedido = () => json(201, { request_uri: `urn:ietf:params:oauth:request_uri:gph_${randomBytes(32).toString('base64url')}`, expires_in: 600, authorization_endpoint: `${ORIGEM}/autorizar` });
    });

    it('desligar: sai aqui na hora, avisa o Graph com o segredo da ligação, auditoria; repetir não dá erro', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      expect(await clique.desligar(ana)).toEqual({ desligada: true });
      expect(desligados).toEqual([segredosEntregues[0]]);
      const [l] = await q(`select revogada_origem, revogada_por, revogada_motivo from graph_ligacao where tenant_id = $1`, [t]);
      expect(l).toEqual({ revogada_origem: 'presidente', revogada_por: 'Ana Presidente', revogada_motivo: 'desligada pelo presidente' });
      expect(auditados.find((a) => a.acao === 'desligou_empresa_do_graph')).toMatchObject({ tenantId: t, atorId: ana.colaboradorId });
      expect(await clique.desligar(ana)).toEqual({ desligada: false });
      expect(desligados).toHaveLength(1);
      expect(await clique.situacao(ana)).toMatchObject({ ligacao: null, desligadaPeloGraphEm: null });
    });

    it('o piloto (GRAPH_EMPRESAS): fora da lista não há cartão, clique nem foto pelo Graph; a lista torta fecha; quem saiu ainda desliga', async () => {
      const dentro = await empresa();
      const fora = await empresa();
      await ligar(fora.ana); // ligou antes de a lista existir
      // Só a empresa de dentro (escrita em maiúsculas e com espaço: vale igual).
      process.env.GRAPH_EMPRESAS = ` ${dentro.t.toUpperCase()} ,`;
      expect(await clique.situacao(dentro.ana)).toMatchObject({ ligado: true, empresaNome: 'Casa do Hambúrguer' });
      expect(await clique.situacao(fora.ana)).toMatchObject({ ligado: false, ligacao: null, empresaNome: null });
      const pedidosAntes = pedidos.length;
      await expect(clique.iniciar(fora.ana)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/não está ligado/) });
      expect(await clique.concluir(fora.ana, { code: codigo(), state: 'x'.repeat(43), iss: ORIGEM })).toEqual({ ligada: false, mensagem: expect.stringMatching(/não está ligado/) });
      expect(pedidos.length).toBe(pedidosAntes);
      // A foto da empresa de fora não vai ao Graph, mesmo com a ligação viva.
      expect(await graphFoto.ligacaoParaFoto(fora.t)).toBeNull();
      // A de dentro liga normalmente.
      expect(await ligar(dentro.ana)).toMatchObject({ ligada: true });
      expect(await graphFoto.ligacaoParaFoto(dentro.t)).toMatchObject({ segredo: segredosEntregues.at(-1) });
      // Lista torta (nenhum id que sirva): ninguém, nunca todas.
      process.env.GRAPH_EMPRESAS = 'empresa-de-teste';
      expect((await clique.situacao(dentro.ana)).ligado).toBe(false);
      expect(await graphFoto.ligacaoParaFoto(dentro.t)).toBeNull();
      // Quem ficou fora ainda desliga o que ligou (o Graph é avisado).
      expect(await clique.desligar(fora.ana)).toEqual({ desligada: true });
      expect(desligados).toContain(segredosEntregues[0]);
    });
  });

  describe('pedir mais e a imagem pelo DMS Graph (contrato 1.4.0)', () => {
    const graphImagem = new GraphImagemService(graphFoto);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const imagemPronta = (franquia = { mes: MES, usados: 1, total: 30 }) => {
      const sc = { tipoArquivo: 'imagem', mimeType: 'image/jpeg', imagemBase64: jpeg.toString('base64'), tamanho: '1K', proporcao: '1:1', franquia };
      return { content: [{ type: 'text', text: '(imagem)' }], structuredContent: sc };
    };

    it('pedir mais: vai o conjunto inteiro; "Agora não" não muda nada; autorizar troca a ligação e guarda o uso', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      await q(`update graph_ligacao set franquia_mes = $1, franquia_usados = 87, franquia_total = 500, franquia_em = now(), ultimo_uso_em = now(),
                      ultima_leitura_em = now(), ultima_leitura_resultado = 'lida' where tenant_id = $2 and revogada_em is null`, [MES, t]);
      const antigo = segredosEntregues[0];

      await clique.iniciar(ana, ['audio.ouvir', 'audio.falar']);
      expect(pedidos.at(-1).scope).toBe('arquivos.analisar audio.ouvir audio.falar');
      expect((await q(`select permissoes from graph_clique_pedido where tenant_id = $1 order by criado_em desc limit 1`, [t]))[0].permissoes).toEqual([
        'arquivos.analisar', 'audio.ouvir', 'audio.falar',
      ]);
      // "Agora não" lá: a ligação segue viva, e a frase não diz que as fotos foram para a IA da empresa
      const recusou = await clique.concluir(ana, { error: 'access_denied', state: String(pedidos.at(-1).state), iss: ORIGEM });
      expect(recusou).toEqual({ ligada: false, mensagem: expect.stringMatching(/continua com o que já estava liberado/) });
      let vivas = await q(`select segredo_cifrado, permissoes from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t]);
      expect(vivas).toHaveLength(1);
      expect(decifrar(vivas[0].segredo_cifrado)).toBe(antigo);
      expect(vivas[0].permissoes).toEqual(['arquivos.analisar']);

      await clique.iniciar(ana, ['audio.ouvir']);
      concedidasNaTroca = ['arquivos.analisar', 'audio.ouvir'];
      const r = await clique.concluir(ana, { code: codigo(), state: String(pedidos.at(-1).state), iss: ORIGEM });
      expect(r).toMatchObject({ ligada: true, permissoes: ['arquivos.analisar', 'audio.ouvir'] });
      vivas = await q(`select * from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t]);
      expect(vivas).toHaveLength(1);
      expect(decifrar(vivas[0].segredo_cifrado)).toBe(segredosEntregues[1]);
      expect(vivas[0]).toMatchObject({ franquia_mes: MES, franquia_usados: 87, franquia_total: 500, ultima_leitura_resultado: 'lida' });
      expect(vivas[0].ultimo_uso_em).not.toBeNull();
      // o próximo pedido soma ao que ela já tem
      await clique.iniciar(ana, ['imagens.criar']);
      expect(pedidos.at(-1).scope).toBe('arquivos.analisar audio.ouvir imagens.criar');
    });

    it('recusa pedir o que não existe ou já está liberado, sem chamar o Graph; a falta no DMS ID tem frase própria', async () => {
      const { ana } = await empresa();
      await ligar(ana);
      const antes = pedidos.length;
      await expect(clique.iniciar(ana, ['videos.criar'])).rejects.toMatchObject({ status: 400 });
      await expect(clique.iniciar(ana, ['arquivos.analisar'])).rejects.toMatchObject({ status: 400 });
      await expect(clique.iniciar(ana, 'audio.ouvir')).rejects.toMatchObject({ status: 400 });
      expect(pedidos).toHaveLength(antes);
      const original = respostaDoPedido;
      respostaDoPedido = () => problema(403, 'escopo-insuficiente');
      try {
        await expect(clique.iniciar(ana, ['audio.ouvir'])).rejects.toMatchObject({ status: 502, message: expect.stringMatching(/ainda não liberou esse recurso/) });
      } finally {
        respostaDoPedido = original;
      }
    });

    it('criarImagem: chama a ferramenta com a chave própria e devolve os bytes; a repetição usa a mesma chave', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      porta = () => imagemPronta();
      const r = await graphImagem.criarImagem(t, { descricao: 'Um hambúrguer', proporcao: '16:9', chave: 'banner:1' });
      expect(r).toMatchObject({ ok: true, mimeType: 'image/jpeg', franquia: { mes: MES, usados: 1, total: 30 } });
      expect((r as any).bytes.equals(jpeg)).toBe(true);
      const c = chamadasMcp.at(-1)!;
      expect(c.nome).toBe('criar_imagem');
      expect(c.args).toEqual({ descricao: 'Um hambúrguer', proporcao: '16:9', chaveIdempotencia: montarChaveIdempotencia('regem-graph-imagem', t, 'criar_imagem', 'banner:1') });
      await graphImagem.criarImagem(t, { descricao: 'Um hambúrguer', proporcao: '16:9', chave: 'banner:1' });
      expect(chamadasMcp.at(-1)!.args.chaveIdempotencia).toBe(c.args.chaveIdempotencia);
      // a franquia de imagem não mexe no medidor de leitura do cartão
      expect((await q(`select franquia_usados from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t]))[0].franquia_usados).toBeNull();
    });

    it('editarImagem: manda as fotos em base64; tipo que o Graph não aceita nem sai daqui', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      porta = () => imagemPronta();
      const r = await graphImagem.editarImagem(t, { fotos: [{ buffer: jpeg, mime: 'image/jpg' }], instrucao: 'Troque o fundo', chave: 'produto:1' });
      expect(r.ok).toBe(true);
      expect(chamadasMcp.at(-1)!.nome).toBe('editar_imagem');
      expect(chamadasMcp.at(-1)!.args.fotos).toEqual([{ mimeType: 'image/jpeg', arquivoBase64: jpeg.toString('base64') }]);
      const n = chamadasMcp.length;
      expect(await graphImagem.editarImagem(t, { fotos: [{ buffer: jpeg, mime: 'image/gif' }], instrucao: 'x', chave: 'produto:2' })).toMatchObject({ ok: false, motivo: 'pedido-invalido' });
      expect(chamadasMcp).toHaveLength(n);
    });

    it('a imagem: desligado, sem ligação, sem franquia, permissão que falta, recusa e ligação desfeita viram o motivo, sem lançar', async () => {
      const { t, ana } = await empresa();
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:1' })).toMatchObject({ ok: false, motivo: 'sem-ligacao' });
      process.env.GRAPH_LIGADO = 'false';
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:1' })).toMatchObject({ ok: false, motivo: 'desligado' });
      process.env.GRAPH_LIGADO = 'true';
      await ligar(ana);
      porta = () => recusa('limite-de-chamadas', { limite: 'franquia_imagem', franquia: { mes: MES, usados: 0, total: 0 } });
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:2' })).toMatchObject({ ok: false, motivo: 'sem-franquia', mensagem: expect.stringMatching(/ainda não tem franquia/) });
      porta = () => recusa('limite-de-chamadas', { limite: 'franquia_imagem', franquia: { mes: MES, usados: 30, total: 30 } });
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:3' })).toMatchObject({ ok: false, motivo: 'franquia-esgotada' });
      porta = () => recusa('regra-invalida');
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:4' })).toMatchObject({ ok: false, motivo: 'recusada' });
      porta = () => new Response(JSON.stringify({ type: 'https://dms.exemplo/problemas/escopo-insuficiente', title: 'x', status: 403 }), {
        status: 403,
        headers: { 'content-type': 'application/problem+json', 'www-authenticate': 'Bearer error="insufficient_scope", scope="imagens.criar"' },
      });
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:5' })).toMatchObject({ ok: false, motivo: 'sem-permissao' });
      porta = () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { mimeType: 'text/html', imagemBase64: 'AAAA' } });
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:6' })).toMatchObject({ ok: false, motivo: 'fora-do-formato' });
      porta = () => problema(401, 'ligacao-invalida');
      expect(await graphImagem.criarImagem(t, { descricao: 'x', chave: 'a:7' })).toMatchObject({ ok: false, motivo: 'ligacao-desfeita' });
      expect(await q(`select 1 from graph_ligacao where tenant_id = $1 and revogada_em is null`, [t])).toHaveLength(0);
    });
  });

  describe('a foto pelo DMS Graph (G-4: o Graph primeiro, a IA da empresa de reserva)', () => {
    // A leitura da foto com a loja ligada ("Ler as fotos") e a vaga do dia simuladas (mig 442, coberta na spec dela); a IA
    // da empresa e a mídia do WhatsApp de mentira; o Graph de verdade do lado do Regem (`GraphFotoService` com o banco).
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), randomBytes(64)]);
    const textoDaConsulta = (x: any) => (x?.queryChunks ?? []).flatMap((c: any) => (Array.isArray(c?.value) ? c.value : [])).join(' ');
    function leitor(o: { mime?: string; semIa?: boolean; iaDemoraMs?: number } = {}) {
      const pedidosIa: Array<{ prazoMs: number; em: number }> = [];
      const guardadas: string[] = [];
      const dbFalso = {
        execute: async (x: any) => {
          const s = textoDaConsulta(x);
          if (/fotos_ler/.test(s)) return { rows: [{ ler: true }] };
          if (/insert into robo_foto_lida/.test(s)) return { rows: [{ lidas: 1 }] };
          if (/update robo_foto_lida/.test(s)) guardadas.push(s);
          return { rows: [] };
        },
      } as any;
      const ia = {
        temAcesso: async () => !o.semIa,
        pedir: async (_t: string, p: any) => {
          pedidosIa.push({ prazoMs: p.prazoMs, em: Date.now() });
          if (o.iaDemoraMs) await esperar(o.iaDemoraMs);
          return { texto: '{"tipo":"outro","descricao":"lida pela IA da empresa"}', recusou: false };
        },
      } as any;
      const resposta = { midiaDoRegem: async () => ({ buffer: PNG, mime: o.mime ?? 'image/png' }) } as any;
      const svc = new FotoDoClienteService(ia, resposta, dbFalso, graphFoto);
      svc.prazos = { totalMs: 3_000, graphMs: 1_500, minimoDaIaMs: 500 };
      return { svc, pedidosIa, guardadas };
    }
    const foto = (t: string, x: any = {}) => ({ tenantId: t, tipo: 'image', texto: '', de: '5521999998888', phoneNumberId: 'PID', midiaId: 'M1', mensagemId: 'wamid.FOTO1', loja: { nome: 'Casa' }, ...x });
    const ligacaoDe = async (t: string) => (await q(`select * from graph_ligacao where tenant_id = $1 order by criada_em desc limit 1`, [t]))[0];

    it('lida pelo Graph: a MESMA estrutura de hoje, a IA da empresa não é chamada, a franquia fica guardada; a mesma mensagem leva a mesma chave', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const l = leitor();
      expect(await l.svc.olhar(foto(t))).toEqual({ tipo: 'pedido_recebido', descricao: 'Um hambúrguer sem a batata.' });
      expect(l.pedidosIa).toEqual([]);
      expect(l.guardadas).toHaveLength(1); // a descrição para o caso ("O que a foto mostra"), como hoje
      expect(chamadasMcp).toHaveLength(1);
      const c = chamadasMcp[0];
      expect(c.nome).toBe('analisar_arquivo');
      expect(c.ligacao).toBe(segredosEntregues[0]);
      expect(c.args).toEqual({ mimeType: 'image/png', arquivoBase64: PNG.toString('base64'), chaveIdempotencia: montarChaveIdempotencia('regem-graph-foto', t, 'wamid.FOTO1') });
      const lg = await ligacaoDe(t);
      expect(lg).toMatchObject({ franquia_mes: MES, franquia_usados: 87, franquia_total: 500, ultima_leitura_resultado: 'lida' });
      expect(lg.ultimo_uso_em).not.toBeNull();
      expect((await clique.situacao(ana)).ligacao?.franquia).toMatchObject({ mes: MES, usados: 87, total: 500 });
      // A mesma mensagem de novo (o aviso entregue duas vezes): a MESMA chave — o Graph devolve o guardado.
      await l.svc.olhar(foto(t));
      expect(chamadasMcp[1].args.chaveIdempotencia).toBe(c.args.chaveIdempotencia);
      await l.svc.olhar(foto(t, { mensagemId: 'wamid.FOTO2' }));
      expect(chamadasMcp[2].args.chaveIdempotencia).not.toBe(c.args.chaveIdempotencia);
      // O comprovante pelo Graph vai pelo caminho do comprovante (o tipo), sem o conteúdo.
      porta = () => sucesso({ tipo: 'Comprovante de transferência Pix', titulo: 'Banco', contexto: 'Pix de R$ 30,00' });
      expect(await l.svc.olhar(foto(t, { mensagemId: 'wamid.PIX' }))).toEqual({ tipo: 'comprovante', descricao: 'comprovante de pagamento' });
    });

    it('a franquia só anda para a frente: a resposta mais velha não volta o número', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const l = leitor();
      porta = () => sucesso(undefined, { mes: MES, usados: 90, total: 500 });
      await l.svc.olhar(foto(t));
      porta = () => sucesso(undefined, { mes: MES, usados: 88, total: 500 });
      await l.svc.olhar(foto(t, { mensagemId: 'wamid.velha' }));
      expect(await ligacaoDe(t)).toMatchObject({ franquia_mes: MES, franquia_usados: 90 });
      porta = () => sucesso(undefined, { mes: '2026-12', usados: 1, total: 500 });
      await l.svc.olhar(foto(t, { mensagemId: 'wamid.dezembro' }));
      expect(await ligacaoDe(t)).toMatchObject({ franquia_mes: '2026-12', franquia_usados: 1 });
    });

    it('cada recusa cai na IA da empresa, no prazo: franquia esgotada (guarda a franquia), sem vaga, chave em uso, chave reutilizada, arquivo não aceito, erro interno, integração parada, limite', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const casos: Array<[string, () => any, string]> = [
        ['franquia', () => recusa('limite-de-chamadas', { limite: 'franquia_mensal', franquia: { mes: MES, usados: 500, total: 500 }, volta_em: '2026-12-01' }), 'franquia-esgotada'],
        ['vaga', () => recusa('limite-de-chamadas', { limite: 'analises_simultaneas', retry_after_seg: 5, pode_repetir: true }), 'recusada:limite-de-chamadas'],
        ['em uso', () => recusa('chave-em-uso', { pode_repetir: true }), 'recusada:chave-em-uso'],
        ['reutilizada', () => recusa('chave-reutilizada'), 'recusada:chave-reutilizada'],
        ['não aceito', () => recusa('parametro-invalido', {}, 'O conteúdo do arquivo não corresponde ao formato informado.'), 'recusada:parametro-invalido'],
        ['erro interno', () => recusa('erro-interno', { pode_repetir: true }, 'Erro interno: o Gemini não concluiu a análise.'), 'recusada:erro-interno'],
        ['parada', () => problema(503, 'integracao-parada'), 'integracao-parada'],
        ['limite', () => problema(429, 'limite-de-chamadas'), 'limite'],
      ];
      for (const [nome, resposta, motivo] of casos) {
        porta = resposta;
        const l = leitor();
        const inicio = Date.now();
        expect([nome, await l.svc.olhar(foto(t, { mensagemId: `wamid.${nome}` }))]).toEqual([nome, { tipo: 'outro', descricao: 'lida pela IA da empresa' }]);
        expect([nome, l.pedidosIa.length]).toEqual([nome, 1]);
        expect(l.pedidosIa[0].prazoMs).toBeLessThanOrEqual(3_000);
        expect(Date.now() - inicio).toBeLessThan(3_000);
        expect([nome, (await ligacaoDe(t)).ultima_leitura_resultado]).toEqual([nome, motivo]);
      }
      // A franquia esgotada que veio na recusa ficou guardada (a mais nova).
      expect(await ligacaoDe(t)).toMatchObject({ franquia_usados: 500, franquia_total: 500, revogada_em: null });
    });

    it('a demora: o Graph passa do prazo dele e a IA recebe só o que SOBRA dos mesmos 15 s; a resposta atrasada ainda guarda a franquia', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      porta = async () => {
        await esperar(2_200);
        return sucesso(undefined, { mes: MES, usados: 120, total: 500 });
      };
      const l = leitor();
      const inicio = Date.now();
      expect(await l.svc.olhar(foto(t))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      const decorrido = Date.now() - inicio;
      expect(decorrido).toBeLessThan(3_000);
      expect(l.pedidosIa).toHaveLength(1);
      // O Graph teve 1,5 s; a IA, o resto dos 3 s (nunca o prazo inteiro de novo).
      expect(l.pedidosIa[0].prazoMs).toBeLessThanOrEqual(1_500);
      expect(l.pedidosIa[0].prazoMs).toBeGreaterThanOrEqual(500);
      expect((await ligacaoDe(t)).ultima_leitura_resultado).toBe('demora');
      await esperar(1_200);
      expect(await ligacaoDe(t)).toMatchObject({ franquia_usados: 120, ultima_leitura_resultado: 'demora' });
      // Sem tempo para a IA (o Graph comeu quase tudo): a foto segue sem descrição, sem passar do prazo.
      porta = async () => {
        await esperar(2_200);
        return sucesso();
      };
      const apertado = leitor();
      apertado.svc.prazos = { totalMs: 1_800, graphMs: 1_500, minimoDaIaMs: 500 };
      const i2 = Date.now();
      expect(await apertado.svc.olhar(foto(t, { mensagemId: 'wamid.apertado' }))).toBeNull();
      expect(apertado.pedidosIa).toEqual([]);
      expect(Date.now() - i2).toBeLessThan(1_800);
      await esperar(1_000);
    });

    it('ligacao-invalida: marca "desligada pelo Graph" UMA vez (auditoria) e segue pela IA; a próxima foto nem chama o Graph; a situação avisa', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      porta = () => problema(401, 'ligacao-invalida');
      const l = leitor();
      // Duas fotos ao mesmo tempo: as duas recebem o 401; só UMA desliga (a gravação condicional) e audita.
      const [a, b] = await Promise.all([l.svc.olhar(foto(t, { mensagemId: 'wamid.A' })), l.svc.olhar(foto(t, { mensagemId: 'wamid.B' }))]);
      expect([a, b]).toEqual([
        { tipo: 'outro', descricao: 'lida pela IA da empresa' },
        { tipo: 'outro', descricao: 'lida pela IA da empresa' },
      ]);
      const lg = await ligacaoDe(t);
      expect(lg).toMatchObject({ revogada_origem: 'graph', revogada_por: 'DMS Graph', ultima_leitura_resultado: 'ligacao-desfeita' });
      expect(lg.revogada_em).not.toBeNull();
      expect(auditados.filter((x) => x.acao === 'graph_desligou_a_empresa')).toHaveLength(1);
      expect(auditados.find((x) => x.acao === 'graph_desligou_a_empresa')).toMatchObject({ tenantId: t, atorTipo: 'integracao', origem: 'graph' });
      const antes = chamadasMcp.length;
      expect(await l.svc.olhar(foto(t, { mensagemId: 'wamid.C' }))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      expect(chamadasMcp.length).toBe(antes);
      const s = await clique.situacao(ana);
      expect(s.ligacao).toBeNull();
      expect(s.desligadaPeloGraphEm).toBe(new Date(lg.revogada_em).toISOString());
      // Ligar de novo pelo clique volta ao Graph.
      porta = () => sucesso();
      await ligar(ana);
      expect((await clique.situacao(ana)).desligadaPeloGraphEm).toBeNull();
      expect(await leitor().svc.olhar(foto(t, { mensagemId: 'wamid.D' }))).toMatchObject({ tipo: 'pedido_recebido' });
    });

    it('sem ligação, com GRAPH_LIGADO desligado ou com o GIF: tudo como hoje — a foto vai só à IA da empresa', async () => {
      const sem = await empresa();
      const l = leitor();
      expect(await l.svc.olhar(foto(sem.t))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      // Sem o Graph, a IA tem o prazo inteiro (como hoje).
      expect(l.pedidosIa[0].prazoMs).toBeGreaterThan(2_900);
      expect(l.pedidosIa[0].prazoMs).toBeLessThanOrEqual(3_000);
      const { t, ana } = await empresa();
      await ligar(ana);
      process.env.GRAPH_LIGADO = 'false';
      const desligado = leitor();
      expect(await desligado.svc.olhar(foto(t))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      process.env.GRAPH_LIGADO = 'true';
      const gif = leitor({ mime: 'image/gif' });
      expect(await gif.svc.olhar(foto(t, { mensagemId: 'wamid.gif' }))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      expect((await ligacaoDe(t)).ultima_leitura_resultado).toBe('tipo-nao-aceito');
      expect(chamadasMcp).toEqual([]);
      // Sem a IA da empresa e sem ligação: nem baixa a foto (como hoje).
      const nada = leitor({ semIa: true });
      expect(await nada.svc.olhar(foto(sem.t))).toBeNull();
      // Só com o Graph (sem IA): lê pelo Graph.
      expect(await leitor({ semIa: true }).svc.olhar(foto(t, { mensagemId: 'wamid.soGraph' }))).toMatchObject({ tipo: 'pedido_recebido' });
    });

    it('a régua de "acesso vale" (V75): a empresa excluída não usa a ligação, mesmo viva', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      expect(await graphFoto.ligacaoParaFoto(t)).toMatchObject({ segredo: segredosEntregues[0] });
      await q(`update empresa set deleted_at = now() where id = $1`, [t]);
      expect(await graphFoto.ligacaoParaFoto(t)).toBeNull();
      const l = leitor();
      expect(await l.svc.olhar(foto(t, { mensagemId: 'wamid.excluida' }))).toEqual({ tipo: 'outro', descricao: 'lida pela IA da empresa' });
      expect(chamadasMcp).toEqual([]);
    });

    // Versão 5 do Mister (M5a): a foto e o PDF que a EQUIPE manda ao Mister passam pela mesma porta, com a tradução e a
    // chave do Mister — a foto do cliente (o atendente) não muda: segue só imagem e com a chave dela.
    it('o Mister (M5a): `analisar` leva o PDF e a chave própria, com a tradução de quem chama; a foto do cliente segue só imagem', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const lig = (await graphFoto.ligacaoParaFoto(t))!;
      const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(32)]);
      porta = () => sucesso({ tipo: 'Cardápio', titulo: 'Cardápio impresso', contexto: 'Um cardápio com 12 lanches. Preços de R$ 20 a R$ 45.', secoes: [] });
      const r = await graphFoto.analisar(t, lig, { buffer: PDF, mime: 'application/pdf', mensagemId: 'wamid.PDF1' }, 1_500, oQueOGraphViu, {
        mimes: MIMES_DO_MISTER_NO_GRAPH,
        prefixoDaChave: PREFIXO_DA_CHAVE_DO_MISTER,
      });
      expect(r).toMatchObject({ resumo: 'Um cardápio com 12 lanches', financeiro: false });
      const c = chamadasMcp.at(-1)!;
      expect(c.args).toEqual({ mimeType: 'application/pdf', arquivoBase64: PDF.toString('base64'), chaveIdempotencia: montarChaveIdempotencia('regem-graph-mister', t, 'wamid.PDF1') });
      expect((await ligacaoDe(t)).ultima_leitura_resultado).toBe('lida');
      // A tradução que devolve null = "fora do formato" (a reserva lê): nada quebra e a ligação anota.
      porta = () => sucesso();
      expect(await graphFoto.analisar(t, lig, { buffer: PNG, mime: 'image/png', mensagemId: 'wamid.FF' }, 1_500, () => null)).toBeNull();
      expect((await ligacaoDe(t)).ultima_leitura_resultado).toBe('fora-do-formato');
      // A foto do cliente (o atendente) segue só imagem: o PDF nem chama o Graph, e a chave da imagem é a de sempre.
      const n = chamadasMcp.length;
      expect(await graphFoto.ler(t, lig, { buffer: PDF, mime: 'application/pdf', mensagemId: 'wamid.PDF2' }, 1_500)).toBeNull();
      expect(chamadasMcp).toHaveLength(n);
      await graphFoto.ler(t, lig, { buffer: PNG, mime: 'image/png', mensagemId: 'wamid.FOTO9' }, 1_500);
      expect(chamadasMcp.at(-1)!.args.chaveIdempotencia).toBe(montarChaveIdempotencia('regem-graph-foto', t, 'wamid.FOTO9'));
    });

    // M5b: o áudio vai à `ouvir_audio` (contrato 1.1.0 do Graph) e o motivo de não ter ouvido chega a quem chama.
    it('o Mister (M5b): `analisar` chama a `ouvir_audio` com o áudio e a chave dele; a franquia esgotada chega em `aoFalhar`', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const lig = (await graphFoto.ligacaoParaFoto(t))!;
      const OGG = Buffer.concat([Buffer.from('OggS'), randomBytes(60)]);
      const ouvido = { tipoArquivo: 'audio', transcricao: 'Quanto vendeu ontem?', inaudivel: false, idioma: 'pt-BR', duracaoSegundos: 3, franquia: { mes: MES, usados: 88, total: 500 } };
      porta = () => ({ content: [{ type: 'text', text: JSON.stringify(ouvido) }], structuredContent: ouvido });
      const motivos: string[] = [];
      const opcoes = { ferramenta: 'ouvir_audio', mimes: MIMES_DO_AUDIO, prefixoDaChave: PREFIXO_DA_CHAVE_DO_AUDIO, aoFalhar: (m: string) => motivos.push(m) };
      const r = await graphFoto.analisar(t, lig, { buffer: OGG, mime: 'audio/ogg', mensagemId: 'wamid.AUDIO1' }, 1_500, oQueOGraphOuviu, opcoes);
      expect(r).toEqual({ transcricao: 'Quanto vendeu ontem?', inaudivel: false });
      const c = chamadasMcp.at(-1)!;
      expect(c.nome).toBe('ouvir_audio');
      expect(c.args).toEqual({ mimeType: 'audio/ogg', arquivoBase64: OGG.toString('base64'), chaveIdempotencia: montarChaveIdempotencia('regem-graph-ouvir', t, 'wamid.AUDIO1') });
      expect(motivos).toEqual([]);
      expect((await ligacaoDe(t)).franquia_usados).toBe(88);
      // A franquia esgotada: o motivo chega a quem chama (o áudio diz "até o dia 1º").
      porta = () => recusa('limite-de-chamadas', { limite: 'franquia_mensal', franquia: { mes: MES, usados: 500, total: 500 }, volta_em: '2026-12-01' });
      expect(await graphFoto.analisar(t, lig, { buffer: OGG, mime: 'audio/ogg', mensagemId: 'wamid.AUDIO2' }, 1_500, oQueOGraphOuviu, opcoes)).toBeNull();
      expect(motivos).toEqual(['franquia-esgotada']);
      // O tipo que não é da lista nem chama o Graph, e diz por quê.
      const n = chamadasMcp.length;
      expect(await graphFoto.analisar(t, lig, { buffer: OGG, mime: 'audio/amr', mensagemId: 'wamid.AUDIO3' }, 1_500, oQueOGraphOuviu, opcoes)).toBeNull();
      expect(chamadasMcp).toHaveLength(n);
      expect(motivos.at(-1)).toBe('tipo-nao-aceito');
    });

    // M5c: a resposta em áudio — o texto vai à `falar` (contrato 1.2.0 do Graph) e volta a nota de voz OGG.
    it('o Mister (M5c): `falar` manda o texto e a chave, devolve o OGG e guarda a franquia; voz desligada, fora do formato e franquia chegam em `aoFalhar`', async () => {
      const { t, ana } = await empresa();
      await ligar(ana);
      const lig = (await graphFoto.ligacaoParaFoto(t))!;
      const OGG = Buffer.concat([Buffer.from('OggS'), randomBytes(60)]);
      const falado = { tipoArquivo: 'audio', mimeType: 'audio/ogg', audioBase64: OGG.toString('base64'), caracteres: 24, franquia: { mes: MES, usados: 91, total: 500 } };
      porta = () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: falado });
      const motivos: string[] = [];
      const aoFalhar = (m: string) => motivos.push(m);
      const r = await graphFoto.falar(t, lig, 'Ontem a loja vendeu bem.', 'regem-falar-abc12345', 1_500, aoFalhar);
      expect(r?.equals(OGG)).toBe(true);
      const c = chamadasMcp.at(-1)!;
      expect(c.nome).toBe('falar');
      expect(c.args).toEqual({ texto: 'Ontem a loja vendeu bem.', chaveIdempotencia: 'regem-falar-abc12345' });
      expect(motivos).toEqual([]);
      expect((await ligacaoDe(t)).franquia_usados).toBe(91);
      // A voz ainda não ligada no Graph (o Google recusou): `integracao-parada` vira "voz-desligada", e a ligação segue.
      porta = () => recusa('integracao-parada', {});
      expect(await graphFoto.falar(t, lig, 'Outra resposta.', 'regem-falar-def12345', 1_500, aoFalhar)).toBeNull();
      expect(motivos).toEqual(['voz-desligada']);
      expect((await ligacaoDe(t)).revogada_em).toBeNull();
      // O que não é OGG: fora do formato.
      porta = () => ({ content: [{ type: 'text', text: '{}' }], structuredContent: { ...falado, audioBase64: Buffer.from('não é ogg').toString('base64') } });
      expect(await graphFoto.falar(t, lig, 'Mais uma.', 'regem-falar-ghi12345', 1_500, aoFalhar)).toBeNull();
      expect(motivos.at(-1)).toBe('fora-do-formato');
      // A franquia esgotada: o motivo de sempre.
      porta = () => recusa('limite-de-chamadas', { limite: 'franquia_mensal', franquia: { mes: MES, usados: 500, total: 500 }, volta_em: '2026-12-01' });
      expect(await graphFoto.falar(t, lig, 'E outra.', 'regem-falar-jkl12345', 1_500, aoFalhar)).toBeNull();
      expect(motivos.at(-1)).toBe('franquia-esgotada');
    });
  });
});
