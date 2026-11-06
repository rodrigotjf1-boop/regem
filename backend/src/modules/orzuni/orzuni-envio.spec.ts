import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { cifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { ErroMcp } from '../../dms/integracao-dms';
import { OrzuniEnvioService } from './orzuni-envio.service';
import { OrzuniLigacaoService } from './orzuni-ligacao.service';
import { chaveDoEnvio, desfechoDaRecusa, lerConfigOrzuni, recuoMinutos } from './orzuni.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// iFOOD PELO ORZUNI — R2a (mig 370): a fila gravada pelos GATILHOS do banco e o despacho pela porta MCP do Orzuni,
// contra Postgres (TEST_PG_URL), com uma porta e um DMS ID falsos (o `buscar` dos dois clientes do pacote).
// Decisões do dono (06/11/2026): pausam no iFood o "Ativo no iFood", o esgotado por estoque (o da loja só na loja) e o
// "Em falta" da opção; a ligação da loja é registrada no console da distribuição.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('orzuni-envio.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

const MIGRATION = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '370_orzuni_envio.sql');
const MCP = 'https://orzuni.exemplo.test/v1/mcp';
const TROCA = 'https://orzuni.exemplo.test/v1/dms-id/ligacao';
const ENV = {
  ORZUNI_LIGADO: 'true',
  ORZUNI_MCP_URL: MCP,
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
};

describe('regras do Orzuni (sem banco)', () => {
  it('desligado sem ORZUNI_LIGADO; sem a credencial do DMS ID, nem a troca', () => {
    expect(lerConfigOrzuni({ ...ENV, ORZUNI_LIGADO: undefined }).envioLigado).toBe(false);
    expect(lerConfigOrzuni({ ...ENV, ORZUNI_LIGADO: undefined }).credencialOk).toBe(true);
    const sem = lerConfigOrzuni({ ...ENV, HUB_SEGREDO: 'curto' });
    expect([sem.envioLigado, sem.credencialOk]).toEqual([false, false]);
    expect(sem.motivo).toMatch(/HUB_SEGREDO/);
    const padrao = lerConfigOrzuni({ ...ENV, ORZUNI_MCP_URL: undefined });
    expect([padrao.endereco, padrao.recurso, padrao.urlLigacao]).toEqual([
      'https://api.orzuni.com/v1/mcp',
      'https://api.orzuni.com/v1/mcp',
      'https://api.orzuni.com/v1/dms-id/ligacao',
    ]);
    expect(lerConfigOrzuni({ ...ENV, ORZUNI_MCP_URL: 'http://orzuni.exemplo.test/v1/mcp' }).credencialOk).toBe(false);
  });
  it('recuo cresce e para em 60 min; a chave muda com a versão e repete com a mesma', () => {
    expect([1, 2, 3, 4, 5, 6, 9].map(recuoMinutos)).toEqual([1, 2, 5, 10, 30, 60, 60]);
    const a = chaveDoEnvio({ id: '11111111-1111-4111-8111-111111111111', versao: 1 });
    expect(a).toBe(chaveDoEnvio({ id: '11111111-1111-4111-8111-111111111111', versao: 1 }));
    expect(a).not.toBe(chaveDoEnvio({ id: '11111111-1111-4111-8111-111111111111', versao: 2 }));
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(100);
  });
  it('recusa: lê o código do JSON da frase (plano B do 0.10.0); sem JSON, a frase é o motivo', () => {
    const json = new ErroMcp({ tipo: 'ferramenta', ferramenta: 'preco_definir', frase: JSON.stringify({ situacao: 'recusado', codigo: 'ifood_indisponivel', pode_repetir: true }) });
    expect(desfechoDaRecusa(json)).toMatchObject({ resultado: 'recusado', repetir: true, resposta: { codigo: 'ifood_indisponivel' } });
    const nao = new ErroMcp({ tipo: 'ferramenta', ferramenta: 'preco_definir', frase: JSON.stringify({ situacao: 'nao_encontrado', codigo: 'pdv_inexistente', pode_repetir: false }) });
    expect(desfechoDaRecusa(nao)).toMatchObject({ resultado: 'nao_encontrado', repetir: false, resposta: { codigo: 'pdv_inexistente' } });
    const frase = new ErroMcp({ tipo: 'ferramenta', ferramenta: 'preco_definir', frase: 'Input validation error: valor' });
    expect(desfechoDaRecusa(frase)).toMatchObject({ resultado: 'recusado', repetir: false, resposta: { frase: 'Input validation error: valor' } });
    // O 0.10.1 deve trazer o structuredContent da recusa em `dados`: vale antes da frase.
    const comDados = Object.assign(new ErroMcp({ tipo: 'ferramenta', ferramenta: 'item_pausar', frase: 'Código PDV 9 não existe' }), {
      dados: { situacao: 'nao_encontrado', codigo: 'pdv_inexistente', pode_repetir: false },
    });
    expect(desfechoDaRecusa(comDados)).toMatchObject({ resultado: 'nao_encontrado', resposta: { codigo: 'pdv_inexistente' } });
  });
});

