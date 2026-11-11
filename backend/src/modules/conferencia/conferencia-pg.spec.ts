import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { MODULO_CONFERIR_APPS } from '../../common/conferir-apps';
import { MODULO_PRECOS_NA_99 } from '../../common/precos-na-99';
import { Food99Service } from '../integracoes/food99/food99.service';
import { ConferirAppsService } from '../distribuicao/conferir-apps.service';
import { ConferenciaService } from './conferencia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Conferir com os apps" (R3 F4a; mig 405) no Postgres de verdade, com o Orzuni e a 99 falsos: a leitura guardada (ao
// abrir, no máximo uma automática por dia, o "Ler agora"), a vez de ler (duas telas juntas = uma leitura), a falha, as
// ações (usar o preço do app em massa e numa query, mandar o do Regem à fila do app, tirar o "Está no", ignorar e desfazer)
// e o servidor da loja pedindo à nuvem.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('conferencia-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

const MIG = (n: string) => join(__dirname, '..', '..', '..', '..', 'database', 'migrations', n);
// Só nuvem (o banco do CI é de loja): a fila do iFood (370 → 400, na ordem da nuvem), a da 99 (402, 404) e a 405.
const SO_NUVEM = [
  '370_orzuni_envio.sql',
  '371_orzuni_ocultar_pausa.sql',
  '399_onde_vende_sem_ocultar_no_ifood.sql',
  '400_orzuni_nome_descricao_codigo.sql',
  '402_food99_envio.sql',
  '404_food99_envio_opcao.sql',
];

