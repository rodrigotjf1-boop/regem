import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { DeliveryService } from '../delivery/delivery.service';
import { clientePeloTelefone, idDaConfirmacao, marcaAbertaDaComanda, procurarPedidoIgual } from './pedido-repetido';
import { PedidoRepetidoService } from './pedido-repetido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO IGUAL EM ATÉ 30 MIN (mig 360; pedido do dono, 03/11/2026 — decisões 1 e 2A), contra o Postgres real: a marca
// nasce NA GRAVAÇÃO do pedido dos canais de fora (o mesmo cliente pelo cadastro — no iFood, pelo id da plataforma, porque
// o telefone é um 0800 comum); o que não marca (cancelado, fora da janela, encomenda, outra loja, ajuste desligado); o
// "São dois pedidos" (id pela chave, uma linha só, auditoria, aviso ao KDS) e o caminho de LEITURA das telas — a fila do
// KDS e a lista do painel (ERR-216) —; a via da cozinha com o aviso no alto; o ajuste da loja (V16).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-repetido-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('pedido igual em até 30 min (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const emitidos: { nome: string; e: any }[] = [];
  const eventos = { emit: (nome: string, e: any) => (emitidos.push({ nome, e }), true) } as any;
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const delivery = new DeliveryService(
    db, {} as any, producao, {} as any, {} as any, eventos, { flashPedidos: () => undefined } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
  );
  const ajustes = new PedidoRepetidoService(db, auditoria);
  const empresas: string[] = [];
  const edge = process.env.EDGE_MODE;

  const aplicar = (arq: string) =>
    repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG(arq), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM: é lá que os pedidos dos canais entram (o jest do CI roda sem EDGE_MODE — V44)
    // Só quando falta (banco local antigo): no CI ela já veio pelo apply-all, e rodar o DDL de novo no meio das outras
    // suítes deu impasse na limpeza delas (ERR-351).
    const [{ falta }] = (
      await pool.query(
        `select to_regclass('pedido_repetido_ok') is null
             or not exists (select 1 from information_schema.columns where table_schema = current_schema()
                             and table_name = 'pedido_externo' and column_name = 'repetido_de')
             or not exists (select 1 from information_schema.columns where table_schema = current_schema()
                             and table_name = 'cardapio_config' and column_name = 'pedido_repetido_min') as falta`,
      )
    ).rows;
    if (falta) await aplicar('360_pedido_repetido.sql');
  });
  afterAll(async () => {
    if (edge === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edge;
    if (empresas.length) {
      for (const t of ['pedido_repetido_ok', 'producao_pedido', 'pedido_externo', 'comanda', 'cliente', 'cardapio_config', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  const empresa = async () => {
    const [{ id }] = await q(`insert into empresa (nome) values ('teste pedido igual') returning id`);
    empresas.push(id);
    return id as string;
  };
  const loja = async (t: string, nome = 'Loja teste') =>
    (await q(`insert into unidade (tenant_id, nome) values ($1,$2) returning id`, [t, nome]))[0].id as string;
  const cardapio = async (t: string, unidade: string | null, aj: { ativo?: boolean; min?: number } = {}) =>
    (
      await q(
        `insert into cardapio_config (tenant_id, unidade_id, token, ativo, pedido_repetido_ativo, pedido_repetido_min)
         values ($1,$2,$3,true,$4,$5) returning id`,
        [t, unidade, `tk-${randomUUID()}`, aj.ativo ?? true, aj.min ?? 30],
      )
    )[0].id as string;

  const salada = { nome: 'X-Salada', codigo: '101', quantidade: 2, preco: 28 };
  const batata = { nome: 'Batata frita média', codigo: '205', quantidade: 1, preco: 14 };
  // Um pedido de canal de fora pelo adaptador genérico (o mesmo caminho de gravação de todos os canais).
  const deFora = (
    t: string,
    u: string | null,
    o: { tel?: string; nome?: string; itens?: { nome: string; codigo: string; quantidade: number; preco: number }[]; extra?: any } = {},
  ) =>
    delivery.ingest(
      t,
      u,
      'telefone',
      {
        externalId: `ext-${randomUUID()}`,
        displayId: String(Math.floor(Math.random() * 9000) + 1000),
        cliente: o.nome ?? 'Carlos Souza',
        clienteTelefone: o.tel ?? '21987650001',
        tipo: 'entrega',
        endereco: 'Av. Brasil, 455',
        formaPagamento: 'pix',
        total: 78,
        itens: (o.itens ?? [salada, batata]).map((i) => ({ codigo: i.codigo, descricao: i.nome, quantidade: i.quantidade, precoUnitario: i.preco })),
      },
      o.extra,
    ) as Promise<any>;
  // Um pedido do iFood: o telefone é o 0800 da plataforma (igual para todos); o cliente é o `customer.id`.
  const doIfood = (t: string, u: string | null, clienteDoIfood: string, itens = [salada, batata]) =>
    delivery.ingest(t, u, 'ifood', {
      id: `if-${randomUUID()}`,
      displayId: String(Math.floor(Math.random() * 9000) + 1000),
      orderType: 'DELIVERY',
      customer: { id: clienteDoIfood, name: `Cliente ${clienteDoIfood}`, phone: { number: '0800 705 0505', localizer: '12345678' } },
      items: itens.map((i) => ({ externalCode: i.codigo, name: i.nome, quantity: i.quantidade, totalPrice: i.preco * i.quantidade })),
      total: { orderAmount: 78 },
      payments: { pending: 0, methods: [{ type: 'ONLINE' }] },
    }) as Promise<any>;
  const marcaDe = async (id: string) => (await q(`select repetido_de from pedido_externo where id = $1`, [id]))[0].repetido_de;

  it('canal de fora: o pedido igual do mesmo cliente entra MARCADO (já na gravação); outro cliente ou outros itens, não', async () => {
    const t = await empresa();
    const u = await loja(t);
    await cardapio(t, u);
    const p1 = await deFora(t, u);
    expect(p1.repetidoDe).toBeNull();
    expect(p1.clienteId).toBeTruthy(); // o cadastro foi achado ANTES de gravar, pela regra do vínculo
    const p2 = await deFora(t, u, { itens: [batata, salada] }); // a mesma lista, em outra ordem
    expect(p2.repetidoDe).toBe(p1.id); // a marca veio na própria linha gravada — nunca num update depois
    const p3 = await deFora(t, u);
    expect(p3.repetidoDe).toBe(p1.id); // o mais antigo da janela
    expect((await deFora(t, u, { itens: [salada] })).repetidoDe).toBeNull();
    expect((await deFora(t, u, { itens: [{ ...salada, quantidade: 3 }, batata] })).repetidoDe).toBeNull();
    expect((await deFora(t, u, { tel: '21987650002', nome: 'Outra Pessoa' })).repetidoDe).toBeNull();
  });

  it('não marca: o primeiro cancelado, fora da janela (a janela da loja manda), encomenda, outra loja e o ajuste desligado', async () => {
    const t = await empresa();
    const u = await loja(t);
    const outra = await loja(t, 'Outra loja');
    const cfg = await cardapio(t, u);
    // o primeiro cancelado não conta
    const c1 = await deFora(t, u, { tel: '21987650011' });
    await q(`update pedido_externo set status = 'cancelado' where id = $1`, [c1.id]);
    expect((await deFora(t, u, { tel: '21987650011' })).repetidoDe).toBeNull();
    // fora da janela de 30 min; com a janela de 45, conta
    const j1 = await deFora(t, u, { tel: '21987650012' });
    await q(`update pedido_externo set criado_em = now() - interval '31 minutes' where id = $1`, [j1.id]);
    expect((await deFora(t, u, { tel: '21987650012' })).repetidoDe).toBeNull();
    await q(`update cardapio_config set pedido_repetido_min = 45 where id = $1`, [cfg]);
    const j3 = await deFora(t, u, { tel: '21987650012' });
    expect(j3.repetidoDe).toBe(j1.id);
    // encomenda (data marcada): nem marca, nem conta como o primeiro
    const e1 = await deFora(t, u, { tel: '21987650013', extra: { agendamento: new Date(Date.now() + 86_400_000).toISOString() } });
    expect(e1.repetidoDe).toBeNull();
    expect((await deFora(t, u, { tel: '21987650013' })).repetidoDe).toBeNull();
    // outra loja: não conta; o pedido "da rede" (sem loja) conta para todas (V4)
    await deFora(t, outra, { tel: '21987650014' });
    expect((await deFora(t, u, { tel: '21987650014' })).repetidoDe).toBeNull();
    const r1 = await deFora(t, u, { tel: '21987650015' });
    await q(`update pedido_externo set unidade_id = null where id = $1`, [r1.id]);
    expect((await deFora(t, u, { tel: '21987650015' })).repetidoDe).toBe(r1.id);
    // o cardápio e o robô já perguntaram ao cliente: a gravação não marca
    expect((await deFora(t, u, { tel: '21987650015', extra: { repetidoConferido: true } })).repetidoDe).toBeNull();
    // ajuste desligado
    await q(`update cardapio_config set pedido_repetido_ativo = false where id = $1`, [cfg]);
    expect((await deFora(t, u, { tel: '21987650015' })).repetidoDe).toBeNull();
  });

  it('iFood: o mesmo 0800 para todos — o mesmo cliente (id da plataforma) marca; outro cliente com o mesmo 0800, não', async () => {
    const t = await empresa();
    const u = await loja(t);
    await cardapio(t, u);
    const a1 = await doIfood(t, u, 'cliente-A');
    expect(a1.repetidoDe).toBeNull();
    expect((await doIfood(t, u, 'cliente-B')).repetidoDe).toBeNull();
    const a2 = await doIfood(t, u, 'cliente-A');
    expect(a2.repetidoDe).toBe(a1.id);
    // o telefone cru NÃO identifica no iFood: pela regra de telefone, os três seriam "o mesmo"
    expect(await clientePeloTelefone(db, t, '0800 705 0505')).toBeNull();
  });

  it('"São dois pedidos": a confirmação (uma, id pela chave), a auditoria, o aviso ao KDS; a fila e a lista do painel (ERR-216)', async () => {
    const t = await empresa();
    const u = await loja(t);
    await cardapio(t, u);
    const p1 = await deFora(t, u, { tel: '21987650021' });
    const [{ id: comanda }] = await q(`insert into comanda (tenant_id, unidade_id, status, total) values ($1,$2,'aberta',0) returning id`, [t, u]);
    const p2 = await deFora(t, u, { tel: '21987650021' });
    await q(`update pedido_externo set comanda_id = $2 where id = $1`, [p2.id, comanda]);
    const [{ id: cartao }] = await q(
      `insert into producao_pedido (tenant_id, unidade_id, comanda_id, senha, status, origem, numero)
       values ($1,$2,$3,130,'recebido','delivery',130) returning id`,
      [t, u, comanda],
    );
    // aberta: o KDS (pela comanda) e o painel (a rota de lista que a tela usa) mostram o aviso
    const fila: any = await producao.filaKds(t, { unidadeId: u });
    const noKds = fila.pedidos.find((x: any) => x.id === cartao);
    expect(noKds.repetido).toMatchObject({ deNumero: p1.numero });
    expect(noKds.repetido.texto).toMatch(/^Igual ao pedido #\d+ de \d\d:\d\d — confirme com o atendimento antes de fazer\.$/);
    expect((await marcaAbertaDaComanda(db, t, comanda))?.deId).toBe(p1.id);
    const lista: any[] = await delivery.listar(t, u);
    expect(lista.find((x) => x.id === p2.id).repetido).toMatchObject({ deId: p1.id, deNumero: p1.numero, ok: null });
    expect(lista.find((x) => x.id === p1.id).repetido).toBeNull();
    // confirmar: uma linha, o id pela chave (o mesmo cálculo do Postgres — a loja e a nuvem chegam ao mesmo)
    const user = { tenantId: t, colaboradorId: null, categoria: 'gerente', nome: 'Ana' } as any;
    emitidos.length = 0;
    const r: any = await delivery.confirmarRepetido(user, p2.id);
    expect(r.repetido.ok).toMatchObject({ porNome: 'Ana' });
    const [ok] = await q(`select id, md5('pedido-repetido-ok' || pedido_id::text)::uuid as pelo_banco from pedido_repetido_ok where pedido_id = $1`, [p2.id]);
    expect(ok.id).toBe(idDaConfirmacao(p2.id));
    expect(ok.id).toBe(ok.pelo_banco);
    expect(emitidos.filter((x) => x.nome === 'producao.evento' && x.e.pedidoId === cartao && x.e.tipo === 'atualizado')).toHaveLength(1);
    expect(auditados.filter((a) => a.acao === 'confirmou_pedido_repetido' && a.entidadeId === p2.id)).toHaveLength(1);
    // de novo: nada muda (nem linha, nem auditoria, nem aviso)
    await delivery.confirmarRepetido(user, p2.id);
    expect(await q(`select count(*)::int as n from pedido_repetido_ok where pedido_id = $1`, [p2.id])).toEqual([{ n: 1 }]);
    expect(auditados.filter((a) => a.acao === 'confirmou_pedido_repetido' && a.entidadeId === p2.id)).toHaveLength(1);
    // fechada: o KDS tira o aviso; o painel mostra quem confirmou
    const depois: any = await producao.filaKds(t, { unidadeId: u });
    expect(depois.pedidos.find((x: any) => x.id === cartao).repetido).toBeNull();
    expect(await marcaAbertaDaComanda(db, t, comanda)).toBeNull();
    const lista2: any[] = await delivery.listar(t, u);
    expect(lista2.find((x) => x.id === p2.id).repetido.ok).toMatchObject({ porNome: 'Ana' });
    // pedido sem a marca: recusa explicada
    await expect(delivery.confirmarRepetido(user, p1.id)).rejects.toThrow('não está marcado como possível repetido');
  });

  it('a via da cozinha sai com o aviso no ALTO enquanto a marca está aberta (antes da viagem e do número do pedido)', () => {
    const ctx = {
      tenantId: 't',
      comandaId: 'c',
      origem: 'delivery',
      plataforma: 'Anota AI',
      senhaPlataforma: '5531',
      tipoPedido: 'DELIVERY',
      pedidoNumero: 130,
      consumo: 'viagem',
      senha: 7,
      repetido: { deNumero: 127, deEm: '2026-11-03T22:46:00.000Z' },
    };
    const via: string = (producao as any).renderTicket(ctx, [{ descricao: 'X-Salada', quantidade: 2 }], 7, null);
    const linhas = via.split('\n');
    const i = linhas.findIndex((l) => l.includes('!! POSSÍVEL REPETIDO !!'));
    expect(i).toBeGreaterThanOrEqual(0);
    expect(linhas[i]).toContain('@CBD');
    expect(via).toContain('Igual ao pedido #127 de 19:46');
    expect(i).toBeLessThan(linhas.findIndex((l) => l.includes('VIAGEM')));
    expect(i).toBeLessThan(linhas.findIndex((l) => l.includes('130')));
    // sem a marca: nada do aviso
    expect((producao as any).renderTicket({ ...ctx, repetido: null }, [{ descricao: 'X-Salada', quantidade: 2 }], 7, null)).not.toContain('REPETIDO');
  });

  it('o ajuste da loja: a linha da loja (senão a da empresa); só as colunas que mudaram; quem mudou na auditoria; sem cardápio, recusa', async () => {
    const t = await empresa();
    const u = await loja(t);
    expect(await ajustes.ajustes(t, u)).toMatchObject({ ativo: true, minutos: 30, temCardapio: false });
    await expect(ajustes.salvarAjustes({ tenantId: t, colaboradorId: null, categoria: 'gerente' } as any, u, { minutos: 45 })).rejects.toThrow(
      'A loja ainda não tem cardápio online',
    );
    const daEmpresa = await cardapio(t, null, { min: 20 });
    expect(await ajustes.ajustes(t, u)).toMatchObject({ minutos: 20, temCardapio: true }); // herda da empresa
    const daLoja = await cardapio(t, u);
    expect(await ajustes.ajustes(t, u)).toMatchObject({ minutos: 30 }); // a da loja vence
    auditados.length = 0;
    await ajustes.salvarAjustes({ tenantId: t, colaboradorId: null, categoria: 'gerente' } as any, u, { minutos: 45, ativo: true });
    expect((await q(`select pedido_repetido_min, pedido_repetido_ativo from cardapio_config where id = $1`, [daLoja]))[0]).toEqual({
      pedido_repetido_min: 45,
      pedido_repetido_ativo: true,
    });
    expect((await q(`select pedido_repetido_min from cardapio_config where id = $1`, [daEmpresa]))[0].pedido_repetido_min).toBe(20);
    expect(auditados).toEqual([expect.objectContaining({ acao: 'ajustou_pedido_repetido', detalhe: { de: { minutos: 30 }, para: { minutos: 45 } } })]);
    // o que a busca usa é o mesmo ajuste: um pedido de 40 min atrás conta com a janela de 45
    const p1 = await deFora(t, u, { tel: '21987650031' });
    await q(`update pedido_externo set criado_em = now() - interval '40 minutes' where id = $1`, [p1.id]);
    expect((await deFora(t, u, { tel: '21987650031' })).repetidoDe).toBe(p1.id);
    expect(
      await procurarPedidoIgual(db, { tenantId: t, unidadeId: u, clienteId: p1.clienteId, itens: [], minutos: 45 }),
    ).toBeNull(); // sem itens nunca é "igual"
  });
});
