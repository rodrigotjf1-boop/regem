import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { assinarCliente } from '../cliente/cliente-token';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { DeliveryService } from '../delivery/delivery.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { AJUSTE_CHEGUEI_PADRAO } from './chegada';
import { ChegadaService } from './chegada.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "CHEGUEI" NA RETIRADA (Onda 3, mig 354), contra o Postgres real: a gravação (uma linha por pedido, "de novo" só depois
// do tempo, dois toques juntos), a prova de dono no cardápio (V79), as regras do pedido (retirada, esperando, no dia,
// loja ligada), o WhatsApp (ERR-317), as telas da loja, o KDS pela comanda, a lista da Retirada e a página do pedido
// (ERR-216: a rota de LISTA que a tela usa), os ajustes (V15/V16, só as colunas que mudaram) e o servidor da loja que
// junta a cópia local com a nuvem sem esperar a internet (V37).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('chegada-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('"Cheguei" na retirada (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const svc = new ChegadaService(db, auditoria);
  const eventos = { emit: () => true } as any;
  const empresas: string[] = [];
  const env = {
    EDGE_MODE: process.env.EDGE_MODE,
    CLOUD_API: process.env.CLOUD_API,
    SYNC_TOKEN: process.env.SYNC_TOKEN,
    JWT_SECRET: process.env.JWT_SECRET,
  };
  // O token do cliente (Sua conta) é assinado com o JWT_SECRET: um de teste quando o ambiente não tem.
  const segredoDeTeste = () => {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) process.env.JWT_SECRET = 'segredo-de-teste-do-cheguei-123';
  };
  // O `client_ref` é único por empresa (índice do banco): cada pedido nasce com o seu.
  const refs = new Map<string, string>();
  const refDe = (p: string) => refs.get(p) as string;
  const fetchOriginal = global.fetch;
  const voltarEnv = () => {
    for (const [k, v] of Object.entries(env)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    global.fetch = fetchOriginal;
  };

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(readFileSync(MIG(arq), 'utf8'));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM: é lá que o cliente avisa (o jest do CI roda sem EDGE_MODE — V44)
    await aplicar('354_cheguei_na_retirada.sql'); // idempotente: no banco do CI ela já veio pelo apply-all
  });
  beforeEach(segredoDeTeste);
  afterEach(voltarEnv);
  afterAll(async () => {
    voltarEnv();
    if (empresas.length) {
      for (const t of ['pedido_chegada', 'producao_pedido', 'pedido_externo', 'comanda', 'cliente', 'cardapio_config', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  const empresa = async () => {
    const [{ id }] = await q(`insert into empresa (nome) values ('teste cheguei') returning id`);
    empresas.push(id);
    return id as string;
  };
  const loja = async (t: string) => (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja teste') returning id`, [t]))[0].id as string;
  const cardapio = async (
    t: string,
    unidade: string | null,
    aj: { ativo?: boolean; perguntarOnde?: boolean; todasTelas?: boolean; deNovoMin?: number } = {},
  ) => {
    const token = `tk-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, cheguei_ativo, cheguei_perguntar_onde, cheguei_todas_telas, cheguei_de_novo_min)
       values ($1,$2,$3,true,$4,$5,$6,$7)`,
      [t, unidade, token, aj.ativo ?? true, aj.perguntarOnde ?? true, aj.todasTelas ?? true, aj.deNovoMin ?? 5],
    );
    return token;
  };
  const cliente = async (t: string, tel = '21987654321') =>
    (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Marina Lopes',$2) returning id`, [t, tel]))[0].id as string;
  const pedido = async (
    t: string,
    o: {
      unidade?: string | null;
      tipo?: string;
      status?: string;
      tel?: string;
      ref?: string | null;
      clienteId?: string | null;
      diasAtras?: number;
      agendamento?: string | null;
      comandaId?: string | null;
      display?: string;
    } = {},
  ) => {
    const ref = o.ref === undefined ? `ref-${randomUUID()}` : o.ref;
    const id = (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status, cliente_nome, cliente_telefone,
                                     client_ref, cliente_id, criado_em, agendamento, comanda_id, display_id)
         values ($1,$2,'cardapio',$3,'[]'::jsonb,30,$4,'Marina Lopes',$5,$6,$7, now() - make_interval(days => $8), $9, $10, $11)
         returning id`,
        [
          t,
          o.unidade ?? null,
          o.tipo ?? 'retirada',
          o.status ?? 'confirmado',
          o.tel ?? '21987654321',
          ref,
          o.clienteId ?? null,
          o.diasAtras ?? 0,
          o.agendamento ?? null,
          o.comandaId ?? null,
          o.display ?? '1187',
        ],
      )
    )[0].id as string;
    if (ref) refs.set(id, ref);
    return id;
  };
  const base = (t: string, p: string, unidadeId: string | null = null) => ({
    tenantId: t,
    unidadeId,
    pedidoId: p,
    origem: 'cardapio' as const,
    onde: null,
    obs: null,
    deNovoMin: 5,
  });

  it('registrar: o primeiro cria; logo depois não avisa ninguém (só atualiza onde); passado o tempo, "de novo"', async () => {
    const t = await empresa();
    const u = await loja(t);
    const p = await pedido(t, { unidade: u });
    const a = await svc.registrar(base(t, p, u));
    expect(a.situacao).toBe('novo');
    expect((await svc.registrar(base(t, p, u))).situacao).toBe('ja_avisado');
    const c = await svc.registrar({ ...base(t, p, u), onde: 'porta', obs: 'moto vermelha' });
    expect(c).toMatchObject({ situacao: 'ja_avisado', chegada: { onde: 'porta', obs: 'moto vermelha', deNovoEm: null } });
    expect(c.chegada.chegouEm).toBe(a.chegada.chegouEm);
    await q(`update pedido_chegada set chegou_em = now() - interval '6 minutes' where id = $1`, [p]);
    const d = await svc.registrar(base(t, p, u));
    expect(d.situacao).toBe('de_novo');
    expect(d.chegada).toMatchObject({ onde: 'porta', obs: 'moto vermelha' }); // não apaga o que o cliente disse
    expect(d.chegada.deNovoEm).not.toBeNull();
    expect((await svc.registrar(base(t, p, u))).situacao).toBe('ja_avisado');
    // o "de novo" conta a partir do ÚLTIMO aviso
    await q(`update pedido_chegada set de_novo_em = now() - interval '4 minutes' where id = $1`, [p]);
    expect((await svc.registrar(base(t, p, u))).situacao).toBe('ja_avisado');
    await q(`update pedido_chegada set de_novo_em = now() - interval '5 minutes 1 second' where id = $1`, [p]);
    expect((await svc.registrar(base(t, p, u))).situacao).toBe('de_novo');
    expect(await q(`select count(*)::int as n from pedido_chegada where id = $1`, [p])).toEqual([{ n: 1 }]);
  });

  it('dois toques (ou duas réplicas) ao mesmo tempo: uma linha, um "novo"', async () => {
    const t = await empresa();
    const p = await pedido(t);
    const rs = await Promise.all([1, 2, 3, 4].map(() => svc.registrar(base(t, p))));
    expect(rs.filter((r) => r.situacao === 'novo')).toHaveLength(1);
    expect(await q(`select count(*)::int as n from pedido_chegada where id = $1`, [p])).toEqual([{ n: 1 }]);
  });

  it('pelo cardápio: só com prova de dono — o ref do link ou o token do cliente de Sua conta (V79)', async () => {
    const t = await empresa();
    const u = await loja(t);
    const tk = await cardapio(t, u);
    const cli = await cliente(t);
    const p = await pedido(t, { unidade: u, ref: 'ref-abc', clienteId: cli });
    await expect(svc.porCardapio('tk-nao-existe', p, { ref: 'ref-abc' })).rejects.toThrow('Cardápio indisponível.');
    await expect(svc.porCardapio(tk, p, {})).rejects.toThrow('Pedido não encontrado.');
    await expect(svc.porCardapio(tk, p, { ref: 'outro' })).rejects.toThrow('Pedido não encontrado.');
    await expect(svc.porCardapio(tk, 'nao-e-uuid', { ref: 'ref-abc' })).rejects.toThrow('Pedido não encontrado.');
    const outroCliente = await cliente(t, '21911112222');
    await expect(svc.porCardapio(tk, p, { clienteToken: assinarCliente(outroCliente, t) })).rejects.toThrow('Pedido não encontrado.');
    const t2 = await empresa();
    await expect(svc.porCardapio(tk, p, { clienteToken: assinarCliente(cli, t2) })).rejects.toThrow('Pedido não encontrado.');
    // o pedido de OUTRA empresa pelo cardápio desta: não existe aqui
    const tk2 = await cardapio(t2, null);
    await expect(svc.porCardapio(tk2, p, { ref: 'ref-abc' })).rejects.toThrow('Pedido não encontrado.');
    const r: any = await svc.porCardapio(tk, p, { ref: 'ref-abc', onde: 'porta', obs: '  carro prata ' });
    expect(r).toMatchObject({ situacao: 'novo', pronto: false, chegada: { onde: 'porta' } });
    expect(r.chegada).not.toHaveProperty('obs'); // a página abre com o link do pedido: não devolve o "como te achar"
    expect(await q(`select unidade_id, onde, obs, origem from pedido_chegada where id = $1`, [p])).toEqual([
      { unidade_id: u, onde: 'porta', obs: 'carro prata', origem: 'cardapio' },
    ]);
    expect((await svc.porCardapio(tk, p, { clienteToken: assinarCliente(cli, t) })).situacao).toBe('ja_avisado');
  });

  it('pelo cardápio: só retirada, só esperando o cliente, só no dia, só com o "Cheguei" ligado na loja', async () => {
    const t = await empresa();
    const u = await loja(t);
    const tk = await cardapio(t, u);
    const entrega = await pedido(t, { unidade: u, tipo: 'entrega' });
    await expect(svc.porCardapio(tk, entrega, { ref: refDe(entrega) })).rejects.toThrow('O "Cheguei" é para pedido de retirada.');
    for (const status of ['concluido', 'cancelado', 'despachado']) {
      const p = await pedido(t, { unidade: u, status });
      await expect(svc.porCardapio(tk, p, { ref: refDe(p) })).rejects.toThrow('Este pedido já foi retirado ou cancelado.');
    }
    const ontem = await pedido(t, { unidade: u, diasAtras: 1 });
    await expect(svc.porCardapio(tk, ontem, { ref: refDe(ontem) })).rejects.toThrow('O "Cheguei" vale no dia da retirada.');
    // a encomenda feita ontem para retirar HOJE vale
    const encomenda = await pedido(t, { unidade: u, diasAtras: 1, agendamento: new Date().toISOString() });
    expect((await svc.porCardapio(tk, encomenda, { ref: refDe(encomenda) })).situacao).toBe('novo');
    for (const status of ['novo', 'pronto']) {
      const p = await pedido(t, { unidade: u, status });
      expect((await svc.porCardapio(tk, p, { ref: refDe(p) })).pronto).toBe(status === 'pronto');
    }
    const p2 = await pedido(t, { unidade: u });
    await expect(svc.porCardapio(tk, p2, { ref: refDe(p2), onde: 'carro' })).rejects.toThrow('Onde você está');
    const t3 = await empresa();
    const u3 = await loja(t3);
    const tk3 = await cardapio(t3, u3, { ativo: false });
    const p3 = await pedido(t3, { unidade: u3 });
    await expect(svc.porCardapio(tk3, p3, { ref: refDe(p3) })).rejects.toThrow('Esta loja não usa o "Cheguei".');
  });

  it('loja que não pergunta onde: o "onde" e o "como te achar" não são gravados', async () => {
    const t = await empresa();
    const u = await loja(t);
    const tk = await cardapio(t, u, { perguntarOnde: false });
    const p = await pedido(t, { unidade: u });
    await svc.porCardapio(tk, p, { ref: refDe(p), onde: 'porta', obs: 'moto' });
    expect(await q(`select onde, obs from pedido_chegada where id = $1`, [p])).toEqual([{ onde: null, obs: null }]);
  });

  it('o ajuste da loja: a linha da loja; sem ela, a da empresa; sem nenhuma, o padrão (desligado)', async () => {
    const t = await empresa();
    const u1 = await loja(t);
    const u2 = await loja(t);
    await cardapio(t, null, { ativo: true, deNovoMin: 10 });
    await cardapio(t, u2, { ativo: false });
    expect(await svc.ajusteDaLoja(t, u1)).toMatchObject({ ativo: true, deNovoMin: 10 });
    expect((await svc.ajusteDaLoja(t, u2)).ativo).toBe(false);
    expect((await svc.ajusteDaLoja(t, null)).ativo).toBe(true);
    const vazia = await empresa();
    expect(await svc.ajusteDaLoja(vazia, null)).toEqual(AJUSTE_CHEGUEI_PADRAO);
    expect(await svc.ajustes(vazia, null)).toMatchObject({ temCardapio: false, ativo: false });
  });

  it('salvar: só os campos que vieram, só as colunas que mudaram, na linha certa, com a auditoria', async () => {
    const t = await empresa();
    const u1 = await loja(t);
    const u2 = await loja(t);
    await cardapio(t, null, { ativo: false });
    await cardapio(t, u2, { ativo: false, deNovoMin: 3 });
    const user = { tenantId: t, colaboradorId: null, categoria: 'gerente' } as any;
    auditados.length = 0;
    await svc.salvarAjustes(user, u1, { ativo: true }); // a loja 1 não tem linha: grava na da empresa
    expect((await svc.ajusteDaLoja(t, u1)).ativo).toBe(true);
    expect(await svc.ajusteDaLoja(t, u2)).toMatchObject({ ativo: false, deNovoMin: 3 }); // a da loja 2 não mudou
    await svc.salvarAjustes(user, u2, { deNovoMin: 10, todasTelas: false });
    expect(await svc.ajusteDaLoja(t, u2)).toEqual({ ativo: false, perguntarOnde: true, todasTelas: false, deNovoMin: 10 });
    expect(auditados.map((a) => [a.acao, a.detalhe])).toEqual([
      ['ajustou_cheguei', { de: { ativo: false }, para: { ativo: true } }],
      ['ajustou_cheguei', { de: { deNovoMin: 3, todasTelas: true }, para: { deNovoMin: 10, todasTelas: false } }],
    ]);
    await svc.salvarAjustes(user, u2, { deNovoMin: 10 }); // nada mudou: nada grava
    expect(auditados).toHaveLength(2);
    const vazia = await empresa();
    await expect(svc.salvarAjustes({ ...user, tenantId: vazia }, null, { ativo: true })).rejects.toThrow(
      'Delivery › Configurações › Cardápio',
    );
  });

  it('pelo WhatsApp: "cheguei" de quem tem retirada esperando hoje (com o 55, sem o nono dígito)', async () => {
    const t = await empresa();
    const u = await loja(t);
    await cardapio(t, u);
    const p = await pedido(t, { unidade: u, tel: '21987654321', status: 'pronto', display: '1187' });
    const r = await svc.porWhatsapp(t, '552187654321', 'Cheguei, tô de moto');
    expect(r).toEqual({
      tratou: true,
      pedidoIds: [p],
      responder: 'Avisamos a equipe, Marina! 🙋 Seu pedido #1187 está no balcão: diga o seu nome ou o número 1187.',
    });
    expect(await q(`select origem, obs, onde from pedido_chegada where id = $1`, [p])).toEqual([
      { origem: 'whatsapp', obs: 'tô de moto', onde: null },
    ]);
    const r2 = await svc.porWhatsapp(t, '5521987654321', 'cheguei');
    expect(r2.responder).toMatch(/^A equipe já sabe que você chegou \(às \d\d:\d\d\), Marina\./);
  });

  it('pelo WhatsApp NÃO trata: outra conversa, sem retirada hoje, entrega, de ontem, já saiu, loja desligada, outra empresa', async () => {
    const t = await empresa();
    const u = await loja(t);
    await cardapio(t, u);
    const tel = '21955554444';
    expect(await svc.porWhatsapp(t, tel, 'cheguei')).toEqual({ tratou: false });
    await pedido(t, { unidade: u, tel, tipo: 'entrega' });
    await pedido(t, { unidade: u, tel, diasAtras: 1 });
    await pedido(t, { unidade: u, tel, status: 'concluido' });
    expect(await svc.porWhatsapp(t, tel, 'cheguei')).toEqual({ tratou: false });
    const hoje = await pedido(t, { unidade: u, tel });
    expect(await svc.porWhatsapp(t, tel, 'quero saber do meu pedido')).toEqual({ tratou: false });
    expect(await svc.porWhatsapp(t, tel, 'cheguei em casa e faltou o refri')).toEqual({ tratou: false });
    expect(await q(`select count(*)::int as n from pedido_chegada where id = $1`, [hoje])).toEqual([{ n: 0 }]);
    const outra = await empresa();
    expect(await svc.porWhatsapp(outra, tel, 'cheguei')).toEqual({ tratou: false });
    const t3 = await empresa();
    const u3 = await loja(t3);
    await cardapio(t3, u3, { ativo: false });
    await pedido(t3, { unidade: u3, tel });
    expect(await svc.porWhatsapp(t3, tel, 'cheguei')).toEqual({ tratou: false });
  });

  it('para as telas: só os pedidos que ainda esperam, de quem esperou mais; da loja (e sem loja); desligado, nada', async () => {
    const t = await empresa();
    const u = await loja(t);
    const outraLoja = await loja(t);
    await cardapio(t, null);
    const a = await pedido(t, { unidade: u, display: '11', status: 'pronto' });
    const b = await pedido(t, { unidade: u, display: '12' });
    const c = await pedido(t, { unidade: u, display: '13' });
    const d = await pedido(t, { unidade: outraLoja, display: '14' });
    const semLoja = await pedido(t, { unidade: null, display: '15' });
    for (const p of [b, a, c]) await svc.registrar(base(t, p, u));
    await svc.registrar(base(t, d, outraLoja));
    await svc.registrar(base(t, semLoja, null));
    await q(`update pedido_chegada set chegou_em = now() - interval '3 minutes' where id = $1`, [a]);
    await q(`update pedido_externo set status = 'concluido' where id = $1`, [c]);
    const r = await svc.paraAsTelas(t, u);
    expect(r).toMatchObject({ ativo: true, todasTelas: true, deNovoMin: 5 });
    expect(r.chegadas.map((x) => [x.numero, x.nome, x.pronto])).toEqual([
      ['11', 'Marina', true],
      ['12', 'Marina', false],
      ['15', 'Marina', false],
    ]);
    // a chegada de mais de 18 h não aparece
    await q(`update pedido_chegada set chegou_em = now() - interval '19 hours' where id = $1`, [b]);
    expect((await svc.paraAsTelas(t, u)).chegadas.map((x) => x.numero)).toEqual(['11', '15']);
    await q(`update cardapio_config set cheguei_ativo = false where tenant_id = $1`, [t]);
    expect(await svc.paraAsTelas(t, u)).toEqual({ ativo: false, todasTelas: true, deNovoMin: 5, chegadas: [] });
  });

  it('a rota da nuvem para o servidor da loja: a loja dele (e a sem loja), das últimas 18 h', async () => {
    const t = await empresa();
    const u = await loja(t);
    const outra = await loja(t);
    const p1 = await pedido(t, { unidade: u });
    const p2 = await pedido(t, { unidade: outra });
    const p3 = await pedido(t, { unidade: null });
    await svc.registrar(base(t, p1, u));
    await svc.registrar(base(t, p2, outra));
    await svc.registrar(base(t, p3, null));
    const r = await svc.paraOServidorDaLoja(t, u);
    expect(r.tenantId).toBe(t);
    expect(r.chegadas.map((c) => c.pedidoId).sort()).toEqual([p1, p3].sort());
    expect((await svc.paraOServidorDaLoja(t, null)).chegadas).toHaveLength(3);
  });

  it('o KDS (pela comanda), a lista da Retirada e a página do pedido recebem a chegada', async () => {
    const t = await empresa();
    const u = await loja(t);
    const tk = await cardapio(t, u);
    const [{ id: comanda }] = await q(
      `insert into comanda (tenant_id, unidade_id, status, total) values ($1,$2,'aberta',0) returning id`,
      [t, u],
    );
    const p = await pedido(t, { unidade: u, comandaId: comanda, ref: 'ref-k' });
    await q(
      `insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero) values ($1,$2,$3,77,'recebido','balcao',77)`,
      [t, u, comanda],
    );
    await svc.porCardapio(tk, p, { ref: 'ref-k', onde: 'balcao' });

    const producao = new ProducaoPedidoService(db, auditoria, eventos, svc);
    const fila: any = await producao.filaKds(t, { unidadeId: u });
    expect(fila.pedidos.find((x: any) => x.comandaId === comanda)?.chegada).toMatchObject({ pedidoId: p, onde: 'balcao' });
    // sem o serviço injetado (como os testes antigos montam): uma instância só com o banco, a mesma resposta
    const semInjecao: any = await new ProducaoPedidoService(db, auditoria, eventos).filaKds(t, { unidadeId: u });
    expect(semInjecao.pedidos.find((x: any) => x.comandaId === comanda)?.chegada?.pedidoId).toBe(p);

    const delivery = new DeliveryService(
      db, {} as any, producao, {} as any, {} as any, eventos, { flashPedidos: () => undefined } as any,
      undefined, undefined, undefined, undefined, undefined, undefined, auditoria, undefined, undefined, svc,
    );
    const ret: any = await delivery.listarRetirada(t, u);
    expect(ret.cheguei).toEqual({ ativo: true, deNovoMin: 5 });
    expect(ret.pedidos.find((x: any) => x.id === p)?.chegada).toMatchObject({ onde: 'balcao' });

    const cardapioSvc = new CardapioService(
      db, {} as any, {} as any, {} as any, {} as any, {} as any, eventos, {} as any, auditoria, svc,
    );
    const st: any = await cardapioSvc.statusPedido(tk, p, 'ref-k');
    expect(st.cheguei).toMatchObject({ ativo: true, perguntarOnde: true, deNovoMin: 5, chegada: { onde: 'balcao' } });
    expect(Date.parse(st.cheguei.chegada.podeDeNovoEm) - Date.parse(st.cheguei.chegada.chegouEm)).toBe(5 * 60_000);
    const entrega = await pedido(t, { unidade: u, tipo: 'entrega', ref: 'ref-e' });
    expect(((await cardapioSvc.statusPedido(tk, entrega, 'ref-e')) as any).cheguei).toBeNull();
    await q(`update cardapio_config set cheguei_ativo = false where tenant_id = $1`, [t]);
    expect(((await cardapioSvc.statusPedido(tk, p, 'ref-k')) as any).cheguei).toEqual({ ativo: false });
  });

  it('servidor da loja: junta a cópia local com o que a nuvem já sabe, sem esperar a internet (V37)', async () => {
    const t = await empresa();
    const u = await loja(t);
    const local = await pedido(t, { unidade: u, display: '21' });
    const soNaNuvem = randomUUID();
    await svc.registrar(base(t, local, u));
    const chamadas: { url: string; token: string }[] = [];
    global.fetch = (async (url: any, init: any) => {
      chamadas.push({ url: String(url), token: init?.headers?.['x-sync-token'] });
      return {
        ok: true,
        json: async () => ({
          tenantId: t,
          chegadas: [
            { pedidoId: soNaNuvem, unidadeId: u, chegouEm: new Date().toISOString(), deNovoEm: null, onde: 'porta', obs: 'moto', origem: 'whatsapp' },
            { pedidoId: local, unidadeId: u, chegouEm: new Date(Date.now() - 600_000).toISOString(), deNovoEm: new Date().toISOString(), onde: null, obs: null, origem: 'cardapio' },
            { pedidoId: 'lixo', chegouEm: 'x' },
          ],
        }),
      } as any;
    }) as any;
    process.env.EDGE_MODE = 'true';
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1';
    process.env.SYNC_TOKEN = 'tok-servidor';
    const edge = new ChegadaService(db);
    const primeira = await edge.mapaDaLoja(t, u); // não espera a nuvem: só a cópia local
    expect([...primeira.keys()]).toEqual([local]);
    await new Promise((r) => setTimeout(r, 50));
    const segunda = await edge.mapaDaLoja(t, u);
    expect(segunda.get(soNaNuvem)).toMatchObject({ onde: 'porta', obs: 'moto', origem: 'whatsapp' });
    expect(segunda.get(local)?.deNovoEm).not.toBeNull(); // o "de novo" da nuvem é mais novo que a cópia local
    expect(segunda.has('lixo')).toBe(false);
    expect(chamadas).toEqual([{ url: 'https://nuvem.teste/api/v1/delivery/chegadas/loja', token: 'tok-servidor' }]);

    // a nuvem responde por OUTRA empresa (servidor reaproveitado): não mostra nada de ninguém
    global.fetch = (async () => ({ ok: true, json: async () => ({ tenantId: randomUUID(), chegadas: [{ pedidoId: randomUUID(), chegouEm: new Date().toISOString() }] }) })) as any;
    const outro = new ChegadaService(db);
    await outro.mapaDaLoja(t, u);
    await new Promise((r) => setTimeout(r, 50));
    expect([...(await outro.mapaDaLoja(t, u)).keys()]).toEqual([local]);
    // sem internet: a cópia local segue de pé
    global.fetch = (async () => {
      throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    }) as any;
    const semRede = new ChegadaService(db);
    await semRede.mapaDaLoja(t, u);
    await new Promise((r) => setTimeout(r, 50));
    expect([...(await semRede.mapaDaLoja(t, u)).keys()]).toEqual([local]);
  });
});
