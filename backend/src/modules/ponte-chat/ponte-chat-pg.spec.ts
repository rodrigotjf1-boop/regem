import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { PonteChatGuard, type PonteCtx } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PONTE DO CHAT do iFood e da 99 (mig 366), contra o Postgres real: o programa da ponte pareia pela nuvem, prova quem
// é a cada chamada (com a régua de "acesso vale" — V75), diz em que plataforma está logado, traz o que chegou no chat
// (uma vez só, ligado ao pedido) e pega a fila de saída sem que duas pontes, ou duas réplicas, mandem a mesma mensagem.
// As tabelas são só da nuvem: o teste aplica as migrations (o banco do CI é o de uma loja — ERR-329).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ponte-chat-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('ponte do chat (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: async () => {} } as any;
  const equipamentos = new EquipamentoService(db, auditoria);
  const svc = new PonteChatService(db);
  const guarda = new PonteChatGuard(equipamentos);
  const T = randomUUID();
  const T2 = randomUUID();
  let lojaA: string;
  let lojaB: string;
  let gerente: string;
  let delivery: { id: string; segredo: string };
  let servidor: { id: string; segredo: string };
  let pdvB: { id: string; segredo: string };

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

  // O caminho do dono: Configurações › Equipamentos › Novo equipamento "Ponte do chat" › Gerar código; o programa da
  // ponte digita o código ("Parear este PC").
  async function ponteNova(tenant: string, unidadeId: string, nome: string) {
    const criado = await equipamentos.criar(tenant, gerente, 'gerente', { tipo: 'ponte_chat', nome, unidadeId } as any);
    expect(criado).toMatchObject({ tipo: 'ponte_chat', pareado: false });
    const { codigo, onde } = await equipamentos.gerarCodigo(tenant, criado.id, gerente, 'gerente');
    expect(onde?.titulo).toBe('No PC, no programa Regem · Ponte do chat');
    const p = await equipamentos.parearPorCodigo(codigo, `PC ${nome}`, 'ponte_chat');
    return { id: p.terminalId as string, segredo: p.segredo as string };
  }
  // A guarda de verdade, como a rota faz: devolve a ponte (ou a recusa dela).
  const entrar = async (p: { id: string; segredo: string }): Promise<PonteCtx> => {
    const req: any = { headers: { 'x-terminal-id': p.id, 'x-terminal-secret': p.segredo } };
    await guarda.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req.ponteChat;
  };
  const erro = (p: Promise<unknown>) => p.then(() => null, (e: any) => e);
  const logada = (ifood: boolean, n99 = false) => ({ plataformas: { ifood: { logado: ifood }, '99food': { logado: n99 } }, versao: '1.0.0', maquina: 'CX-DELIVERY' });
  const ligar = (v: boolean, tenant = T) =>
    q(`insert into robo_config (tenant_id, chat_ponte_ligada) values ($1, $2) on conflict (tenant_id) do update set chat_ponte_ligada = $2`, [tenant, v]);
  async function pedido(unidadeId: string, o: { canal?: string; ext?: string; num?: string; diasAtras?: number } = {}) {
    return (
      await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, numero, tipo, status, cliente_nome, total, criado_em)
         values ($1,$2,$3,$4,$5,(floor(random()*90000)+10000)::int,'entrega','despachado','Maria S.',50, now() - make_interval(days => $6::int))
         returning id`,
        [T, unidadeId, o.canal ?? 'ifood', o.ext ?? `ext-${randomUUID()}`, o.num ?? String(1000 + Math.floor(Math.random() * 8999)), o.diasAtras ?? 0],
      )
    )[0].id as string;
  }
  async function saida(unidadeId: string | null, o: { canal?: string; texto?: string; minAtras?: number; pedidoId?: string | null } = {}) {
    return (
      await q(
        `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_id, pedido_numero, cliente_nome, direcao, autor, texto, estado, criado_em)
         values ($1,$2,$3,$4,'4821','Maria S.','saida','equipe',$5,'pendente', now() - make_interval(mins => $6::int)) returning id`,
        [T, unidadeId, o.canal ?? 'ifood', o.pedidoId ?? null, o.texto ?? `Oi ${randomUUID().slice(0, 6)}`, o.minAtras ?? 0],
      )
    )[0].id as string;
  }
  const msg = async (id: string) => (await q(`select * from chat_plataforma_msg where id = $1`, [id]))[0];

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql', '368_ponte_pausada.sql']) await aplicar(m);
    for (const t of [T, T2]) await q(`insert into empresa (id, nome) values ($1, 'teste ponte do chat')`, [t]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    [{ id: gerente }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Ana', $2, 'ativo') returning id`, [T, lojaA]);
    delivery = await ponteNova(T, lojaA, 'Ponte do delivery');
    servidor = await ponteNova(T, lojaA, 'Ponte do servidor');
    pdvB = await ponteNova(T, lojaB, 'Ponte da loja B');
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    await q(`delete from chat_plataforma_msg where tenant_id = $1`, [T]);
    await q(`update chat_ponte set papel = 'auto', visto_em = now() - interval '1 hour', pausada_em = null where tenant_id = $1`, [T]);
    await ligar(true);
  });
  afterAll(async () => {
    delete process.env.EDGE_MODE;
    for (const t of [T, T2]) {
      for (const tab of ['atendimento_chamado', 'chat_plataforma_msg', 'chat_ponte', 'robo_config', 'pedido_externo', 'equipamento', 'colaborador', 'unidade'])
        await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });

  it('pareia só pela nuvem: no servidor da loja, cadastrar código da ponte é recusado', async () => {
    const criado = await equipamentos.criar(T, gerente, 'gerente', { tipo: 'ponte_chat', nome: 'Ponte nova', unidadeId: lojaA } as any);
    process.env.EDGE_MODE = 'true';
    try {
      expect((await erro(equipamentos.gerarCodigo(T, criado.id, gerente, 'gerente')))?.message).toMatch(/A ponte do chat só se cadastra e se pareia pela nuvem/);
    } finally {
      delete process.env.EDGE_MODE;
    }
    await q(`delete from equipamento where id = $1`, [criado.id]);
  });

  it('a guarda: segredo errado não é reconhecido; revogada, loja apagada ou empresa apagada param a ponte (V75)', async () => {
    expect(await entrar(delivery)).toMatchObject({ id: delivery.id, tenantId: T, unidadeId: lojaA });
    expect((await erro(entrar({ id: delivery.id, segredo: 'errado' })))?.response?.code).toBe('TERMINAL_NAO_RECONHECIDO');
    expect((await erro(entrar({ id: randomUUID(), segredo: 'x' })))?.response?.code).toBe('TERMINAL_NAO_RECONHECIDO');
    // o celular do app de atendimento não entra pela rota da ponte (tipo errado)
    // revogada
    const extra = await ponteNova(T, lojaA, 'Ponte que vai ser revogada');
    await q(`update equipamento set revogado_em = now() where id = $1`, [extra.id]);
    expect((await erro(entrar(extra)))?.response?.code).toBe('TERMINAL_REVOGADO');
    // loja apagada: a ponte para (e é "revogada" para o programa esquecer o pareamento)
    const [{ id: lojaC }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja C') returning id`, [T]);
    const daC = await ponteNova(T, lojaC, 'Ponte da loja C');
    expect(await entrar(daC)).toMatchObject({ unidadeId: lojaC });
    await q(`update unidade set deleted_at = now() where id = $1`, [lojaC]);
    const recusa = await erro(entrar(daC));
    expect(recusa?.response).toMatchObject({ code: 'TERMINAL_REVOGADO', message: 'A loja desta ponte não existe mais no Regem. A ponte parou.' });
    // empresa apagada
    const [{ id: lojaT2 }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja T2') returning id`, [T2]);
    const [{ id: g2 }] = await q(`insert into colaborador (tenant_id, nome, unidade_id, status) values ($1, 'Bia', $2, 'ativo') returning id`, [T2, lojaT2]);
    const criado2 = await equipamentos.criar(T2, g2, 'gerente', { tipo: 'ponte_chat', nome: 'Ponte T2', unidadeId: lojaT2 } as any);
    const { codigo } = await equipamentos.gerarCodigo(T2, criado2.id, g2, 'gerente');
    const p2 = await equipamentos.parearPorCodigo(codigo, 'PC T2', 'ponte_chat');
    await q(`update empresa set deleted_at = now() where id = $1`, [T2]);
    expect((await erro(entrar({ id: p2.terminalId, segredo: p2.segredo })))?.response?.code).toBe('TERMINAL_REVOGADO');
  });

  it('sinal de vida: grava as plataformas; a ponte diz o papel por canal (pareada primeiro responde; principal dos ajustes vence)', async () => {
    const d = await entrar(delivery);
    const s = await entrar(servidor);
    expect(await svc.estado(d, logada(true))).toEqual({ ligada: true, canais: { ifood: 'responde', '99food': 'fora' } });
    expect(await svc.estado(s, logada(true))).toEqual({ ligada: true, canais: { ifood: 'reserva', '99food': 'fora' } });
    const [cp] = await q(`select plataformas, versao, maquina, unidade_id from chat_ponte where equipamento_id = $1`, [delivery.id]);
    expect(cp).toEqual({ plataformas: { ifood: { logado: true }, '99food': { logado: false } }, versao: '1.0.0', maquina: 'CX-DELIVERY', unidade_id: lojaA });
    // a principal escolhida nos ajustes passa a responder
    await q(`update chat_ponte set papel = 'principal' where equipamento_id = $1`, [servidor.id]);
    expect((await svc.estado(s, logada(true))).canais.ifood).toBe('responde');
    expect((await svc.estado(d, logada(true))).canais.ifood).toBe('reserva');
    // a 99 (um login só): quem estiver logado nela responde
    expect((await svc.estado(d, logada(true, true))).canais['99food']).toBe('responde');
    // a loja B é outra conta: a ponte dela responde pela loja dela
    expect((await svc.estado(await entrar(pdvB), logada(true))).canais.ifood).toBe('responde');
    // desligada nos ajustes: a ponte sabe
    await ligar(false);
    expect((await svc.estado(d, logada(true))).ligada).toBe(false);
  });

  it('mensagens do chat: entram uma vez só, ligadas ao pedido pelo id ou pelo número; o que não serve é recusado', async () => {
    const d = await entrar(delivery);
    const ped = await pedido(lojaA, { ext: 'ifood-abc', num: '4821' });
    const pedNum = await pedido(lojaA, { ext: 'ifood-def', num: '7777' });
    await pedido(lojaA, { ext: 'ifood-velho', num: '7777', diasAtras: 5 }); // o mesmo número, de 5 dias atrás: não é este
    await pedido(lojaA, { ext: 'ifood-so-velho', num: '5555', diasAtras: 5 }); // só existe um de 5 dias atrás: não liga
    const r1 = await svc.receber(d, {
      mensagens: [
        { canal: 'ifood', id: 'sb-1', pedido: { externo: 'ifood-abc' }, cliente: 'Maria S.', autor: 'cliente', texto: 'Cadê meu pedido?' },
        { canal: 'ifood', id: 'sb-2', pedido: { numero: '7777' }, cliente: 'João', autor: 'cliente', texto: 'Oi' },
        { canal: 'ifood', id: 'sb-3', pedido: { externo: 'nao-existe' }, autor: 'cliente', texto: 'Sem pedido' },
        { canal: 'ifood', id: 'sb-6', pedido: { numero: '5555' }, autor: 'cliente', texto: 'Número de um pedido antigo' },
        { canal: 'rappi', id: 'x', autor: 'cliente', texto: 'canal errado' },
        { canal: 'ifood', id: '', autor: 'cliente', texto: 'sem id' },
        { canal: 'ifood', id: 'sb-4', autor: 'cliente', texto: '   ' },
        { canal: 'ifood', id: 'sb-5', autor: 'robo', texto: 'autor errado' },
      ],
    });
    // Etapa 2: cada conversa nova do cliente abre o seu caso na fila do Atendimento (as 4 — a conversa é a chave do pedido).
    expect(r1).toEqual({ recebidas: 4, repetidas: 0, recusadas: 4, casosNovos: 4, casosSomados: 0 });
    // a ponte reenvia (sem resposta) e a outra ponte lê o mesmo chat: não entra de novo (nem soma no caso)
    const r2 = await svc.receber(await entrar(servidor), {
      mensagens: [{ canal: 'ifood', id: 'sb-1', pedido: { externo: 'ifood-abc' }, autor: 'cliente', texto: 'Cadê meu pedido?' }],
    });
    expect(r2).toEqual({ recebidas: 0, repetidas: 1, recusadas: 0, casosNovos: 0, casosSomados: 0 });
    const linhas = await q(`select externo_msg_id, pedido_id, unidade_id, direcao, autor, estado, cliente_nome from chat_plataforma_msg where tenant_id = $1 order by externo_msg_id`, [T]);
    expect(linhas).toEqual([
      { externo_msg_id: 'sb-1', pedido_id: ped, unidade_id: lojaA, direcao: 'entrada', autor: 'cliente', estado: 'recebida', cliente_nome: 'Maria S.' },
      { externo_msg_id: 'sb-2', pedido_id: pedNum, unidade_id: lojaA, direcao: 'entrada', autor: 'cliente', estado: 'recebida', cliente_nome: 'João' },
      { externo_msg_id: 'sb-3', pedido_id: null, unidade_id: lojaA, direcao: 'entrada', autor: 'cliente', estado: 'recebida', cliente_nome: null },
      { externo_msg_id: 'sb-6', pedido_id: null, unidade_id: lojaA, direcao: 'entrada', autor: 'cliente', estado: 'recebida', cliente_nome: null },
    ]);
    // lote grande demais
    const muitas = Array.from({ length: 51 }, (_, i) => ({ canal: 'ifood', id: `m${i}`, autor: 'cliente', texto: 'x' }));
    expect((await erro(svc.receber(d, { mensagens: muitas })))?.message).toBe('No máximo 50 mensagens por vez.');
    // ponte DESLIGADA nos ajustes: nada de conversa de cliente gravada; a resposta avisa a ponte
    await ligar(false);
    expect(await svc.receber(d, { mensagens: [{ canal: 'ifood', id: 'sb-7', autor: 'cliente', texto: 'Com a ponte desligada' }] })).toEqual({
      recebidas: 0,
      repetidas: 0,
      recusadas: 0,
      desligada: true,
    });
    expect(await q(`select count(*)::int as n from chat_plataforma_msg where tenant_id = $1 and externo_msg_id = 'sb-7'`, [T])).toEqual([{ n: 0 }]);
  });

  it('um lote de falas sai na ordem em que a ponte mandou: a hora de cada linha cresce (não é a da transação — ERR-379)', async () => {
    const d = await entrar(delivery);
    await pedido(lojaA, { ext: 'ifood-lote', num: '6161' });
    const falas = ['Oi', 'Meu pedido veio sem o molho', 'E o refrigerante veio quente', 'Alguém aí?'];
    await svc.receber(d, {
      mensagens: falas.map((texto, i) => ({ canal: 'ifood', id: `lote-${i}-${randomUUID().slice(0, 6)}`, pedido: { externo: 'ifood-lote' }, cliente: 'Maria S.', autor: 'cliente', texto })),
    });
    const linhas = await q(
      `select texto, criado_em > lag(criado_em) over (order by criado_em, id) as depois
         from chat_plataforma_msg where tenant_id = $1 and pedido_externo = 'ifood-lote' order by criado_em, id`,
      [T],
    );
    expect(linhas.map((l: any) => l.texto)).toEqual(falas);
    expect(linhas.slice(1).map((l: any) => l.depois)).toEqual([true, true, true]); // nenhuma hora repetida
  });

  it('pausada no PC (mig 368): não responde nem é reserva, a reserva assume e pega a fila; a hora fica a do 1º sinal; sem "pausada" retoma', async () => {
    const d = await entrar(delivery);
    const s = await entrar(servidor);
    expect((await svc.estado(d, logada(true))).canais.ifood).toBe('responde');
    expect((await svc.estado(s, logada(true))).canais.ifood).toBe('reserva');
    // pausa o PC do delivery: ele diz "fora" em tudo (logado no iFood lá dentro — não é "sem login")
    expect(await svc.estado(d, { ...logada(true, true), pausada: true })).toEqual({ ligada: true, canais: { ifood: 'fora', '99food': 'fora' } });
    const [p1] = await q(`select pausada_em, plataformas from chat_ponte where equipamento_id = $1`, [delivery.id]);
    expect(p1.pausada_em).toBeTruthy();
    expect(p1.plataformas.ifood).toEqual({ logado: true });
    // a reserva passa a responder e pega a fila; a pausada não pega nada
    expect((await svc.estado(s, logada(true))).canais.ifood).toBe('responde');
    const id = await saida(lojaA);
    expect((await svc.pegar(d, { canal: 'ifood' })).itens).toEqual([]);
    expect((await svc.pegar(s, { canal: 'ifood' })).itens.map((i: any) => i.id)).toEqual([id]);
    // o 2º sinal pausado mantém a hora do 1º (a tela diz "pausada desde")
    await q(`update chat_ponte set pausada_em = pausada_em - interval '10 minutes' where equipamento_id = $1`, [delivery.id]);
    const [{ pausada_em: antes }] = await q(`select pausada_em from chat_ponte where equipamento_id = $1`, [delivery.id]);
    await svc.estado(d, { ...logada(true), pausada: true });
    const [{ pausada_em: depois }] = await q(`select pausada_em from chat_ponte where equipamento_id = $1`, [delivery.id]);
    expect(new Date(depois).getTime()).toBe(new Date(antes).getTime());
    // só `true` pausa (V15): "sim" ou 1 não é pausa
    expect((await svc.estado(d, { ...logada(true), pausada: 'sim' })).canais.ifood).not.toBe('fora');
    // retomada: o sinal sem `pausada` limpa a hora e a ponte volta à vez dela (pareada primeiro responde)
    expect((await svc.estado(d, logada(true))).canais.ifood).toBe('responde');
    expect((await q(`select pausada_em from chat_ponte where equipamento_id = $1`, [delivery.id]))[0].pausada_em).toBeNull();
    // a ponte nova que já nasce pausada (1º sinal pausado) também fica anotada
    const nova = await ponteNova(T, lojaA, 'Ponte que nasce pausada');
    expect(await svc.estado(await entrar(nova), { ...logada(true), pausada: true })).toEqual({ ligada: true, canais: { ifood: 'fora', '99food': 'fora' } });
    expect((await q(`select pausada_em from chat_ponte where equipamento_id = $1`, [nova.id]))[0].pausada_em).toBeTruthy();
    await q(`delete from equipamento where id = $1`, [nova.id]);
  });

  it('fila de saída: só quem responde pega; duas chamadas juntas nunca pegam a mesma; a loja B não pega a da loja A', async () => {
    const d = await entrar(delivery);
    const s = await entrar(servidor);
    const b = await entrar(pdvB);
    for (const p of [d, s, b]) await svc.estado(p, logada(true));
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push(await saida(lojaA, { minAtras: 6 - i }));
    const daB = await saida(lojaB);
    expect(await svc.pegar(s, { canal: 'ifood' })).toEqual({ papel: 'reserva', itens: [] });
    // duas réplicas atendendo a mesma ponte ao mesmo tempo: as mensagens se dividem, nenhuma repete
    const [x, y] = await Promise.all([svc.pegar(d, { canal: 'ifood' }), svc.pegar(d, { canal: 'ifood' })]);
    const pegas = [...x.itens, ...y.itens].map((i: any) => i.id);
    expect(new Set(pegas).size).toBe(pegas.length);
    expect(pegas.sort()).toEqual([...ids].sort());
    expect(x.itens.every((i: any) => i.cliente === 'Maria S.' && i.pedidoNumero === '4821')).toBe(true);
    // a da loja B fica para a ponte da loja B
    expect((await svc.pegar(b, { canal: 'ifood' })).itens.map((i: any) => i.id)).toEqual([daB]);
    // a 99 sem ponte logada nela: ninguém responde
    expect(await svc.pegar(d, { canal: '99food' })).toEqual({ papel: 'fora', itens: [] });
    expect((await erro(svc.pegar(d, { canal: 'rappi' })))?.message).toBe('Canal inválido: use "ifood" ou "99food".');
  });

  it('prazo vencido volta para a fila; na 3ª tentativa falha; mensagem de mais de 30 min não sai mais; desligada não sai nada', async () => {
    const d = await entrar(delivery);
    await svc.estado(d, logada(true));
    const id = await saida(lojaA);
    const velha = await saida(lojaA, { minAtras: 31 });
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const r = await svc.pegar(d, { canal: 'ifood' });
      expect(r.itens.map((i: any) => i.id)).toEqual([id]);
      expect(await msg(id)).toMatchObject({ estado: 'enviando', tentativas: tentativa, ponte_id: delivery.id });
      await q(`update chat_plataforma_msg set vence_em = now() - interval '1 second' where id = $1`, [id]); // a ponte sumiu
    }
    expect(await svc.pegar(d, { canal: 'ifood' })).toEqual({ papel: 'responde', itens: [] });
    expect(await msg(id)).toMatchObject({ estado: 'falhou', erro: 'a ponte não confirmou o envio', ponte_id: null });
    expect(await msg(velha)).toMatchObject({ estado: 'cancelada', erro: 'passou da hora: não saiu em 30 min' });
    await saida(lojaA);
    await ligar(false);
    expect(await svc.pegar(d, { canal: 'ifood' })).toEqual({ papel: 'desligada', itens: [] });
  });

  it('resultado: enviada guarda o id e tira o eco; não enviada volta; de outra ponte é recusado; enviada depois do prazo ainda vale', async () => {
    const d = await entrar(delivery);
    const s = await entrar(servidor);
    await svc.estado(d, logada(true));
    await svc.estado(s, logada(true));
    const id = await saida(lojaA, { texto: 'Seu pedido saiu' });
    await svc.pegar(d, { canal: 'ifood' });
    // a ponte já trouxe o próprio envio como mensagem da loja (o eco) antes de confirmar
    await svc.receber(d, { mensagens: [{ canal: 'ifood', id: 'sb-99', autor: 'loja', texto: 'Seu pedido saiu' }] });
    expect(await svc.resultado(d, id, { ok: true, id: 'sb-99' })).toEqual({ ok: true, estado: 'enviada' });
    expect(await msg(id)).toMatchObject({ estado: 'enviada', externo_msg_id: 'sb-99', erro: null });
    expect((await q(`select count(*)::int n from chat_plataforma_msg where tenant_id = $1 and externo_msg_id = 'sb-99'`, [T]))[0].n).toBe(1);
    // o eco que chega depois também não entra de novo
    expect(await svc.receber(d, { mensagens: [{ canal: 'ifood', id: 'sb-99', autor: 'loja', texto: 'Seu pedido saiu' }] })).toEqual({
      recebidas: 0,
      repetidas: 1,
      recusadas: 0,
      casosNovos: 0,
      casosSomados: 0,
    });
    // não enviada: volta para a fila; definitiva (o chat fechou): falha
    const id2 = await saida(lojaA);
    await svc.pegar(d, { canal: 'ifood' });
    expect((await erro(svc.resultado(s, id2, { ok: false, erro: 'x' })))?.status).toBe(409);
    expect(await svc.resultado(d, id2, { ok: false, erro: 'o campo de texto não apareceu' })).toEqual({ ok: true, estado: 'pendente' });
    await svc.pegar(d, { canal: 'ifood' });
    expect(await svc.resultado(d, id2, { ok: false, erro: 'o chat deste pedido fechou', definitivo: true })).toEqual({ ok: true, estado: 'falhou' });
    expect(await msg(id2)).toMatchObject({ erro: 'o chat deste pedido fechou' });
    // enviada que chega depois do prazo (a mensagem já voltou para a fila): marca enviada — não sai de novo
    const id3 = await saida(lojaA);
    await svc.pegar(d, { canal: 'ifood' });
    await q(`update chat_plataforma_msg set vence_em = now() - interval '1 second' where id = $1`, [id3]);
    await svc.pegar(d, { canal: 'ifood' }); // devolve e pega de novo
    await q(`update chat_plataforma_msg set estado = 'pendente', ponte_id = null, vence_em = null where id = $1`, [id3]);
    expect(await svc.resultado(d, id3, { ok: true, id: 'sb-100' })).toEqual({ ok: true, estado: 'enviada' });
    expect(await svc.pegar(d, { canal: 'ifood' })).toEqual({ papel: 'responde', itens: [] });
    // a mesma confirmação de novo (a ponte repete o que não teve resposta): igual, sem erro e sem mexer
    expect(await svc.resultado(d, id3, { ok: true, id: 'sb-100' })).toEqual({ ok: true, estado: 'enviada' });
    // id inválido
    expect((await erro(svc.resultado(d, 'nao-e-uuid', { ok: true })))?.message).toBe('Mensagem inválida.');
  });

  it('enviada que chega depois de a nuvem dar a mensagem como falha ou cancelada vale: o registro fica com a verdade', async () => {
    const d = await entrar(delivery);
    await svc.estado(d, logada(true));
    // falhou (a 3ª tentativa venceu o prazo) e cancelada (passou de 30 min na fila) — mas a ponte tinha digitado
    const falhou = await saida(lojaA, { texto: 'Seu pedido saiu' });
    const cancelada = await saida(lojaA, { texto: 'O entregador está chegando' });
    await q(`update chat_plataforma_msg set estado = 'falhou', erro = 'a ponte não confirmou o envio', tentativas = 3 where id = $1`, [falhou]);
    await q(`update chat_plataforma_msg set estado = 'cancelada', erro = 'passou da hora: não saiu em 30 min' where id = $1`, [cancelada]);
    expect(await svc.resultado(d, falhou, { ok: true, id: 'sb-tarde-1' })).toEqual({ ok: true, estado: 'enviada' });
    expect(await svc.resultado(d, cancelada, { ok: true, id: 'sb-tarde-2' })).toEqual({ ok: true, estado: 'enviada' });
    expect(await msg(falhou)).toMatchObject({ estado: 'enviada', erro: null, externo_msg_id: 'sb-tarde-1' });
    expect(await msg(cancelada)).toMatchObject({ estado: 'enviada', erro: null, externo_msg_id: 'sb-tarde-2' });
    // "não enviada" para uma falha antiga continua recusado (não é desta ponte agora)
    const outra = await saida(lojaA);
    await q(`update chat_plataforma_msg set estado = 'falhou' where id = $1`, [outra]);
    expect((await erro(svc.resultado(d, outra, { ok: false, erro: 'x' })))?.status).toBe(409);
    // e a mensagem que não existe continua 409 também quando "enviada"
    expect((await erro(svc.resultado(d, '00000000-0000-4000-8000-000000000000', { ok: true, id: 'sb-x' })))?.status).toBe(409);
  });
});
