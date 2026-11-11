import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { cifrar } from '../../common/cifra-segredo';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { idPausaDoCanal } from '../../common/id-deterministico';
import { Food99Service } from '../integracoes/food99/food99.service';
import { OrzuniPausaService } from '../orzuni/orzuni-pausa.service';
import { PausaDoCanalService } from './pausa-do-canal.service';
import { PausaNosCanaisService } from './pausa-nos-canais.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PAUSA NO iFOOD E NA 99 (F5 da pausa por canal) contra o Postgres real, com a 99, o DMS ID e a porta do Orzuni DE
// MENTIRA (nada sai para fora): o gestor pausa no painel → a rotina da nuvem leva ao canal e anota o resultado na linha.
// A 99 recebe o CORPO do exemplo da doc 1949 ("Business Pause" / "Set Store Online"); o iFood, `interrupcao_criar` e
// `interrupcao_remover` no formato do contrato 1.1.0 do Orzuni (o `structuredContent` com `interrupcao_id`; a recusa
// `interrupcao_sobreposta` com `interrupcao`). A 370/371 são só da nuvem (o banco do CI é de loja — ERR-329), com a trava
// da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pausa-nos-canais-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

const MIG = (arq: string) => join(__dirname, '..', '..', '..', '..', 'database', 'migrations', arq);
const MCP = 'https://orzuni.exemplo.test/v1/mcp';
const ENV = {
  ORZUNI_LIGADO: 'true',
  ORZUNI_MCP_URL: MCP,
  DMS_ID_EMISSOR: 'https://id.exemplo.test/oidc',
  HUB_APLICATIVO: 'app-regem-teste',
  HUB_SEGREDO: 'segredo-de-teste-1234567',
  FOOD99_APP_ID: 'app-99-teste',
  FOOD99_APP_SECRET: 'segredo-99-teste',
};
const SET_STATUS = 'https://openapi.99food.com/v1/shop/shop/setStatus';