descrever('Conferir com os apps (Postgres real, Orzuni e 99 falsos)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const empresas: string[] = [];

  // ── o Orzuni falso (a leitura do iFood) ───────────────────────────────────────────────────────────────────────
  let cardapioIfood: any = { itens: [] };
  let complementosIfood: any = { grupos: [] };
  let falhaIfood: string | null = null;
  let esperarIfood: Promise<void> | null = null;
  let leiturasIfood = 0;
  const semLigacao = new Set<string>();
  const orzuni = {
    disponivel: async (_t: string, u: string) => (semLigacao.has(u) ? { ok: false, motivo: 'Esta loja não está ligada ao Orzuni.' } : { ok: true }),
    lerCardapio: async () => {
      leiturasIfood++;
      if (esperarIfood) await esperarIfood;
      if (falhaIfood) return { ok: false, repetir: true, erro: falhaIfood };
      return { ok: true, cardapio: JSON.parse(JSON.stringify(cardapioIfood)), complementos: JSON.parse(JSON.stringify(complementosIfood)) };
    },
  };
  // ── a 99 falsa ────────────────────────────────────────────────────────────────────────────────────────────────
  const food99 = new Food99Service(db, null as any);
  let cardapio99: any = { items: [] };
  let leituras99 = 0;
  food99.cardapioDaLoja = (async () => {
    leituras99++;
    return { errno: 0, errmsg: 'ok', data: JSON.parse(JSON.stringify(cardapio99)) };
  }) as any;

  const svc = new ConferenciaService(db, auditoria, orzuni as any, food99);
  const gestor = { id: null as string | null, perfil: 'gerente' };

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    for (const m of SO_NUVEM) await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG(m), 'utf8'))));
    const r = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG('405_conferencia_com_os_apps.sql'), 'utf8'))))) as unknown as any[];
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    if (conferencia.length !== 4 || conferencia.some((l: any) => l.ok !== true)) throw new Error(`conferência da 405: ${JSON.stringify(conferencia)}`);
    // 406 (R3 F4b): a guarda dos gatilhos do produto ao ligar — a conferência tem de vir toda `ok`.
    const r406 = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG('406_ligar_produto_ao_app.sql'), 'utf8'))))) as unknown as any[];
    const conferencia406 = (Array.isArray(r406) ? r406[r406.length - 1] : r406).rows;
    if (conferencia406.length !== 2 || conferencia406.some((l: any) => l.ok !== true)) throw new Error(`conferência da 406: ${JSON.stringify(conferencia406)}`);
  });

  afterAll(async () => {
    if (empresas.length) {
      for (const t of [
        'conferencia_app_leitura',
        'conferencia_app_ignorado',
        'orzuni_envio',
        'orzuni_ligacao',
        'food99_envio',
        'produto',
        'opcao',
        'integracao',
        'entitlement',
        'colaborador',
        'funcao',
        'unidade',
      ])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    auditados.length = 0;
    leiturasIfood = 0;
    leituras99 = 0;
    falhaIfood = null;
    esperarIfood = null;
    semLigacao.clear();
    cardapioIfood = {
      itens: [
        { pdv: '2051', nome: 'X-Bacon', categoria: 'Burgers', preco: 39.9, promo: null, status: 'no_ar', ordem: 0 },
        { pdv: '2052', nome: 'X-Salada', categoria: 'Burgers', preco: 29.9, promo: null, status: 'no_ar', ordem: 1 },
        { pdv: '3000', nome: 'Combo do app', categoria: 'Combos', preco: 59.9, promo: null, status: 'no_ar', ordem: 2 },
      ],
    };
    complementosIfood = {
      grupos: [{ id: 'g1', nome: 'Adicionais', opcoes: [{ id: 'o1', nome: 'Bacon extra', preco: 7, status: 'AVAILABLE', pdv: 'A01' }], itens: [] }],
    };
    cardapio99 = {
      categories: [{ category_name: 'Burgers', app_item_ids: ['2051'] }],
      items: [
        { app_item_id: '2051', item_name: 'X-Bacon', price: 4490, status: 1, is_sold_separately: true },
        { app_item_id: 'A01', item_name: 'Bacon extra', price: 600, status: 1, is_sold_separately: false },
      ],
      modifier_groups: [{ app_modifier_group_id: 'mg1', modifier_group_name: 'Adicionais', app_mg_items: [{ app_item_id: 'A01', price: 650 }] }],
    };
  });

  // ── a empresa de teste ──────────────────────────────────────────────────────────────────────────────────────────
  async function empresa(o: { conferir?: boolean; lojas?: number; com99?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste conferir com os apps') returning id`))[0].id as string;
    empresas.push(t);
    const lojas: string[] = [];
    for (let i = 0; i < (o.lojas ?? 1); i++) lojas.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    const direitos = ['ifood_pelo_orzuni', MODULO_PRECOS_NA_99, ...(o.conferir === false ? [] : [MODULO_CONFERIR_APPS])];
    for (const m of direitos) await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || $2)::uuid, $1::uuid, $2, true)`, [t, m]);
    for (const u of lojas)
      await q(`insert into orzuni_ligacao (tenant_id, unidade_id, segredo_cifrado, prefixo) values ($1, $2, 'v1:falso', 'dms_lg_orzuni_x')`, [t, u]);
    if (o.com99 !== false)
      await q(
        `insert into integracao (tenant_id, unidade_id, canal, ativo, merchant_id, client_id, client_secret, token, config)
         values ($1, $2, '99food', true, 'shop-x', 'app', 'segredo', 'tk', '{}'::jsonb)`,
        [t, lojas[0]],
      );
    const produto = async (cols: Record<string, any>) => {
      const c = { tenant_id: t, preco_venda: 30, ...cols };
      const k = Object.keys(c);
      return (await q(`insert into produto (${k.join(',')}) values (${k.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(c)))[0].id as string;
    };
    const p = {
      xbacon: await produto({ nome: 'X-Bacon', codigo: '2051', preco_ifood: 39.9, no_ifood: true, preco_99: 44.9, na_99: true }),
      xsalada: await produto({ nome: 'X-Salada', codigo: '2052', preco_ifood: 32.9, no_ifood: true }),
      hotdog: await produto({ nome: 'Hot dog', codigo: '2080', preco_ifood: 19.9, no_ifood: true }),
    };
    const bacon = (await q(`insert into opcao (tenant_id, nome, codigo_pdv, preco_ifood, preco_99) values ($1, 'Bacon extra', 'A01', 6, 6) returning id`, [t]))[0].id as string;
    return { t, lojas, p, bacon };
  }
  const leitura = (t: string, canal = 'ifood') => q(`select * from conferencia_app_leitura where tenant_id = $1 and canal = $2`, [t, canal]).then((r) => r[0]);
  const envelhecer = (t: string, intervalo: string) => q(`update conferencia_app_leitura set lido_em = now() - $2::interval where tenant_id = $1`, [t, intervalo]);
  const situacoes = (linhas: any[]) => Object.fromEntries(linhas.map((l) => [l.nome, l.situacao]));

  it('desligada: 403; app inválido: 400; empresa com duas lojas sem escolher: 409 pedindo a loja', async () => {
    const off = await empresa({ conferir: false });
    await expect(svc.conferir(off.t, null, 'ifood', false)).rejects.toMatchObject({ status: 403 });
    expect(await svc.ligada(off.t)).toBe(false);
    const on = await empresa({ lojas: 2 });
    expect(await svc.ligada(on.t)).toBe(true);
    await expect(svc.conferir(on.t, null, 'keeta', false)).rejects.toMatchObject({ status: 400 });
    await expect(svc.conferir(on.t, null, 'ifood', false)).rejects.toMatchObject({ status: 409, response: { code: 'ESCOLHA_A_LOJA' } });
    await expect(svc.conferir(on.t, '00000000-0000-4000-8000-000000000000', 'ifood', false)).rejects.toMatchObject({ status: 404 });
    expect(leiturasIfood).toBe(0);
  });

  it('abrir lê o iFood UMA vez e guarda; abrir de novo não lê; "Ler agora" lê (salvo segundos depois); sozinha, depois de 24 h', async () => {
    const e = await empresa();
    const r = await svc.conferir(e.t, null, 'ifood', false);
    expect(leiturasIfood).toBe(1);
    expect(r).toMatchObject({ estado: 'ok', loja: { id: e.lojas[0], nome: 'Loja 1' }, lendoAgora: false, erro: null });
    expect(r.lidoEm).toEqual(expect.any(String));
    expect(situacoes(r.itens)).toEqual({ 'X-Bacon': 'igual', 'X-Salada': 'preco', 'Combo do app': 'soApp', 'Hot dog': 'soRegem' });
    expect(r.opcoes).toEqual([expect.objectContaining({ nome: 'Bacon extra', situacao: 'preco', precos: [7], regem: expect.objectContaining({ id: e.bacon, preco: 6 }) })]);
    // O botão de cada app: o iFood com 4 a resolver; a 99 ligada e ainda sem leitura (nunca lida por aqui).
    expect(r.canais).toEqual({ ifood: { ligado: true, motivo: null, pendentes: 4 }, '99food': { ligado: true, motivo: null, pendentes: null } });
    expect(leituras99).toBe(0);
    // A leitura guardada: o cardápio do app no formato do Regem.
    const g = await leitura(e.t);
    expect(g.itens).toHaveLength(3);
    expect(g.lendo_desde).toBeNull();

    await svc.conferir(e.t, null, 'ifood', false);
    await svc.conferir(e.t, null, 'ifood', true); // "Ler agora" logo depois: devolve a que acabou de chegar
    expect(leiturasIfood).toBe(1);
    await envelhecer(e.t, '1 minute');
    await svc.conferir(e.t, null, 'ifood', true);
    expect(leiturasIfood).toBe(2);
    await envelhecer(e.t, '23 hours');
    await svc.conferir(e.t, null, 'ifood', false);
    expect(leiturasIfood).toBe(2);
    await envelhecer(e.t, '25 hours');
    await svc.conferir(e.t, null, 'ifood', false);
    expect(leiturasIfood).toBe(3);
  });

  it('duas telas juntas fazem UMA leitura: a outra recebe "lendo" (sem leitura anterior) ou a anterior com "lendo agora"', async () => {
    const e = await empresa();
    let soltar!: () => void;
    esperarIfood = new Promise<void>((ok) => (soltar = ok));
    const a = svc.conferir(e.t, null, 'ifood', false);
    await new Promise((ok) => setTimeout(ok, 300));
    const b = await svc.conferir(e.t, null, 'ifood', false);
    expect(b).toMatchObject({ estado: 'lendo', lendoAgora: true, itens: [] });
    soltar();
    expect((await a).estado).toBe('ok');
    expect(leiturasIfood).toBe(1);
    // Com leitura anterior: a segunda tela vê a lista de antes, com o aviso.
    await envelhecer(e.t, '2 minutes');
    esperarIfood = new Promise<void>((ok) => (soltar = ok));
    const c = svc.conferir(e.t, null, 'ifood', true);
    await new Promise((ok) => setTimeout(ok, 300));
    const d = await svc.conferir(e.t, null, 'ifood', true);
    expect(d).toMatchObject({ estado: 'ok', lendoAgora: true });
    expect(d.itens).toHaveLength(4);
    soltar();
    await c;
    expect(leiturasIfood).toBe(2);
    // A vez de ler vencida (processo morto no meio) não trava a loja.
    await q(`update conferencia_app_leitura set lendo_desde = now() - interval '3 minutes', lido_em = now() - interval '2 minutes' where tenant_id = $1`, [e.t]);
    esperarIfood = null;
    expect((await svc.conferir(e.t, null, 'ifood', true)).lendoAgora).toBe(false);
    expect(leiturasIfood).toBe(3);
  });

  it('a leitura que falha: sem anterior, "semLeitura" com o motivo; com anterior, a lista de antes e o erro; a automática espera', async () => {
    const e = await empresa();
    falhaIfood = 'O Orzuni não respondeu agora. Nada foi mudado; tente de novo em instantes.';
    const r = await svc.conferir(e.t, null, 'ifood', false);
    expect(r).toMatchObject({ estado: 'semLeitura', motivo: falhaIfood, itens: [], erro: null });
    expect((await leitura(e.t)).lendo_desde).toBeNull();
    await svc.conferir(e.t, null, 'ifood', false); // a automática não tenta de novo logo depois do erro
    expect(leiturasIfood).toBe(1);
    falhaIfood = null;
    expect((await svc.conferir(e.t, null, 'ifood', true)).estado).toBe('ok'); // o botão tenta na hora
    await envelhecer(e.t, '1 minute');
    falhaIfood = 'O Orzuni está no limite de leituras agora. Tente de novo em um minuto.';
    const depois = await svc.conferir(e.t, null, 'ifood', true);
    expect(depois).toMatchObject({ estado: 'ok', erro: falhaIfood });
    expect(depois.itens).toHaveLength(4);
    expect(depois.erroEm! > depois.lidoEm!).toBe(true);
  });

  it('sem a ligação do app na loja: "semLigacao" com o motivo, sem ler; a 99 de outra loja não vale nesta', async () => {
    const e = await empresa({ lojas: 2 });
    semLigacao.add(e.lojas[0]);
    const r = await svc.conferir(e.t, e.lojas[0], 'ifood', true);
    expect(r).toMatchObject({ estado: 'semLigacao', motivo: 'Esta loja não está ligada ao Orzuni.', itens: [] });
    expect(r.canais.ifood).toEqual({ ligado: false, motivo: 'Esta loja não está ligada ao Orzuni.', pendentes: null });
    expect(leiturasIfood).toBe(0);
    const outra = await svc.conferir(e.t, e.lojas[1], '99food', true);
    expect(outra).toMatchObject({ estado: 'semLigacao', motivo: expect.stringMatching(/não está conectada à 99/) });
    expect(leituras99).toBe(0);
    // Sem o "Preço e pausa na 99", a 99 não é conferida (o Regem não tem o preço de lá).
    await q(`update entitlement set ativo = false where tenant_id = $1 and modulo = $2`, [e.t, MODULO_PRECOS_NA_99]);
    expect((await svc.conferir(e.t, e.lojas[0], '99food', true)).motivo).toMatch(/Preço e pausa na 99/);
  });

  it('99: lê pelo item/list; usar o preço da 99 grava o `preco_99`; mandar o do Regem enfileira a opção na 99', async () => {
    const e = await empresa();
    const r = await svc.conferir(e.t, null, '99food', false);
    expect(leituras99).toBe(1);
    expect(situacoes(r.itens)).toEqual({ 'X-Bacon': 'igual' });
    expect(r.opcoes).toEqual([expect.objectContaining({ nome: 'Bacon extra', situacao: 'preco', precos: [6.5], grupos: ['Adicionais'] })]);
    const u = await svc.usarPrecoDoApp(e.t, null, { canal: '99food', tipo: 'opcao', chaves: ['pdv:A01'] }, gestor);
    expect(u).toMatchObject({ feitos: 1, recusas: [] });
    expect((await q(`select preco_99::text as p from opcao where id = $1`, [e.bacon]))[0].p).toBe('6.50');
    // O gatilho da opção (mig 404) põe o preço novo na fila da 99.
    const daOpcao = () => q(`select tipo, situacao, versao from food99_envio where tenant_id = $1 and alvo = 'opcao'`, [e.t]);
    const [depoisDeUsar] = await daOpcao();
    expect(depoisDeUsar).toMatchObject({ tipo: 'preco_item', situacao: 'pendente' });
    // O Regem volta a R$ 6,00 (a fila sobe para a versão 2) e o envio termina; a leitura guardada segue com R$ 6,50 lá.
    await q(`update food99_envio set situacao = 'feito' where tenant_id = $1`, [e.t]);
    await q(`update opcao set preco_99 = 6 where id = $1`, [e.bacon]);
    await q(`update food99_envio set situacao = 'feito' where tenant_id = $1`, [e.t]);
    const m = await svc.mandarPrecoAoApp(e.t, null, { canal: '99food', tipo: 'opcao', chave: 'pdv:A01' }, gestor);
    expect(m.frase).toMatch(/R\$ 6,00 vai à 99 agora/);
    expect(await daOpcao()).toEqual([{ tipo: 'preco_item', situacao: 'pendente', versao: depoisDeUsar.versao + 2 }]);
  });

  it('usar o preço do iFood em massa: uma query, só o que difere, UMA auditoria com o de → para de cada um', async () => {
    const e = await empresa();
    cardapioIfood.itens.push({ pdv: '2090', nome: 'Batata', categoria: 'Porções', preco: 18, promo: null, status: 'no_ar', ordem: 3 });
    await q(`insert into produto (tenant_id, nome, codigo, preco_venda, no_ifood) values ($1, 'Batata', '2090', 15, true)`, [e.t]); // sem preço no iFood
    await svc.conferir(e.t, null, 'ifood', false);
    // Alguém muda o preço do X-Salada no Regem depois da leitura: "usar o do app" ainda vale (é o que a pessoa pediu), e a
    // auditoria guarda o "de" verdadeiro (o da hora da gravação), não o da tela.
    await q(`update produto set preco_ifood = 33.9 where id = $1`, [e.p.xsalada]);
    const r = await svc.usarPrecoDoApp(e.t, null, { canal: 'ifood', tipo: 'item', chaves: ['pdv:2052', 'pdv:2090', 'pdv:2051', 'regem:x'] }, gestor);
    expect(r.feitos).toBe(2);
    expect(r.recusas.map((x: any) => x.chave).sort()).toEqual(['pdv:2051', 'regem:x']);
    expect(r.recusas.find((x: any) => x.chave === 'pdv:2051').motivo).toMatch(/não está com o preço diferente/);
    expect((await q(`select preco_ifood::text as p from produto where tenant_id = $1 and codigo = '2090'`, [e.t]))[0].p).toBe('18.00');
    expect((await q(`select preco_ifood::text as p from produto where id = $1`, [e.p.xsalada]))[0].p).toBe('29.90');
    expect(auditados).toEqual([
      expect.objectContaining({
        tenantId: e.t,
        unidadeId: e.lojas[0],
        acao: 'conferencia_usou_preco_do_app',
        detalhe: expect.objectContaining({
          canal: 'ifood',
          tipo: 'item',
          loja: 'Loja 1',
          itens: expect.arrayContaining([
            expect.objectContaining({ nome: 'Batata', de: null, para: 18 }),
            expect.objectContaining({ nome: 'X-Salada', de: 33.9, para: 29.9 }),
          ]),
        }),
      }),
    ]);
    // O gatilho do iFood (mig 400) põe o preço na fila desta loja (vai voltar "sem mudança": é o mesmo de lá).
    expect((await q(`select tipo from orzuni_envio where tenant_id = $1 and tipo = 'preco_item'`, [e.t])).length).toBeGreaterThanOrEqual(1);
    await expect(svc.usarPrecoDoApp(e.t, null, { canal: 'ifood', tipo: 'item', chaves: [] }, gestor)).rejects.toMatchObject({ status: 400 });
    await expect(svc.usarPrecoDoApp(e.t, null, { canal: 'ifood', tipo: 'item', chaves: ['x'] }, gestor)).rejects.toMatchObject({ status: 400 });
  });

  it('mandar o preço do Regem ao iFood: volta à fila do Orzuni DESTA loja (item e opção); só com preço diferente e preenchido', async () => {
    const e = await empresa({ lojas: 2 });
    await svc.conferir(e.t, e.lojas[0], 'ifood', false);
    await q(`delete from orzuni_envio where tenant_id = $1`, [e.t]);
    await svc.mandarPrecoAoApp(e.t, e.lojas[0], { canal: 'ifood', tipo: 'item', chave: 'pdv:2052' }, gestor);
    await svc.mandarPrecoAoApp(e.t, e.lojas[0], { canal: 'ifood', tipo: 'opcao', chave: 'pdv:A01' }, gestor);
    expect(await q(`select unidade_id, tipo, ref_id from orzuni_envio where tenant_id = $1 order by tipo`, [e.t])).toEqual([
      { unidade_id: e.lojas[0], tipo: 'preco_item', ref_id: e.p.xsalada },
      { unidade_id: e.lojas[0], tipo: 'preco_opcao', ref_id: e.bacon },
    ]);
    expect(auditados.map((a) => a.acao)).toEqual(['conferencia_mandou_preco_ao_app', 'conferencia_mandou_preco_ao_app']);
    await expect(svc.mandarPrecoAoApp(e.t, e.lojas[0], { canal: 'ifood', tipo: 'item', chave: 'pdv:2051' }, gestor)).rejects.toMatchObject({ status: 409 });
    // Sem ter lido o app nesta loja, nada a mandar.
    await expect(svc.mandarPrecoAoApp(e.t, e.lojas[1], { canal: 'ifood', tipo: 'item', chave: 'pdv:2052' }, gestor)).rejects.toMatchObject({
      status: 409,
      response: { message: expect.stringMatching(/Ler agora/) },
    });
  });

  it('tirar o "Está no iFood": só a linha "só no Regem"; ignorar e desfazer por loja e app, auditados', async () => {
    const e = await empresa();
    await svc.conferir(e.t, null, 'ifood', false);
    await expect(svc.tirarDoApp(e.t, null, { canal: 'ifood', chave: `regem:${e.p.xbacon}` }, gestor)).rejects.toMatchObject({ status: 409 });
    expect(await svc.tirarDoApp(e.t, null, { canal: 'ifood', chave: `regem:${e.p.hotdog}` }, gestor)).toEqual({ ok: true, mudou: true });
    expect((await q(`select no_ifood from produto where id = $1`, [e.p.hotdog]))[0].no_ifood).toBe(false);
    expect(situacoes((await svc.conferir(e.t, null, 'ifood', false)).itens)).not.toHaveProperty('Hot dog');

    expect(await svc.ignorar(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'pdv:3000', nome: 'Combo do app' }, gestor)).toEqual({ ok: true, ignorada: true });
    await svc.ignorar(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'pdv:3000', nome: 'Combo do app' }, gestor); // repetir não duplica
    const r = await svc.conferir(e.t, null, 'ifood', false);
    expect(situacoes(r.itens)['Combo do app']).toBe('ignorada');
    expect(r.canais.ifood.pendentes).toBe(2); // X-Salada (preço) e a opção Bacon extra
    expect((await svc.conferir(e.t, null, '99food', false)).itens.every((l) => l.situacao !== 'ignorada')).toBe(true); // por app
    await svc.desfazer(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'pdv:3000' }, gestor);
    expect(situacoes((await svc.conferir(e.t, null, 'ifood', false)).itens)['Combo do app']).toBe('soApp');
    expect(auditados.map((a) => a.acao)).toEqual(['conferencia_tirou_do_app', 'conferencia_ignorou', 'conferencia_desfez_ignorar']);
    await expect(svc.ignorar(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'qualquer' }, gestor)).rejects.toMatchObject({ status: 400 });
  });

  it('ligar a um produto: o produto ganha o código do app e copia o "Está no", o preço e a pausa — nada vai a este app', async () => {
    const e = await empresa({ lojas: 2 });
    cardapioIfood.itens.push({ pdv: '2090', nome: 'Batata do app', categoria: 'Porções', preco: 18, promo: null, status: 'pausado', ordem: 3 });
    const semCodigo = (await q(`insert into produto (tenant_id, nome, preco_venda) values ($1, 'Combo da casa', 50) returning id`, [e.t]))[0].id;
    const daOutraLoja = (await q(`insert into produto (tenant_id, unidade_id, nome, preco_venda) values ($1, $2, 'Da loja 2', 10) returning id`, [e.t, e.lojas[1]]))[0].id;
    await svc.conferir(e.t, e.lojas[0], 'ifood', false);
    await q(`delete from orzuni_envio where tenant_id = $1`, [e.t]);
    await q(`delete from food99_envio where tenant_id = $1`, [e.t]);

    // "Ligar a um produto": o produto sem código vira o combo do app (código, "Está no iFood", preço; não pausado lá).
    const r = await svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:3000', produtoId: semCodigo }, gestor);
    expect(r.frase).toBe('"Combo da casa" está ligado a "Combo do app" do iFood (código 3000). Nada mudou no iFood.');
    expect(await q(`select codigo, no_ifood, preco_ifood::text as p, canais_pausados from produto where id = $1`, [semCodigo])).toEqual([
      { codigo: '3000', no_ifood: true, p: '59.90', canais_pausados: [] },
    ]);
    // "Corrigir o código": o hot dog (só no Regem, 2080) vira a batata do app, que está PAUSADA lá — a pausa vem junto.
    await svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:2090', produtoId: e.p.hotdog }, gestor);
    expect(await q(`select codigo, preco_ifood::text as p, canais_pausados from produto where id = $1`, [e.p.hotdog])).toEqual([
      { codigo: '2090', p: '18.00', canais_pausados: ['ifood'] },
    ]);
    // Nada foi à fila do iFood (a marca da transação cala o gatilho dele — mig 406).
    expect(await q(`select tipo from orzuni_envio where tenant_id = $1`, [e.t])).toEqual([]);
    const linhas = (await svc.conferir(e.t, e.lojas[0], 'ifood', false)).itens;
    expect(situacoes(linhas)).toMatchObject({ 'Combo do app': 'igual', 'Batata do app': 'igual' });
    expect(linhas.find((x) => x.nome === 'Hot dog')).toBeUndefined();
    expect(auditados.filter((a) => a.acao === 'conferencia_ligou_ao_app').map((a) => a.detalhe)).toEqual([
      expect.objectContaining({ canal: 'ifood', nome: 'Combo da casa', codigo: { de: null, para: '3000' }, preco: { de: null, para: 59.9 }, pausado: { de: false, para: false } }),
      expect.objectContaining({ nome: 'Hot dog', codigo: { de: '2080', para: '2090' }, preco: { de: 19.9, para: 18 }, pausado: { de: false, para: true } }),
    ]);

    // O código vale para todos os canais: o X-Bacon (também na 99) ligado a outro item do iFood muda de código, e o gatilho
    // da 99 segue como sempre (o produto passa a ligar ao item da 99 com o código novo).
    cardapioIfood.itens.push({ pdv: '4000', nome: 'Bacon duplo do app', categoria: 'Burgers', preco: 49.9, promo: null, status: 'no_ar', ordem: 4 });
    await q(`update conferencia_app_leitura set lido_em = now() - interval '1 minute' where tenant_id = $1`, [e.t]);
    await svc.conferir(e.t, e.lojas[0], 'ifood', true);
    await svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:4000', produtoId: e.p.xbacon }, gestor);
    expect(await q(`select tipo from orzuni_envio where tenant_id = $1`, [e.t])).toEqual([]);
    expect((await q(`select tipo from food99_envio where tenant_id = $1 order by tipo`, [e.t])).map((x) => x.tipo)).toEqual(['preco_item', 'status_item']);

    // Recusas: a linha que não está "só no app", o produto de outra loja, sem produto.
    await expect(svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:2052', produtoId: semCodigo }, gestor)).rejects.toMatchObject({ status: 409 });
    cardapioIfood.itens.push({ pdv: '5000', nome: 'Novo do app', categoria: 'Burgers', preco: 10, promo: null, status: 'no_ar', ordem: 5 });
    await q(`update conferencia_app_leitura set lido_em = now() - interval '1 minute' where tenant_id = $1`, [e.t]);
    await svc.conferir(e.t, e.lojas[0], 'ifood', true);
    await expect(svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:5000', produtoId: daOutraLoja }, gestor)).rejects.toMatchObject({ status: 404 });
    await expect(svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:5000' }, gestor)).rejects.toMatchObject({ status: 400 });
    // Outro produto ganhou o código depois da leitura: a linha deixa de estar "só no app" e a ligação é recusada.
    await q(`insert into produto (tenant_id, nome, codigo, preco_venda) values ($1, 'Pegou o 5000', '5000', 10)`, [e.t]);
    await expect(svc.ligar(e.t, e.lojas[0], { canal: 'ifood', chave: 'pdv:5000', produtoId: semCodigo }, gestor)).rejects.toMatchObject({ status: 409 });
    expect((await q(`select codigo from produto where id = $1`, [semCodigo]))[0].codigo).toBe('3000');
  });

  it('as fotos (F6): a de cada app pela última leitura, por produto; "Mandar esta foto à 99" põe a foto na fila da 99', async () => {
    const e = await empresa();
    cardapioIfood.itens[0].imagem = 'https://static.ifood-static.com.br/x-bacon.jpg';
    cardapio99.items[0].head_img = 'https://img.99app.com/x-bacon.png';
    // Sem leitura: nada (a tela não diz nada das fotos).
    expect(await svc.fotos(e.t, null)).toEqual({ canais: { ifood: null, '99food': null } });
    await svc.conferir(e.t, null, 'ifood', false);
    await svc.conferir(e.t, null, '99food', false);
    const f = await svc.fotos(e.t, null);
    expect(f.canais.ifood!.porProduto).toEqual({ [e.p.xbacon]: 'https://static.ifood-static.com.br/x-bacon.jpg', [e.p.xsalada]: null });
    expect(f.canais['99food']!.porProduto).toEqual({ [e.p.xbacon]: 'https://img.99app.com/x-bacon.png' });
    expect(f.canais.ifood!.lidoEm).toEqual(expect.any(String));
    // Sem a conferência ligada: vazio.
    await q(`update entitlement set ativo = false where tenant_id = $1 and modulo = $2`, [e.t, MODULO_CONFERIR_APPS]);
    expect(await svc.fotos(e.t, null)).toEqual({ canais: { ifood: null, '99food': null } });
    await q(`update entitlement set ativo = true where tenant_id = $1 and modulo = $2`, [e.t, MODULO_CONFERIR_APPS]);

    // Mandar a foto à 99: só com o endereço público da nuvem; sem foto, foto ainda local e fora da 99 = 409 com o porquê.
    await expect(svc.mandarFotoA99(e.t, null, { produtoId: e.p.xbacon }, gestor)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/não tem foto no Regem/) } });
    await q(`update produto set imagem_ref = '/api/v1/publico/midia/t/x.jpg' where id = $1`, [e.p.xbacon]);
    await expect(svc.mandarFotoA99(e.t, null, { produtoId: e.p.xbacon }, gestor)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/só no servidor da loja/) } });
    await expect(svc.mandarFotoA99(e.t, null, { produtoId: e.p.xsalada }, gestor)).rejects.toMatchObject({ status: 409, response: { message: expect.stringMatching(/não está na 99/) } });
    await q(`update produto set imagem_ref = 'https://projeto.supabase.co/storage/v1/object/public/midia/t/x.jpg' where id = $1`, [e.p.xbacon]);
    await q(`delete from food99_envio where tenant_id = $1`, [e.t]);
    const r = await svc.mandarFotoA99(e.t, null, { produtoId: e.p.xbacon }, gestor);
    expect(r.frase).toMatch(/A foto de "X-Bacon" vai à 99 agora/);
    expect(await q(`select tipo, dados from food99_envio where tenant_id = $1 and ref_id = $2`, [e.t, e.p.xbacon])).toEqual([{ tipo: 'cadastro_item', dados: { foto: true } }]);
    expect(auditados.find((a) => a.acao === 'mandou_foto_a_99')).toMatchObject({ detalhe: expect.objectContaining({ nome: 'X-Bacon' }) });
  });

  it('vindo do servidor da loja (na nuvem): quem agiu tem de ser da gestão e ativo; o servidor de uma loja não confere outra', async () => {
    const e = await empresa({ lojas: 2 });
    const funcao = async (cat: string) => (await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [e.t, `F ${cat}`, cat]))[0].id;
    const gerente = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Gerente', $2) returning id`, [e.t, await funcao('gerente')]))[0].id;
    const caixa = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Caixa', $2) returning id`, [e.t, await funcao('execucao')]))[0].id;
    const r = await svc.conferirVindoDaLoja(e.t, e.lojas[0], { canal: 'ifood' });
    expect(r).toMatchObject({ tenantId: e.t, estado: 'ok', loja: { id: e.lojas[0] } });
    await expect(svc.conferirVindoDaLoja(e.t, e.lojas[0], { canal: 'ifood', unidade: e.lojas[1] })).rejects.toMatchObject({ status: 403 });
    await expect(svc.agirVindoDaLoja(e.t, e.lojas[0], 'ignorar', { canal: 'ifood', tipo: 'item', chave: 'pdv:3000', atorId: caixa })).rejects.toMatchObject({ status: 403 });
    await expect(svc.agirVindoDaLoja(e.t, e.lojas[0], 'ignorar', { canal: 'ifood', tipo: 'item', chave: 'pdv:3000' })).rejects.toMatchObject({ status: 403 });
    expect(await svc.agirVindoDaLoja(e.t, e.lojas[0], 'ignorar', { canal: 'ifood', tipo: 'item', chave: 'pdv:3000', atorId: gerente })).toEqual({ ok: true, ignorada: true });
    expect(auditados[0]).toMatchObject({ atorId: gerente, atorPerfil: 'gerente', unidadeId: e.lojas[0] });
    await expect(svc.agirVindoDaLoja(e.t, e.lojas[0], 'apagar-tudo', { atorId: gerente })).rejects.toMatchObject({ status: 404 });
  });

  it('no servidor da loja: pede à nuvem (GET e POST com quem agiu); sem conexão, "semConexao" ou 503; a recusa da nuvem volta como veio', async () => {
    const e = await empresa();
    const pedidos: { url: string; init: any }[] = [];
    let resposta: () => Promise<any> = async () => new Response(JSON.stringify({ tenantId: e.t, estado: 'ok', itens: [], opcoes: [] }), { status: 200 });
    const local = new ConferenciaService(db, auditoria, orzuni as any, food99);
    local.buscarNaNuvem = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      return resposta();
    }) as any;
    const antes = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
    Object.assign(process.env, { EDGE_MODE: 'true', CLOUD_API: 'https://nuvem.teste/api/v1', SYNC_TOKEN: 'tk-servidor' });
    try {
      const r = await local.conferir(e.t, e.lojas[0], 'ifood', true);
      expect(r).toEqual({ estado: 'ok', itens: [], opcoes: [] });
      expect(pedidos[0].url).toBe(`https://nuvem.teste/api/v1/catalogo/conferencia/loja?canal=ifood&unidade=${e.lojas[0]}&ler=1`);
      expect(pedidos[0].init.headers['x-sync-token']).toBe('tk-servidor');
      expect(leiturasIfood).toBe(0); // a loja nunca lê o app

      resposta = async () => new Response(JSON.stringify({ tenantId: e.t, ok: true, ignorada: true }), { status: 200 });
      expect(await local.ignorar(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'pdv:3000' }, { id: 'c0000000-0000-4000-8000-000000000001', perfil: 'gerente' })).toEqual({
        ok: true,
        ignorada: true,
      });
      expect(pedidos[1].url).toBe('https://nuvem.teste/api/v1/catalogo/conferencia/loja/ignorar');
      expect(JSON.parse(pedidos[1].init.body)).toEqual({ canal: 'ifood', tipo: 'item', chave: 'pdv:3000', unidade: null, atorId: 'c0000000-0000-4000-8000-000000000001' });
      expect(await q(`select 1 from conferencia_app_ignorado where tenant_id = $1`, [e.t])).toHaveLength(0); // nada gravado na loja

      resposta = async () => new Response(JSON.stringify({ statusCode: 409, message: 'Leia o iFood antes ("Ler agora").' }), { status: 409 });
      await expect(local.mandarPrecoAoApp(e.t, null, { canal: 'ifood', tipo: 'item', chave: 'pdv:2052' }, gestor)).rejects.toMatchObject({
        status: 409,
        response: { message: 'Leia o iFood antes ("Ler agora").' },
      });

      resposta = async () => {
        throw new TypeError('fetch failed');
      };
      expect(await local.conferir(e.t, null, 'ifood', false)).toMatchObject({ estado: 'semConexao', motivo: expect.stringMatching(/Sem conexão com a nuvem/) });
      await expect(local.usarPrecoDoApp(e.t, null, { canal: 'ifood', tipo: 'item', chaves: ['pdv:2052'] }, gestor)).rejects.toMatchObject({ status: 503 });
      // A nuvem que responde por outra empresa não vale.
      resposta = async () => new Response(JSON.stringify({ tenantId: '00000000-0000-4000-8000-000000000000', estado: 'ok', itens: [], opcoes: [] }), { status: 200 });
      expect((await local.conferir(e.t, null, 'ifood', false)).estado).toBe('semConexao');
    } finally {
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it('o console da distribuição: o painel e a liberação (auditada só quando muda)', async () => {
    const e = await empresa({ conferir: false });
    const c = new ConferirAppsService(db, auditoria);
    await svc.conferir(e.t, null, 'ifood', false).catch(() => {});
    expect(await c.painel(e.t)).toMatchObject({ liberado: false, ifood: { liberado: true, lojasLigadas: 1 }, n99: { liberado: true, conectada: true }, leituras: [] });
    expect(await c.liberacao({ tenantId: e.t, ligar: true }, { nome: 'Diretoria' })).toEqual({ tenantId: e.t, liberado: true });
    await c.liberacao({ tenantId: e.t, ligar: true }, { nome: 'Diretoria' });
    expect(auditados.map((a) => a.acao)).toEqual(['ligou_conferir_apps']);
    await svc.conferir(e.t, null, 'ifood', false);
    expect((await c.painel(e.t)).leituras).toEqual([expect.objectContaining({ loja: 'Loja 1', canal: 'ifood', itens: 3, opcoes: 1, erro: null })]);
    await expect(c.liberacao({ tenantId: e.t, ligar: 'sim' as any }, {})).rejects.toMatchObject({ status: 400 });
  });
});