descrever('iFood pelo Orzuni — fila e envio (Postgres real, porta falsa)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const envio = new OrzuniEnvioService(db, auditoria);
  const console_ = new OrzuniLigacaoService(db, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const envAntes: Record<string, string | undefined> = {};

  // ── a porta falsa (DMS ID + Orzuni) ───────────────────────────────────────────────────────────────────────────
  type Chamada = { ferramenta: string; args: any; ligacao: string | null };
  let chamadas: Chamada[] = [];
  let responder: (c: Chamada) => { status?: number; corpo?: any; result?: any; antes?: () => Promise<void> } = () => ({
    result: { content: [{ type: 'text', text: JSON.stringify({ situacao: 'aplicado', antes: 30, depois: 36.5 }) }] },
  });
  let troca: (corpo: any) => { status: number; corpo: any } = () => ({ status: 500, corpo: {} });
  let trocasFeitas = 0;
  const json = (status: number, corpo: any, cab: Record<string, string> = {}) =>
    new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cab } });
  const buscar = (async (url: any, init: any) => {
    const u = String(url);
    if (u === `${ENV.DMS_ID_EMISSOR}/token`) return json(200, { access_token: 'token-de-teste', expires_in: 3600 });
    if (u === TROCA) {
      trocasFeitas++;
      const t = troca(JSON.parse(String(init?.body ?? '{}')));
      return json(t.status, t.corpo);
    }
    if (u === MCP) {
      const corpo = JSON.parse(String(init?.body ?? '{}'));
      const h = new Headers(init?.headers ?? {});
      const c: Chamada = { ferramenta: corpo.params?.name, args: corpo.params?.arguments, ligacao: h.get('dms-ligacao') };
      chamadas.push(c);
      const r = responder(c);
      if (r.antes) await r.antes();
      if (r.status) return json(r.status, r.corpo ?? {});
      return json(200, { jsonrpc: '2.0', id: corpo.id, result: r.result });
    }
    throw new Error(`endereço inesperado no teste: ${u}`);
  }) as typeof fetch;
  envio.buscar = buscar;
  console_.buscar = buscar;

  beforeAll(async () => {
    for (const k of [...Object.keys(ENV), 'SEGREDOS_CHAVE', 'EDGE_MODE']) envAntes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.EDGE_MODE;
    if (!process.env.SEGREDOS_CHAVE) process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    // Só nuvem: o banco do CI é de loja. Trava `empresa` primeiro (ERR-377) e repete na corrida de catálogo.
    const texto = readFileSync(MIGRATION, 'utf8');
    await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(texto)));
    // `edge_status` é só da nuvem; outras specs a criam com o mínimo — aqui ela ganha as colunas que a liberação lê.
    await pool
      .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid,
                unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    await pool.query(`alter table edge_status add column if not exists equipamento_id uuid, add column if not exists versao text`);
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      await pool.query(`delete from edge_status where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      for (const t of ['orzuni_envio', 'orzuni_ligacao', 'produto_pausa_estoque', 'opcao', 'produto', 'categoria_produto',
        'entitlement', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    chamadas = [];
    auditados.length = 0;
    responder = (c) => ({
      result: { content: [{ type: 'text', text: JSON.stringify({ situacao: 'aplicado', antes: 30, depois: c.args?.valor ?? null }) }] },
    });
  });

  // ── a loja de teste ───────────────────────────────────────────────────────────────────────────────────────────
  const segredo = () => `dms_lg_orzuni_${randomBytes(18).toString('base64url')}`;
  async function loja(o: { lojas?: number; direito?: boolean; ligadas?: number } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste orzuni envio') returning id`))[0].id as string;
    empresas.push(t);
    const lojas: string[] = [];
    for (let i = 0; i < (o.lojas ?? 2); i++)
      lojas.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    if (o.direito !== false)
      await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || 'ifood_pelo_orzuni')::uuid, $2, 'ifood_pelo_orzuni', true)`, [t, t]);
    const segredos: Record<string, string> = {};
    for (const u of lojas.slice(0, o.ligadas ?? lojas.length)) {
      segredos[u] = segredo();
      await q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo) values ($1, $2, $3, 'dms_lg_orzuni_teste')`, [
        t,
        u,
        cifrar(segredos[u]),
      ]);
    }
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    return { t, lojas, segredos, cat };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const produto = async (l: Loja, extra: Record<string, any> = {}) => {
    const cols = { tenant_id: l.t, nome: 'X-Burguer', codigo: '12', categoria_id: l.cat, preco_venda: 32.9, no_ifood: true, ...extra };
    const k = Object.keys(cols);
    return (await q(`insert into produto (${k.join(',')}) values (${k.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(cols)))[0]
      .id as string;
  };
  const fila = (t: string) =>
    q(`select unidade_id, tipo, ref_id, versao, situacao, resultado, resposta, tentativas, proxima_em > now() as adiado
         from orzuni_envio where tenant_id = $1 order by tipo, unidade_id`, [t]);
  const despachar = (l: Loja) => envio.processar({ tenantIds: [l.t] });

  it('sem ligação na loja, ou sem o direito na empresa: mudar o preço não enfileira nada', async () => {
    const semLigacao = await loja({ ligadas: 0 });
    const p1 = await produto(semLigacao);
    await q(`update produto set preco_ifood = 34.9 where id = $1`, [p1]);
    expect(await fila(semLigacao.t)).toHaveLength(0);
    const semDireito = await loja({ direito: false });
    const p2 = await produto(semDireito);
    await q(`update produto set preco_ifood = 34.9 where id = $1`, [p2]);
    expect(await fila(semDireito.t)).toHaveLength(0);
  });

  it('preço: uma linha por loja ligada; edições seguidas viram UM envio com o valor novo, em reais, pela ligação da loja', async () => {
    const l = await loja();
    const p = await produto(l);
    await q(`update produto set preco_ifood = 34.9 where id = $1`, [p]);
    await q(`update produto set preco_ifood = 36.5 where id = $1`, [p]);
    const antes = await fila(l.t);
    expect(antes.map((x: any) => [x.tipo, x.versao, x.situacao])).toEqual([
      ['preco_item', 2, 'pendente'],
      ['preco_item', 2, 'pendente'],
    ]);
    const r = await despachar(l);
    expect(r).toEqual({ enviados: 2, dispensados: 0, adiados: 0, desistidos: 0 });
    expect(chamadas.map((c) => [c.ferramenta, c.args.codigo_pdv, c.args.valor])).toEqual([
      ['preco_definir', '12', 36.5],
      ['preco_definir', '12', 36.5],
    ]);
    // Cada loja pela SUA ligação; chaves diferentes (uma linha por loja).
    expect(new Set(chamadas.map((c) => c.ligacao))).toEqual(new Set(Object.values(l.segredos)));
    expect(new Set(chamadas.map((c) => c.args.chaveIdempotencia)).size).toBe(2);
    const depois = await fila(l.t);
    expect(depois.map((x: any) => [x.situacao, x.resultado, x.resposta?.depois])).toEqual([
      ['feito', 'aplicado', 36.5],
      ['feito', 'aplicado', 36.5],
    ]);
    expect(auditados.filter((a) => a.acao === 'enviou_ao_ifood_pelo_orzuni')).toHaveLength(2);
    // Mesma volta de novo: nada pendente, nada sai.
    expect(await despachar(l)).toEqual({ enviados: 0, dispensados: 0, adiados: 0, desistidos: 0 });
  });

  it('produto de UMA loja só vai ao iFood dela; marcado fora do iFood, sem código ou excluído não enfileira', async () => {
    const l = await loja();
    const daLoja = await produto(l, { unidade_id: l.lojas[0] });
    await q(`update produto set preco_ifood = 20 where id = $1`, [daLoja]);
    expect((await fila(l.t)).map((x: any) => x.unidade_id)).toEqual([l.lojas[0]]);
    const fora = await produto(l, { codigo: '13', no_ifood: false });
    const semCodigo = await produto(l, { codigo: null });
    await q(`update produto set preco_ifood = 21 where id = any($1::uuid[])`, [[fora, semCodigo]]);
    expect(await fila(l.t)).toHaveLength(1);
  });

  it('30 → 35 → 30: três envios com chaves diferentes (a porta não responde "repetido" à volta do preço)', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    const chaves: string[] = [];
    for (const v of [30, 35, 30]) {
      await q(`update produto set preco_ifood = $2 where id = $1`, [p, v]);
      await despachar(l);
      chaves.push(chamadas[chamadas.length - 1].args.chaveIdempotencia);
    }
    expect(chamadas.map((c) => c.args.valor)).toEqual([30, 35, 30]);
    expect(new Set(chaves).size).toBe(3);
  });

  it('status: "Ativo no iFood" pausa e reativa em todas; esgotado da LOJA só nela; esgotado de todas, em todas', async () => {
    const l = await loja();
    const p = await produto(l);
    await q(`update produto set canais_pausados = '["ifood"]'::jsonb where id = $1`, [p]);
    await despachar(l);
    expect(chamadas.map((c) => c.ferramenta)).toEqual(['item_pausar', 'item_pausar']);
    chamadas = [];
    await q(`update produto set canais_pausados = '[]'::jsonb where id = $1`, [p]);
    await despachar(l);
    expect(chamadas.map((c) => c.ferramenta)).toEqual(['item_reativar', 'item_reativar']);
    chamadas = [];
    await q(`insert into produto_pausa_estoque (id, tenant_id, produto_id, unidade_id, pausado) values ($4, $1, $2, $3, true)`, [
      l.t,
      p,
      l.lojas[0],
      randomUUID(),
    ]);
    await despachar(l);
    expect(chamadas.map((c) => [c.ferramenta, c.ligacao])).toEqual([['item_pausar', l.segredos[l.lojas[0]]]]);
    chamadas = [];
    // Pausado em todas (o campo antigo): as duas; a loja 1 segue pausada pelo estoque dela.
    await q(`update produto set pausado_estoque = true where id = $1`, [p]);
    await despachar(l);
    expect(chamadas.map((c) => c.ferramenta).sort()).toEqual(['item_pausar', 'item_pausar']);
    chamadas = [];
    await q(`update produto set pausado_estoque = false where id = $1`, [p]);
    await despachar(l);
    const porLoja = Object.fromEntries(chamadas.map((c) => [c.ligacao, c.ferramenta]));
    expect(porLoja[l.segredos[l.lojas[0]]]).toBe('item_pausar'); // ainda esgotado nela
    expect(porLoja[l.segredos[l.lojas[1]]]).toBe('item_reativar');
  });

  it('opção: preço (zero vale: complemento grátis) e "Em falta" vão por código PDV a todas as lojas', async () => {
    const l = await loja();
    const o = (await q(`insert into opcao (tenant_id, nome, codigo_pdv) values ($1, 'Bacon', '501') returning id`, [l.t]))[0].id;
    await q(`update opcao set preco_ifood = 0 where id = $1`, [o]);
    await q(`update opcao set esgotado = true where id = $1`, [o]);
    await despachar(l);
    expect(chamadas.map((c) => [c.ferramenta, c.args.codigo_pdv, c.args.valor ?? null]).sort()).toEqual([
      ['complemento_pausar', '501', null],
      ['complemento_pausar', '501', null],
      ['complemento_preco_definir', '501', 0],
      ['complemento_preco_definir', '501', 0],
    ]);
    // Sem código PDV não enfileira.
    const semCodigo = (await q(`insert into opcao (tenant_id, nome) values ($1, 'Obs') returning id`, [l.t]))[0].id;
    await q(`update opcao set preco_ifood = 1, esgotado = true where id = $1`, [semCodigo]);
    expect((await fila(l.t)).filter((x: any) => x.ref_id === semCodigo)).toHaveLength(0);
  });

  it('recusa da porta: "não existe no iFood" fica guardado com o código; recusa que pode repetir volta à fila com a MESMA chave', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    const recusa = (codigo: string, pode: boolean, situacao = 'recusado') => ({
      result: {
        isError: true,
        content: [{ type: 'text', text: JSON.stringify({ situacao, codigo, pode_repetir: pode }) }],
        structuredContent: { situacao, codigo, pode_repetir: pode },
      },
    });
    responder = () => recusa('pdv_inexistente', false, 'nao_encontrado');
    await q(`update produto set preco_ifood = 40 where id = $1`, [p]);
    await despachar(l);
    let [f] = await fila(l.t);
    expect([f.situacao, f.resultado, f.resposta.codigo]).toEqual(['feito', 'nao_encontrado', 'pdv_inexistente']);

    responder = () => recusa('ifood_indisponivel', true);
    await q(`update produto set preco_ifood = 41 where id = $1`, [p]);
    await despachar(l);
    [f] = await fila(l.t);
    expect([f.situacao, f.adiado]).toEqual(['pendente', true]);
    const primeira = chamadas[chamadas.length - 1].args.chaveIdempotencia;
    await q(`update orzuni_envio set proxima_em = now() where tenant_id = $1`, [l.t]);
    responder = (c) => ({ result: { content: [{ type: 'text', text: JSON.stringify({ situacao: 'aplicado', depois: c.args.valor }) }] } });
    await despachar(l);
    expect(chamadas[chamadas.length - 1].args.chaveIdempotencia).toBe(primeira);
    [f] = await fila(l.t);
    expect([f.situacao, f.resultado]).toEqual(['feito', 'aplicado']);
  });

  it('a loja desfez a ligação no Orzuni (401 ligacao-invalida): revoga aqui e dispensa, sem pedir outro token', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    responder = () => ({
      status: 401,
      corpo: { type: 'https://dev.dmstecnologias.com/erros/ligacao-invalida', title: 'Ligação inválida', status: 401 },
    });
    await q(`update produto set preco_ifood = 40 where id = $1`, [p]);
    expect(await despachar(l)).toMatchObject({ dispensados: 1 });
    expect(chamadas).toHaveLength(1);
    const [lig] = await q(`select revogada_em is not null as revogada, revogada_por, revogada_motivo from orzuni_ligacao where tenant_id = $1`, [l.t]);
    expect(lig).toEqual({ revogada: true, revogada_por: 'orzuni', revogada_motivo: 'ligacao-invalida' });
    const [f] = await fila(l.t);
    expect([f.situacao, f.resultado]).toEqual(['feito', 'dispensado']);
  });

  it('régua na hora de mandar (V75): loja excluída ou direito desligado depois → dispensado sem chamar a porta', async () => {
    const l = await loja();
    const p = await produto(l);
    await q(`update produto set preco_ifood = 40 where id = $1`, [p]);
    await q(`update unidade set deleted_at = now() where id = $1`, [l.lojas[0]]);
    await q(`update entitlement set ativo = false where tenant_id = $1`, [l.t]);
    expect(await despachar(l)).toEqual({ enviados: 0, dispensados: 2, adiados: 0, desistidos: 0 });
    expect(chamadas).toHaveLength(0);
    const motivos = (await fila(l.t)).map((x: any) => x.resposta.motivo).sort();
    expect(motivos).toEqual(['loja excluída ou de outra empresa', 'o iFood pelo Orzuni está desligado nesta empresa']);
  });

  it('item com preço zero e preço apagado antes de sair: dispensa com o motivo, sem chamar a porta', async () => {
    const l = await loja({ lojas: 1 });
    const zero = await produto(l);
    await q(`update produto set preco_ifood = 0 where id = $1`, [zero]);
    const apagado = await produto(l, { codigo: '14' });
    await q(`update produto set preco_ifood = 9 where id = $1`, [apagado]);
    await q(`update produto set preco_ifood = null where id = $1`, [apagado]);
    await despachar(l);
    expect(chamadas).toHaveLength(0);
    const motivos = (await fila(l.t)).map((x: any) => x.resposta.motivo).sort();
    expect(motivos).toEqual(['o iFood não aceita item com preço zero', 'sem preço no iFood (em branco: o Regem não mexe no preço de lá)']);
  });

  it('a mudança que chega DURANTE o envio volta à fila e sai com o valor novo', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    await q(`update produto set preco_ifood = 50 where id = $1`, [p]);
    let uma = true;
    responder = (c) => ({
      antes: async () => {
        if (uma) {
          uma = false;
          await q(`update produto set preco_ifood = 55 where id = $1`, [p]);
        }
      },
      result: { content: [{ type: 'text', text: JSON.stringify({ situacao: 'aplicado', depois: c.args.valor }) }] },
    });
    await despachar(l);
    let [f] = await fila(l.t);
    expect([f.situacao, f.versao]).toEqual(['pendente', 2]);
    await despachar(l);
    [f] = await fila(l.t);
    expect(f.situacao).toBe('feito');
    expect(chamadas.map((c) => c.args.valor)).toEqual([50, 55]);
  });

  it('sem ORZUNI_LIGADO a fila espera (nada sai, nada se perde)', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    await q(`update produto set preco_ifood = 40 where id = $1`, [p]);
    process.env.ORZUNI_LIGADO = 'false';
    try {
      expect(await despachar(l)).toEqual({ enviados: 0, dispensados: 0, adiados: 0, desistidos: 0 });
    } finally {
      process.env.ORZUNI_LIGADO = 'true';
    }
    expect((await fila(l.t))[0].situacao).toBe('pendente');
    await despachar(l);
    expect((await fila(l.t))[0].situacao).toBe('feito');
  });

  it('porta fora para DUAS empresas: a volta para e devolve o resto à fila sem gastar tentativa', async () => {
    const a = await loja({ lojas: 1 });
    const b = await loja({ lojas: 1 });
    const c = await loja({ lojas: 1 });
    for (const l of [a, b, c]) await q(`update produto set preco_ifood = 40 where id = $1`, [await produto(l)]);
    responder = () => ({ status: 503, corpo: { type: 'https://dev.dmstecnologias.com/erros/integracao-parada', status: 503 } });
    const r = await envio.processar({ tenantIds: [a.t, b.t, c.t] });
    expect(r).toEqual({ enviados: 0, dispensados: 0, adiados: 3, desistidos: 0 });
    const todas = await q(`select tenant_id, situacao, tentativas from orzuni_envio where tenant_id = any($1::uuid[])`, [[a.t, b.t, c.t]]);
    expect(todas.every((x: any) => x.situacao === 'pendente')).toBe(true);
    expect(todas.map((x: any) => x.tentativas).sort()).toEqual([0, 1, 1]); // a terceira não chegou a sair
  });

  // ── o console da distribuição ─────────────────────────────────────────────────────────────────────────────────

  it('console: registra a ligação trocando a chave (guardada CIFRADA), troca de novo revoga a anterior; chave fora do formato nem sai', async () => {
    const l = await loja({ ligadas: 0 });
    const chave = `orz_live_${randomBytes(16).toString('hex')}`;
    const entregue = segredo();
    let recebido: any = null;
    troca = (corpo) => {
      recebido = corpo;
      return { status: 200, corpo: { ligacao: entregue, prefixo: entregue.slice(0, 19), conta_id: 'c1', loja: 'merchant-1', permissoes: ['preco.escrever'] } };
    };
    const quem = { nome: 'Pessoa da distribuição', perfil: 'diretoria' };
    const r = await console_.registrar({ tenantId: l.t, unidadeId: l.lojas[0], chave }, quem);
    expect(recebido).toEqual({ chave_orzuni: chave });
    expect(JSON.stringify(r)).not.toContain(entregue);
    const [g] = await q(`select segredo_cifrado, loja_ifood, criada_por from orzuni_ligacao where id = $1`, [r.id]);
    expect(g.segredo_cifrado).toMatch(/^v1:/);
    expect(g.segredo_cifrado).not.toContain(entregue);
    expect([g.loja_ifood, g.criada_por]).toEqual(['merchant-1', 'Pessoa da distribuição']);
    const r2 = await console_.registrar({ tenantId: l.t, unidadeId: l.lojas[0], chave }, quem);
    expect(r2.trocouAnterior).toBe(true);
    const vivas = await q(`select id from orzuni_ligacao where unidade_id = $1 and revogada_em is null`, [l.lojas[0]]);
    expect(vivas.map((x: any) => x.id)).toEqual([r2.id]);

    const n = trocasFeitas;
    await expect(console_.registrar({ tenantId: l.t, unidadeId: l.lojas[1], chave: 'orz_live_curta' }, quem)).rejects.toThrow(/orz_live_/);
    expect(trocasFeitas).toBe(n);
    troca = () => ({ status: 401, corpo: { type: 'https://dev.dmstecnologias.com/erros/ligacao-invalida', status: 401 } });
    await expect(console_.registrar({ tenantId: l.t, unidadeId: l.lojas[1], chave }, quem)).rejects.toThrow(/recusou a chave/);
    expect(await q(`select 1 from orzuni_ligacao where unidade_id = $1`, [l.lojas[1]])).toHaveLength(0);
    // Loja de OUTRA empresa: recusa antes de chamar o Orzuni.
    const outra = await loja({ ligadas: 0 });
    await expect(console_.registrar({ tenantId: l.t, unidadeId: outra.lojas[0], chave }, quem)).rejects.toThrow(/Loja não encontrada/);
  });

  it('console: ligar o direito exige TODOS os servidores de loja na 1.30.13; desligar sempre pode; o painel mostra', async () => {
    const l = await loja({ direito: false });
    const eq = (
      await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'servidor_local', 'Servidor da loja', $3) returning id`, [
        l.t,
        l.lojas[0],
        `teste-${randomBytes(12).toString('hex')}`,
      ])
    )[0].id;
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao) values ($1, $2, $3, '1.30.12')`, [eq, l.t, l.lojas[0]]);
    const quem = { nome: 'Pessoa da distribuição', perfil: 'diretoria' };
    await expect(console_.liberacao({ tenantId: l.t, ligar: true }, quem)).rejects.toThrow(/1\.30\.12.*1\.30\.13/);
    await expect(console_.liberacao({ tenantId: l.t, ligar: 'sim' }, quem)).rejects.toThrow(/ligar/);
    await q(`update edge_status set versao = '1.30.13' where equipamento_id = $1`, [eq]);
    expect(await console_.liberacao({ tenantId: l.t, ligar: true }, quem)).toEqual({ tenantId: l.t, liberado: true });
    const painel: any = await console_.painel(l.t);
    expect(painel.liberado).toBe(true);
    expect(painel.servidores.map((s: any) => [s.nome, s.versao, s.pronto])).toEqual([['Servidor da loja', '1.30.13', true]]);
    expect(painel.lojas.filter((x: any) => x.ligacao).length).toBe(2);
    expect(JSON.stringify(painel)).not.toMatch(/dms_lg_orzuni_[A-Za-z0-9_-]{16,}|v1:/);
    expect(await console_.liberacao({ tenantId: l.t, ligar: false }, quem)).toEqual({ tenantId: l.t, liberado: false });
  });
});