descrever('a pausa no iFood e na 99 (Postgres + canais de mentira)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as any;
  const food99 = new Food99Service(db, {} as any);
  const orzuni = new OrzuniPausaService(db);
  const nosCanais = new PausaNosCanaisService(db, food99, orzuni, auditoria);
  const pausas = new PausaDoCanalService(db, auditoria, nosCanais);
  // A rotina é chamada pelo teste (o "acordar" de verdade correria junto, em segundo plano): conta quantas vezes o painel acordou.
  let acordou = 0;
  nosCanais.acordar = async () => void acordou++;
  const empresas: string[] = [];
  const envAntes: Record<string, string | undefined> = {};
  const fetchAntes = global.fetch;

  // ── a 99 de mentira (o fetch global: o endereço da 99 é fixado quando o módulo carrega) ──────────────────────────
  let corpos99: any[] = [];
  let resposta99: (corpo: any) => any = () => ({ errno: 0, errmsg: 'ok', data: {} });
  // ── o DMS ID e a porta do Orzuni de mentira (o `buscar` do serviço) ──────────────────────────────────────────────
  type Chamada = { ferramenta: string; args: any; ligacao: string | null };
  let chamadas: Chamada[] = [];
  let escopos: string[] = [];
  let responder: (c: Chamada) => { result?: any; antes?: () => Promise<void>; erroRpc?: { code: number; message: string } } = (c) => ok(c);
  const json = (status: number, corpo: any) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
  let seq = 0;
  /** A resposta de sucesso do Orzuni (o `ResultadoEscrita` com os `dados` no nível de cima do envelope). */
  function ok(c: Chamada) {
    const s =
      c.ferramenta === 'interrupcao_criar'
        ? { situacao: 'aplicado', repetido: false, interrupcao_id: `int-${++seq}`, inicio: c.args.inicio, fim: c.args.fim, descricao: c.args.descricao }
        : { situacao: 'aplicado', repetido: false, interrupcao_id: c.args.interrupcao_id, removida: true };
    return { result: { content: [{ type: 'text', text: 'feito' }], structuredContent: s } };
  }
  const recusa = (frase: string, estruturado: any) => ({ result: { isError: true, content: [{ type: 'text', text: frase }], structuredContent: estruturado } });
  orzuni.buscar = (async (url: any, init: any) => {
    const u = String(url);
    if (u === `${ENV.DMS_ID_EMISSOR}/token`) {
      escopos.push(new URLSearchParams(String(init?.body ?? '')).get('scope') ?? '');
      return json(200, { access_token: 'token-de-teste', expires_in: 3600 });
    }
    if (u === MCP) {
      const corpo = JSON.parse(String(init?.body ?? '{}'));
      const c: Chamada = { ferramenta: corpo.params?.name, args: corpo.params?.arguments, ligacao: new Headers(init?.headers ?? {}).get('dms-ligacao') };
      chamadas.push(c);
      const r = responder(c);
      if (r.antes) await r.antes();
      if (r.erroRpc) return json(200, { jsonrpc: '2.0', id: corpo.id, error: r.erroRpc });
      return json(200, { jsonrpc: '2.0', id: corpo.id, result: r.result });
    }
    throw new Error(`endereço inesperado no teste: ${u}`);
  }) as typeof fetch;

  beforeAll(async () => {
    for (const k of [...Object.keys(ENV), 'SEGREDOS_CHAVE', 'EDGE_MODE', 'CLOUD_API', 'SYNC_TOKEN']) envAntes[k] = process.env[k];
    Object.assign(process.env, ENV);
    delete process.env.EDGE_MODE;
    if (!process.env.SEGREDOS_CHAVE) process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    for (const m of ['370_orzuni_envio.sql', '371_orzuni_ocultar_pausa.sql', '399_onde_vende_sem_ocultar_no_ifood.sql', '400_orzuni_nome_descricao_codigo.sql', '403_opcao_pausa_por_canal.sql', '406_ligar_produto_ao_app.sql']) {
      const texto = readFileSync(MIG(m), 'utf8');
      await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(texto)));
    }
    global.fetch = (async (url: any, init: any) => {
      if (String(url) === SET_STATUS) {
        const corpo = JSON.parse(String(init?.body ?? '{}'));
        corpos99.push(corpo);
        return json(200, resposta99(corpo));
      }
      throw new Error(`endereço inesperado no teste: ${String(url)}`);
    }) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = fetchAntes;
    for (const [k, v] of Object.entries(envAntes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) {
      for (const t of ['pausa_canal', 'orzuni_envio', 'orzuni_ligacao', 'integracao', 'entitlement', 'cardapio_config', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  beforeEach(() => {
    registros.length = 0;
    corpos99 = [];
    chamadas = [];
    escopos = [];
    acordou = 0;
    resposta99 = () => ({ errno: 0, errmsg: 'ok', data: {} });
    responder = (c) => ok(c);
    delete process.env.EDGE_MODE;
  });

  /** Uma empresa com cardápio; a 99 (da empresa toda) e o iFood pelo Orzuni (ligação da 1ª loja) quando pedidos. */
  async function loja(o: { com99?: boolean; comIfood?: boolean; lojas?: number; direito?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste pausa no iFood e na 99') returning id`))[0].id as string;
    empresas.push(t);
    const lojas: string[] = [];
    for (let i = 0; i < (o.lojas ?? 1); i++) lojas.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto) values ($1, null, $2, true, true)`, [t, `tk-${randomUUID()}`]);
    if (o.com99)
      await q(
        `insert into integracao (tenant_id, unidade_id, canal, ativo, merchant_id, token, config)
         values ($1, null, '99food', true, $2, 'tk99-da-loja', $3::jsonb)`,
        [t, `shop-${randomUUID().slice(0, 8)}`, JSON.stringify({ tokenExp: Date.now() + 3600_000 })],
      );
    const segredo = `dms_lg_orzuni_${randomBytes(18).toString('base64url')}`;
    if (o.comIfood) {
      if (o.direito !== false)
        await q(
          `insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1::text || 'ifood_pelo_orzuni')::uuid, $1::uuid, 'ifood_pelo_orzuni', true)`,
          [t],
        );
      await q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo) values ($1, $2, $3, 'dms_lg_orzuni_teste')`, [t, lojas[0], cifrar(segredo)]);
    }
    const gestor: any = { tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente', nome: 'Rodrigo' };
    return { t, lojas, segredo, gestor };
  }
  const linha = async (t: string, canal: string) =>
    (await q(`select ate, externo_situacao, externo_id, externo_erro, updated_at from pausa_canal where tenant_id = $1 and canal = $2`, [t, canal]))[0];
  const rodar = (t: string) => nosCanais.processar({ tenantIds: [t] });
  /** A volta da rotina daqui a `min` minutos (o `updated_at` é do gatilho de carimbo: não se volta no tempo pela linha). */
  const rodarDepois = (t: string, min: number) => nosCanais.processar({ tenantIds: [t], agora: new Date(Date.now() + min * 60_000) });
  const canalNoEstado = async (t: string, canal: string, unidade: string | null = null) => (await pausas.estado(t, unidade)).canais.find((c) => c.canal === canal)!;

  // ───────────────────────── a 99 ─────────────────────────

  it('a 99: disponível com a integração; pausar manda o corpo da doc (store_status 3, pause_time, código do motivo); reabrir manda store_status 1', async () => {
    const { t, gestor } = await loja({ com99: true });
    expect(await canalNoEstado(t, 'food99')).toMatchObject({ disponivel: true, pausa: null });
    expect((await pausas.estado(t, null)).temposDa99).toEqual([10, 20, 30]);
    const depois = await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'cozinha', tempo99: { minutos: 10 } });
    expect(acordou).toBe(1); // o painel acordou a rotina
    const p = depois.canais.find((c) => c.canal === 'food99')!.pausa!;
    expect(p.externo).toEqual({ situacao: 'pausando', erro: null });
    expect(new Date(p.ate).getTime() - Date.now()).toBeGreaterThan(9.5 * 60_000);
    expect(registros.find((r) => r.acao === 'pausou_canal')?.detalhe).toMatchObject({ canal: 'food99', tempo: '10 min' });

    expect(await rodar(t)).toBe(1);
    // o exemplo "Business Pause" da doc 1949: auth_token, store_status 3, pause_reason_code, pause_time
    expect(corpos99).toEqual([{ auth_token: 'tk99-da-loja', store_status: 3, pause_reason_code: 1001, pause_time: 1 }]);
    expect(await linha(t, 'food99')).toMatchObject({ externo_situacao: 'aplicada', externo_id: 'pause_time:1', externo_erro: null });
    expect((await canalNoEstado(t, 'food99')).pausa!.externo).toEqual({ situacao: 'aplicada', erro: null });
    expect(registros.map((r) => r.acao)).toContain('pausou_no_canal');
    // nada mais a fazer: a volta seguinte não chama a 99
    expect(await rodar(t)).toBe(0);

    await pausas.reabrir(gestor, null, 'food99');
    expect(acordou).toBe(2);
    expect(await rodar(t)).toBe(1);
    expect(corpos99[1]).toEqual({ auth_token: 'tk99-da-loja', store_status: 1 }); // "Set Store Online"
    expect(await linha(t, 'food99')).toMatchObject({ ate: null, externo_situacao: 'reaberta', externo_id: null });
    expect(registros.map((r) => r.acao)).toContain('reabriu_no_canal');
  });

  it('a 99 só reabre o que o Regem pausou: pausa que nunca chegou lá e foi reaberta não manda store_status 1', async () => {
    const { t, gestor } = await loja({ com99: true });
    await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'pedidos', tempo99: { minutos: 20 } });
    await pausas.reabrir(gestor, null, 'food99');
    expect(await rodar(t)).toBe(1);
    expect(corpos99).toEqual([]);
    expect(await linha(t, 'food99')).toMatchObject({ externo_situacao: 'reaberta', externo_id: null });
  });

  it('a 99: falha passageira repete depois de 1 min (sem martelar); loja fechada no app (56101) vira erro com a frase; o tempo acabado reabre', async () => {
    const { t, gestor } = await loja({ com99: true });
    resposta99 = () => ({ errno: 10001, errmsg: 'System error' });
    await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'pedidos', tempo99: { minutos: 30 } });
    await rodar(t);
    expect(await linha(t, 'food99')).toMatchObject({ externo_situacao: null, externo_erro: 'A 99 não respondeu agora — o Regem tenta de novo.' });
    expect((await canalNoEstado(t, 'food99')).pausa!.externo).toEqual({ situacao: 'pausando', erro: 'A 99 não respondeu agora — o Regem tenta de novo.' });
    expect(await rodar(t)).toBe(0); // dentro do minuto de espera
    expect(corpos99).toHaveLength(1);
    resposta99 = () => ({ errno: 56101, errmsg: 'Incorrect store status' });
    await rodarDepois(t, 2);
    expect(corpos99).toHaveLength(2);
    expect(await linha(t, 'food99')).toMatchObject({
      externo_situacao: 'erro',
      externo_erro: 'A 99 não aceitou: a loja está FECHADA no app da 99 — abra a loja lá e pause de novo.',
    });
    expect(await rodar(t)).toBe(0); // erro de vez: não repete sozinho
    // pausar de novo tenta outra vez; o tempo acabado (pausada lá) reabre na 99
    resposta99 = () => ({ errno: 0, errmsg: 'ok', data: {} });
    await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'pedidos', tempo99: { minutos: 10 } });
    await rodar(t);
    expect(await linha(t, 'food99')).toMatchObject({ externo_situacao: 'aplicada', externo_id: 'pause_time:1' });
    await q(`update pausa_canal set ate = now() - interval '1 second' where tenant_id = $1`, [t]);
    await rodar(t);
    expect(corpos99[corpos99.length - 1]).toEqual({ auth_token: 'tk99-da-loja', store_status: 1 });
    expect(await linha(t, 'food99')).toMatchObject({ externo_situacao: 'reaberta', externo_id: null });
  });

  it('a 99: estender usa o tempo dela mais perto do fim pedido e leva de novo; até o fim do dia não estende', async () => {
    const { t, gestor } = await loja({ com99: true });
    await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'pedidos', tempo99: { minutos: 10 } });
    await rodar(t);
    // faltam ~10 min + 10 = ~20 → 20 min a partir de agora
    const est = await pausas.estender(gestor, null, 'food99', 10);
    const p = est.canais.find((c) => c.canal === 'food99')!.pausa!;
    expect(Math.round((new Date(p.ate).getTime() - Date.now()) / 60_000)).toBe(20);
    expect(p.externo!.situacao).toBe('pausando');
    await rodar(t);
    expect(corpos99[1]).toMatchObject({ store_status: 3, pause_time: 2 });
    expect(registros.find((r) => r.acao === 'estendeu_canal')?.detalhe).toMatchObject({ canal: 'food99', minutos: 10 });
    // faltando 3 min, +10 = 13 → o tempo da 99 mais perto é 10 (pela regra do cardápio seriam 13, que a 99 não aceita)
    await q(`update pausa_canal set ate = now() + interval '3 minutes' where tenant_id = $1 and canal = 'food99'`, [t]);
    const est2 = await pausas.estender(gestor, null, 'food99', 10);
    expect(Math.round((new Date(est2.canais.find((c) => c.canal === 'food99')!.pausa!.ate).getTime() - Date.now()) / 60_000)).toBe(10);
    await pausas.pausar(gestor, null, { canais: ['food99'], motivo: 'fechando', tempo99: { fimDoDia: true } }).catch((e) => {
      // perto da meia-noite não há "fim do dia": o teste não depende da hora
      expect(String(e.message)).toMatch(/fim do dia/);
    });
    const r = await linha(t, 'food99');
    if (new Date(r.ate).getTime() - Date.now() > 35 * 60_000) {
      await rodar(t);
      expect(corpos99[corpos99.length - 1]).toMatchObject({ store_status: 3, pause_time: 4, pause_reason_code: 1004 });
      await expect(pausas.estender(gestor, null, 'food99', 10)).rejects.toThrow('A 99 já está pausada até o fim do dia.');
    }
  });

  // ───────────────────────── o iFood (pelo Orzuni) ─────────────────────────

  it('iFood: disponível só com a ligação viva da loja, o direito e o ORZUNI_LIGADO; com várias lojas, pede a loja', async () => {
    const semDireito = await loja({ comIfood: true, direito: false });
    expect(await canalNoEstado(semDireito.t, 'ifood')).toMatchObject({ disponivel: false });
    const { t, lojas } = await loja({ comIfood: true, lojas: 2 });
    expect(await canalNoEstado(t, 'ifood')).toMatchObject({ disponivel: true }); // a única ligada
    expect(await canalNoEstado(t, 'ifood', lojas[0])).toMatchObject({ disponivel: true });
    expect(await canalNoEstado(t, 'ifood', lojas[1])).toMatchObject({ disponivel: false });
    await q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo) values ($1, $2, $3, 'dms_lg_orzuni_teste')`, [t, lojas[1], cifrar('dms_lg_orzuni_outra')]);
    expect(await canalNoEstado(t, 'ifood')).toMatchObject({ disponivel: false, motivo: 'Escolha a loja no topo da tela para pausar o iFood dela.' });
    process.env.ORZUNI_LIGADO = 'false';
    try {
      expect(await canalNoEstado(t, 'ifood', lojas[0])).toMatchObject({ disponivel: false });
    } finally {
      process.env.ORZUNI_LIGADO = 'true';
    }
  });

  it('iFood: pausar cria a pausa (início agora, fim = a volta, descrição "(pelo Regem)") com a ligação da loja e as permissões da pausa; estender remove e cria; reabrir remove', async () => {
    const { t, lojas, segredo, gestor } = await loja({ comIfood: true });
    await pausas.pausar(gestor, null, { canais: ['cardapio', 'ifood'], motivo: 'entregador', tempo: { minutos: 30 } });
    const ate = new Date((await linha(t, 'ifood')).ate);
    expect(await rodar(t)).toBe(1);
    expect(chamadas).toHaveLength(1);
    const c = chamadas[0];
    expect(c.ferramenta).toBe('interrupcao_criar');
    expect(c.ligacao).toBe(segredo);
    expect(c.args).toMatchObject({ fim: ate.toISOString(), descricao: 'Estamos sem entregador no momento (pelo Regem)' });
    expect(Math.abs(Date.parse(c.args.inicio) - Date.now())).toBeLessThan(10_000);
    expect(c.args.chaveIdempotencia).toMatch(/^dms_[0-9a-f]{48}$/);
    expect(escopos).toEqual(['loja.ler loja.escrever']); // as permissões da pausa, não as do preço
    expect(await linha(t, 'ifood')).toMatchObject({ externo_situacao: 'aplicada', externo_id: 'int-1' });
    // a pausa do iFood fica na loja da ligação
    expect((await q(`select unidade_id from pausa_canal where tenant_id = $1 and canal = 'ifood'`, [t]))[0].unidade_id).toBe(lojas[0]);
    expect((await q(`select id from pausa_canal where tenant_id = $1 and canal = 'ifood'`, [t]))[0].id).toBe(idPausaDoCanal(t, lojas[0], 'ifood'));

    await pausas.estender(gestor, null, 'ifood', 10);
    await rodar(t);
    expect(chamadas.slice(1).map((x) => [x.ferramenta, x.args.interrupcao_id ?? x.args.fim])).toEqual([
      ['interrupcao_remover', 'int-1'],
      ['interrupcao_criar', new Date((await linha(t, 'ifood')).ate).toISOString()],
    ]);
    expect(await linha(t, 'ifood')).toMatchObject({ externo_situacao: 'aplicada', externo_id: 'int-2' });

    await pausas.reabrir(gestor, null, 'ifood');
    await rodar(t);
    expect(chamadas[3]).toMatchObject({ ferramenta: 'interrupcao_remover', args: { interrupcao_id: 'int-2' } });
    expect(await linha(t, 'ifood')).toMatchObject({ externo_situacao: 'reaberta', externo_id: null });
    // o cardápio digital não vai a canal nenhum
    expect(chamadas).toHaveLength(4);

    // pausar de NOVO com a pausa lá (troca o motivo e o fim): a velha sai antes da nova — senão o iFood recusaria a sobreposta
    await pausas.pausar(gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 15 } });
    await rodar(t);
    const primeira = (await linha(t, 'ifood')).externo_id;
    await pausas.pausar(gestor, null, { canais: ['ifood'], motivo: 'cozinha', tempo: { minutos: 60 } });
    await rodar(t);
    expect(chamadas.slice(-2).map((x) => [x.ferramenta, x.args.interrupcao_id ?? x.args.descricao])).toEqual([
      ['interrupcao_remover', primeira],
      ['interrupcao_criar', 'Estamos com um problema na cozinha (pelo Regem)'],
    ]);
  });

  it('iFood: a sobreposta DO REGEM com o mesmo fim é adotada; com outro fim sai e entra a nova; a de FORA do Regem vira erro "reabra no Gestor"', async () => {
    const { t, gestor } = await loja({ comIfood: true });
    await pausas.pausar(gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } });
    const ate = new Date((await linha(t, 'ifood')).ate).toISOString();
    responder = (c) =>
      c.ferramenta === 'interrupcao_criar'
        ? recusa('Já existe uma pausa que cobre parte desse período no iFood.', {
            situacao: 'recusado', repetido: false, codigo: 'interrupcao_sobreposta', pode_repetir: false,
            interrupcao: { id: 'int-nossa', inicio: c.args.inicio, fim: ate, descricao: 'Estamos com muitos pedidos agora (pelo Regem)' },
          })
        : ok(c);
    await rodar(t);
    expect(await linha(t, 'ifood')).toMatchObject({ externo_situacao: 'aplicada', externo_id: 'int-nossa' });
    expect(chamadas.map((c) => c.ferramenta)).toEqual(['interrupcao_criar']);

    // nossa, com OUTRO fim (uma pausa antiga do Regem): sai e entra a nova, com outra chave
    const b = await loja({ comIfood: true });
    await pausas.pausar(b.gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } });
    chamadas = [];
    let primeira = true;
    responder = (c) => {
      if (c.ferramenta === 'interrupcao_criar' && primeira) {
        primeira = false;
        return recusa('sobreposta', {
          situacao: 'recusado', codigo: 'interrupcao_sobreposta', pode_repetir: false,
          interrupcao: { id: 'int-antiga', inicio: c.args.inicio, fim: new Date(Date.now() + 5 * 3600_000).toISOString(), descricao: 'Perto de fechar (pelo Regem)' },
        });
      }
      return ok(c);
    };
    await rodar(b.t);
    expect(chamadas.map((c) => [c.ferramenta, c.args.interrupcao_id ?? null])).toEqual([
      ['interrupcao_criar', null],
      ['interrupcao_remover', 'int-antiga'],
      ['interrupcao_criar', null],
    ]);
    expect(chamadas[2].args.chaveIdempotencia).not.toBe(chamadas[0].args.chaveIdempotencia);
    expect((await linha(b.t, 'ifood')).externo_situacao).toBe('aplicada');

    // de FORA do Regem (feita no Gestor): não se toca
    const c3 = await loja({ comIfood: true });
    await pausas.pausar(c3.gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } });
    chamadas = [];
    responder = (c) =>
      recusa('sobreposta', {
        situacao: 'recusado', codigo: 'interrupcao_sobreposta', pode_repetir: false,
        interrupcao: { id: 'int-do-gestor', inicio: c.args.inicio, fim: new Date(Date.now() + 2 * 3600_000).toISOString(), descricao: 'Pausa' },
      });
    await rodar(c3.t);
    expect(chamadas.map((c) => c.ferramenta)).toEqual(['interrupcao_criar']);
    const l3 = await linha(c3.t, 'ifood');
    expect(l3.externo_situacao).toBe('erro');
    expect(l3.externo_erro).toMatch(/^O iFood já tem uma pausa feita fora do Regem até .+ — reabra no Gestor de Pedidos e pause de novo\.$/);
  });

  it('iFood: sem loja.escrever (ferramenta "não encontrada") = erro de permissão; recém-criada repete; a pausa que mudou no meio não grava a situação', async () => {
    const { t, gestor } = await loja({ comIfood: true });
    await pausas.pausar(gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 15 } });
    responder = () => ({ erroRpc: { code: -32602, message: 'Tool interrupcao_criar not found' } });
    await rodar(t);
    expect(await linha(t, 'ifood')).toMatchObject({
      externo_situacao: 'erro',
      externo_erro: 'A chave da loja no Orzuni não tem a permissão de pausar a loja (loja.escrever).',
    });

    // recém-criada (ao remover para estender): repete
    responder = (c) => ok(c);
    await pausas.pausar(gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 15 } });
    await rodar(t);
    expect((await linha(t, 'ifood')).externo_id).toMatch(/^int-/);
    responder = (c) =>
      c.ferramenta === 'interrupcao_remover'
        ? recusa('A pausa foi criada há pouco — aguarde alguns instantes para removê-la.', { situacao: 'recusado', codigo: 'interrupcao_recem_criada', pode_repetir: true })
        : ok(c);
    await pausas.estender(gestor, null, 'ifood', 10);
    await rodar(t);
    const l = await linha(t, 'ifood');
    expect(l).toMatchObject({ externo_situacao: null, externo_erro: 'A pausa foi criada há pouco — aguarde alguns instantes para removê-la.' });
    expect(l.externo_id).toMatch(/^int-/); // a pausa velha continua lá, e vai sair na próxima

    // a remoção recusada DE VEZ deixa a pausa velha lá ('erro', com o id): reabrir volta a "a fazer" e a rotina a remove
    {
      const b = await loja({ comIfood: true });
      await pausas.pausar(b.gestor, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } });
      responder = (c) => ok(c);
      await rodar(b.t);
      const velha = (await linha(b.t, 'ifood')).externo_id;
      responder = (c) =>
        c.ferramenta === 'interrupcao_remover' ? recusa('O iFood recusou.', { situacao: 'recusado', codigo: 'erro_qualquer', pode_repetir: false }) : ok(c);
      await pausas.estender(b.gestor, null, 'ifood', 10);
      await rodar(b.t);
      expect(await linha(b.t, 'ifood')).toMatchObject({ externo_situacao: 'erro', externo_id: velha });
      responder = (c) => ok(c);
      chamadas = [];
      await pausas.reabrir(b.gestor, null, 'ifood');
      await rodar(b.t);
      expect(chamadas.map((c) => [c.ferramenta, c.args.interrupcao_id])).toEqual([['interrupcao_remover', velha]]);
      expect(await linha(b.t, 'ifood')).toMatchObject({ externo_situacao: 'reaberta', externo_id: null });
      responder = (c) => ok(c);
    }

    // a pausa muda ENQUANTO a chamada sai: o id do canal fica, a situação não — a volta seguinte remove e cria de novo
    expect(await rodar(t)).toBe(0); // a recusa passageira espera 1 min
    chamadas = [];
    responder = (c) => ({
      ...ok(c),
      antes: c.ferramenta === 'interrupcao_criar' ? () => pausas.estender(gestor, null, 'ifood', 10).then(() => undefined) : undefined,
    });
    await rodarDepois(t, 2);
    const meio = await linha(t, 'ifood');
    expect(meio.externo_situacao).toBeNull();
    const criado = meio.externo_id;
    expect(criado).toMatch(/^int-/);
    responder = (c) => ok(c);
    await rodar(t);
    expect(chamadas.slice(-2).map((c) => [c.ferramenta, c.args.interrupcao_id ?? null])).toEqual([
      ['interrupcao_remover', criado],
      ['interrupcao_criar', null],
    ]);
    expect(chamadas[chamadas.length - 1].args.fim).toBe(new Date((await linha(t, 'ifood')).ate).toISOString());
    expect((await linha(t, 'ifood')).externo_situacao).toBe('aplicada');
  });

  // ───────────────────────── a rota da loja e o servidor da loja ─────────────────────────

  it('a rota da loja: a empresa vem do token; a loja pedida só vale se for da empresa', async () => {
    const a = await loja({ comIfood: true, lojas: 2 });
    const b = await loja({ comIfood: true });
    const daOutra = await nosCanais.canaisExternosParaALoja(a.t, b.lojas[0], null);
    expect(daOutra.tenantId).toBe(a.t);
    expect(daOutra.ifood).toMatchObject({ disponivel: true, unidadeId: a.lojas[0] }); // a loja de fora foi ignorada
    expect((await nosCanais.canaisExternosParaALoja(a.t, a.lojas[1], null)).ifood).toMatchObject({ disponivel: false });
    expect((await nosCanais.canaisExternosParaALoja(a.t, 'nao-e-uuid', a.lojas[0])).ifood).toMatchObject({ disponivel: true, unidadeId: a.lojas[0] });
  });

  it('servidor da loja: pergunta à nuvem com o token e guarda 1 min; sem a nuvem, os dois indisponíveis com "sem conexão"; a rotina não roda', async () => {
    const { t, lojas, gestor } = await loja();
    process.env.EDGE_MODE = 'true';
    process.env.CLOUD_API = 'https://nuvem.exemplo.test/api/v1';
    process.env.SYNC_TOKEN = 'token-do-servidor';
    try {
      const naLoja = new PausaDoCanalService(db, auditoria, nosCanais);
      const pedidos: Array<{ url: string; token: string | null }> = [];
      naLoja.buscar = (async (url: any, init: any) => {
        pedidos.push({ url: String(url), token: new Headers(init?.headers ?? {}).get('x-sync-token') });
        return json(200, { tenantId: t, ifood: { disponivel: true, unidadeId: lojas[0], motivo: null }, food99: { disponivel: false, unidadeId: null, motivo: null } });
      }) as typeof fetch;
      const e1 = await naLoja.estado(t, lojas[0]);
      expect(e1.canais.map((c) => [c.canal, c.disponivel])).toEqual([
        ['cardapio', true],
        ['ifood', true],
        ['food99', false],
      ]);
      expect(pedidos).toEqual([{ url: `https://nuvem.exemplo.test/api/v1/delivery/pausas/canais/loja?unidade=${lojas[0]}`, token: 'token-do-servidor' }]);
      await naLoja.estado(t, lojas[0]);
      expect(pedidos).toHaveLength(1); // guardado
      // pausar o iFood no servidor da loja grava a linha (o sync leva à nuvem); a rotina não roda aqui
      await naLoja.pausar(gestor, lojas[0], { canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 15 } });
      expect(acordou).toBe(0);
      expect(await nosCanais.processar({ tenantIds: [t] })).toBe(0);
      expect((await linha(t, 'ifood')).externo_situacao).toBeNull();
      // outra empresa na resposta (servidor reaproveitado): nada de ninguém
      const outra = new PausaDoCanalService(db, auditoria, nosCanais);
      outra.buscar = (async () => json(200, { tenantId: randomUUID(), ifood: { disponivel: true, unidadeId: lojas[0] } })) as typeof fetch;
      expect((await outra.estado(t, lojas[0])).canais.find((c) => c.canal === 'ifood')!.disponivel).toBe(false);
      // sem a nuvem: "sem conexão", não "não tem"
      const semNuvem = new PausaDoCanalService(db, auditoria, nosCanais);
      semNuvem.buscar = (async () => {
        throw new Error('rede caiu');
      }) as typeof fetch;
      const e3 = await semNuvem.estado(t, lojas[0]);
      expect(e3.canais.find((c) => c.canal === 'ifood')).toMatchObject({
        disponivel: false,
        motivo: 'Sem conexão com a nuvem agora: o iFood e a 99 só pausam pelo Regem com internet.',
      });
    } finally {
      delete process.env.EDGE_MODE;
    }
  });
});
