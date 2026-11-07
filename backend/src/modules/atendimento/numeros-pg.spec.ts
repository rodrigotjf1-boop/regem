import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AtendimentoService } from './atendimento.service';
import { NumerosDoAtendimentoService } from './numeros.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// NÚMEROS DO ATENDIMENTO (item 8), contra o Postgres real: o placar do chat (uma consulta por janela — a mensagem que
// espera, respondida pela equipe, pelo robô ou direto no Gestor; o aviso automático não responde; o envio que falhou não
// responde; o que espera há pouco fica fora), a loja em uso (a outra loja fora, o caso sem loja dentro, o presidente vê
// tudo), o mês no relógio da operação com a sessão do banco em outro fuso (ERR-120), o custo pelo pedido, o "O que
// aconteceu?" (recusado antes de gravar — V86; só a chave dele — V82; limpar) e o servidor da loja pedindo à nuvem (V37).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('numeros-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('números do atendimento (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let T: string;
  let T2: string;
  let lojaA: string;
  let lojaB: string;
  let svc: NumerosDoAtendimentoService;
  let atend: AtendimentoService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const minAtras = (n: number) => new Date(Date.now() - n * 60_000).toISOString();
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
  const msg = (o: { canal?: string; pedido: string; autor: string; direcao?: string; estado?: string; min: number; unidade?: string | null; motivo?: string | null; tenant?: string }) =>
    q(
      `insert into chat_plataforma_msg (tenant_id, unidade_id, canal, pedido_externo, direcao, autor, motivo, texto, estado, criado_em, enviado_em)
       values ($1, $2, $3, $4, $5, $6, $7, 'oi', $8, $9::timestamptz, case when $5 = 'saida' and $8 = 'enviada' then $9::timestamptz end)`,
      [
        o.tenant ?? T,
        o.unidade === undefined ? lojaA : o.unidade,
        o.canal ?? 'ifood',
        o.pedido,
        o.direcao ?? (o.autor === 'cliente' || o.autor === 'loja' ? 'entrada' : 'saida'),
        o.autor,
        o.motivo ?? null,
        o.estado ?? (o.autor === 'cliente' || o.autor === 'loja' ? 'recebida' : 'enviada'),
        minAtras(o.min),
      ],
    );
  const chamado = async (o: Record<string, any> = {}) =>
    (
      await q(
        `insert into atendimento_chamado (tenant_id, unidade_id, tipo, canal, cliente, pedido_id, pedido_numero, status, decisao, criado_em,
                                          pego_em, resolvido_em, resolvido_por_id, prazo_em, detalhe)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, coalesce($10::timestamptz, now()), $11, $12, $13, $14, $15::jsonb) returning id`,
        [
          o.tenant ?? T,
          o.unidade === undefined ? lojaA : o.unidade,
          o.tipo ?? 'humano',
          o.canal ?? 'whatsapp',
          o.cliente ?? 'Carlos Alberto',
          o.pedido ?? null,
          o.numero ?? '1180',
          o.status ?? 'resolvido',
          o.decisao ?? null,
          o.criado ?? null,
          o.pego ?? null,
          o.resolvido ?? null,
          o.resolvidoPor ?? null,
          o.prazo ?? null,
          o.detalhe ? JSON.stringify(o.detalhe) : null,
        ],
      )
    )[0].id as string;
  const limpar = async () => {
    for (const t of [T, T2]) {
      await q(`delete from chat_plataforma_msg where tenant_id = $1`, [t]);
      await q(`delete from atendimento_chamado where tenant_id = $1`, [t]);
    }
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['342_robo_pausa_e_config.sql', '366_ponte_do_chat.sql', '367_chat_ordem_e_indices.sql', '377_instagram_direct.sql', '378_instagram_robo_no_direct.sql']) await aplicar(m);
    [{ id: T }] = await q(`insert into empresa (nome) values ('teste números') returning id`);
    [{ id: T2 }] = await q(`insert into empresa (nome) values ('outra empresa') returning id`);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    svc = new NumerosDoAtendimentoService(db);
    atend = new AtendimentoService(db, { emit: () => true } as any, {} as any);
  });
  afterAll(async () => {
    if (!pool) return;
    await limpar().catch(() => {});
    for (const t of [T, T2]) {
      await q(`delete from pedido_externo where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from unidade where tenant_id = $1`, [t]).catch(() => {});
      await q(`delete from empresa where id = $1`, [t]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(async () => {
    delete process.env.EDGE_MODE;
    await limpar();
  });

  it('o placar do chat: a mensagem que espera, quem responde, o aviso que não responde e o que ainda espera', async () => {
    // Conversa 1 (iFood): duas mensagens seguidas = UMA que espera; a equipe responde em 3 min.
    await msg({ pedido: 'p1', autor: 'cliente', min: 60 });
    await msg({ pedido: 'p1', autor: 'cliente', min: 59 });
    await msg({ pedido: 'p1', autor: 'equipe', min: 57 });
    // ... o cliente volta; o aviso "saiu" NÃO responde; alguém responde direto no Gestor (lido pela ponte) 5 min depois.
    await msg({ pedido: 'p1', autor: 'cliente', min: 50 });
    await msg({ pedido: 'p1', autor: 'aviso', motivo: 'saiu', min: 49 });
    await msg({ pedido: 'p1', autor: 'loja', min: 45 });
    // Conversa 2: o robô responde em 1 min.
    await msg({ pedido: 'p2', autor: 'cliente', min: 40 });
    await msg({ pedido: 'p2', autor: 'robo', min: 39 });
    // Conversa 3: o envio da equipe FALHOU — não respondeu; há 30 min: sem resposta.
    await msg({ pedido: 'p3', autor: 'cliente', min: 30 });
    await msg({ pedido: 'p3', autor: 'equipe', estado: 'falhou', min: 29 });
    // Conversa 4: escreveu há 5 min — ainda espera, fica fora.
    await msg({ pedido: 'p4', autor: 'cliente', min: 5 });
    // Conversa sem loja (entra) e da loja B (não entra); outra empresa (não entra).
    await msg({ pedido: 'p5', autor: 'cliente', min: 20, unidade: null });
    await msg({ pedido: 'p6', autor: 'cliente', min: 20, unidade: lojaB });
    await msg({ pedido: 'p7', autor: 'cliente', min: 20, tenant: T2, unidade: null });
    // 99: uma respondida em 2 min.
    await msg({ canal: '99food', pedido: 'n1', autor: 'cliente', min: 15 });
    await msg({ canal: '99food', pedido: 'n1', autor: 'equipe', min: 13 });

    const r: any = await svc.numeros(T, lojaA, '7');
    const ifood = r.canais.find((c: any) => c.k === 'chat-ifood');
    // esperam: p1 (2×), p2, p3, p5 = 5; respondidas: p1 (180 s e 300 s), p2 (60 s) = 3 → média 180 s
    expect(ifood).toMatchObject({ chegaram: 5, respondidas: 3, semResposta: 2, segMedio: 180 });
    expect(r.canais.find((c: any) => c.k === 'chat-99')).toMatchObject({ chegaram: 1, respondidas: 1, segMedio: 120 });
    // O presidente em "todas as lojas": a da loja B entra.
    const todas: any = await svc.numeros(T, null, '7');
    expect(todas.canais.find((c: any) => c.k === 'chat-ifood').chegaram).toBe(6);
  });

  it('os casos: a loja em uso (sem loja dentro, a outra fora), o motivo marcado e o custo pelo pedido', async () => {
    const [{ id: ped }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, tipo, status, cliente_nome, total, itens)
       values ($1, $2, '99food', $3, '77', 'entrega', 'cancelado', 'Marina S.', 42.5, '[{"descricao":"Açaí 500 ml","quantidade":1}]'::jsonb) returning id`,
      [T, lojaA, `n99-${randomUUID()}`],
    );
    await chamado({ tipo: 'cancelamento_99', canal: '99food', pedido: ped, decisao: 'aceito', criado: minAtras(90), detalhe: { resposta: { em: minAtras(88) }, classificacao: { motivo: 'atraso', produtos: [] } } });
    await chamado({ tipo: 'humano', criado: minAtras(80), pego: minAtras(78), detalhe: { classificacao: { motivo: 'frio', produtos: ['x-burguer  DUPLO'] } } });
    await chamado({ tipo: 'humano', unidade: null, criado: minAtras(70), pego: minAtras(66), detalhe: { classificacao: { motivo: 'frio', produtos: ['X-Burguer duplo'] } } });
    await chamado({ tipo: 'humano', unidade: lojaB, criado: minAtras(60), detalhe: { classificacao: { motivo: 'qualidade', produtos: ['Pizza'] } } });
    await chamado({ tipo: 'humano', tenant: T2, unidade: null, criado: minAtras(60), detalhe: { classificacao: { motivo: 'entregador' } } });

    const r: any = await svc.numeros(T, lojaA, '30');
    expect(r.motivos.map((m: any) => [m.k, m.casos, m.centavos])).toEqual([
      ['frio', 2, 0],
      ['atraso', 1, 4250],
    ]);
    expect(r.produtos).toEqual([{ nome: 'X-Burguer duplo', casos: 2, centavos: 0, motivos: [{ k: 'frio', nome: 'Chegou frio', casos: 2 }] }]);
    expect(r.custou).toMatchObject({ centavos: 4250, casos: 1 });
    expect(r.canais.find((c: any) => c.k === 'casos')).toMatchObject({ chegaram: 2, respondidas: 2, segMedio: 180 });
    expect(r.canais.find((c: any) => c.k === 'pedido99')).toMatchObject({ chegaram: 1, respondidas: 1, segMedio: 120 });
    expect(r.parcial).toBe(false);
    expect(r.motivosDaLista).toHaveLength(10);
    // O presidente em todas as lojas vê a qualidade da loja B; a outra empresa nunca.
    const todas: any = await svc.numeros(T, null, '30');
    expect(todas.motivos.map((m: any) => m.k).sort()).toEqual(['atraso', 'frio', 'qualidade']);
    // A gaveta do produto.
    const g: any = await svc.casos(T, lojaA, { periodo: '30', produto: 'X-BURGUER DUPLO' });
    expect(g.total).toBe(2);
    expect(g.casos[0]).toMatchObject({ titulo: 'Carlos · pedido 1180', fonte: 'equipe', motivo: 'frio' });
    await expect(svc.casos(T, lojaA, { periodo: '30' })).rejects.toThrow('Escolha um motivo ou um produto.');
  });

  it('o mês é o do relógio da operação, mesmo com a sessão do banco em outro fuso (ERR-120)', async () => {
    const [{ inicio }] = await q(`select (date_trunc('month', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo') as inicio`);
    const dentro = new Date(new Date(inicio).getTime() + 1000).toISOString(); // 1º do mês, 00:00:01 em Brasília
    const antes = new Date(new Date(inicio).getTime() - 30 * 60_000).toISOString(); // último dia do mês passado, 23:30
    await chamado({ criado: dentro, detalhe: { classificacao: { motivo: 'atraso' } } });
    await chamado({ criado: antes, detalhe: { classificacao: { motivo: 'cobranca' } } });
    const tokio = new Pool({ connectionString: URL_PG, options: '-c timezone=Asia/Tokyo' });
    try {
      const outro = new NumerosDoAtendimentoService(drizzle(tokio, { schema }) as any);
      const mes: any = await outro.numeros(T, lojaA, 'mes');
      const ant: any = await outro.numeros(T, lojaA, 'ant');
      if (Date.now() > new Date(dentro).getTime()) expect(mes.motivos.map((m: any) => m.k)).toEqual(['atraso']);
      expect(ant.motivos.map((m: any) => m.k)).toEqual(['cobranca']);
      expect(new Date(ant.periodo.ate).getTime()).toBe(new Date(inicio).getTime());
    } finally {
      await tokio.end();
    }
  });

  it('resolver com "O que aconteceu?": o inválido é recusado ANTES de gravar; o válido grava só a chave dele', async () => {
    const id = await chamado({ tipo: 'disputa', canal: 'ifood', status: 'aberto', detalhe: { disputa: { acao: 'CANCELLATION', tipo: 'AFTER_DELIVERY' }, plataforma: 'ifood' } });
    await expect(atend.resolver(T, id, randomUUID(), { oQueAconteceu: { motivo: 'atraso', produtos: ['Pizza'] } }, 'Ana')).rejects.toThrow('não pede o produto');
    expect((await q(`select status from atendimento_chamado where id = $1`, [id]))[0].status).toBe('aberto');
    const ana = randomUUID();
    await atend.resolver(T, id, ana, { oQueAconteceu: { motivo: 'faltou', produtos: ['Batata média'] } }, 'Ana');
    const [l] = await q(`select status, resolvido_por_id, detalhe from atendimento_chamado where id = $1`, [id]);
    expect(l.status).toBe('resolvido');
    expect(l.resolvido_por_id).toBe(ana);
    expect(l.detalhe.disputa).toEqual({ acao: 'CANCELLATION', tipo: 'AFTER_DELIVERY' });
    expect(l.detalhe.plataforma).toBe('ifood');
    expect(l.detalhe.classificacao).toMatchObject({ motivo: 'faltou', produtos: ['Batata média'], por: 'Ana', porId: ana });
    // Sem o "O que aconteceu?", resolver não mexe no detalhe.
    const outro = await chamado({ status: 'aberto', detalhe: { robo: { motivo: 'Atraso' } } });
    await atend.resolver(T, outro, ana, {});
    expect((await q(`select detalhe from atendimento_chamado where id = $1`, [outro]))[0].detalhe).toEqual({ robo: { motivo: 'Atraso' } });
  });

  it('marcar depois: mescla só a classificação; vazio limpa; caso de outra empresa não existe; o que já está marcado e os produtos do pedido', async () => {
    const [{ id: ped }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, tipo, status, cliente_nome, total, itens)
       values ($1, $2, 'ifood', $3, '4521', 'entrega', 'concluido', 'Ana P.', 60,
               '[{"descricao":"X-Burguer duplo"},{"descricao":"Batata média"},{"descricao":"batata média"},{"descricao":""}]'::jsonb) returning id`,
      [T, lojaA, `if-${randomUUID()}`],
    );
    const id = await chamado({
      tipo: 'disputa',
      canal: 'ifood',
      pedido: ped,
      detalhe: { disputa: { acao: 'PARTIAL_CANCELLATION', tipo: 'AFTER_DELIVERY_PARTIALLY', itens: [{ nome: 'Coca lata', motivo: 'MISSING_ITEM', centavos: 600 }] }, encerramento: { status: 'ACCEPTED' } },
    });
    const antes: any = await svc.doCaso(T, id);
    expect(antes).toMatchObject({ motivo: 'faltou', fonte: 'plataforma', produtosMarcados: ['Coca lata'], produtos: ['X-Burguer duplo', 'Batata média', 'Coca lata'], maxProdutos: 10 });
    const user = { tenantId: T, colaboradorId: randomUUID(), categoria: 'execucao', nome: 'Bruno' } as any;
    await svc.salvar(user, id, { motivo: 'frio', produtos: ['X-Burguer duplo'] });
    const [l] = await q(`select detalhe from atendimento_chamado where id = $1`, [id]);
    expect(l.detalhe.encerramento).toEqual({ status: 'ACCEPTED' });
    expect(l.detalhe.disputa.itens).toHaveLength(1);
    expect(l.detalhe.classificacao).toMatchObject({ motivo: 'frio', produtos: ['X-Burguer duplo'], por: 'Bruno' });
    expect(await svc.doCaso(T, id)).toMatchObject({ motivo: 'frio', fonte: 'equipe', produtosMarcados: ['X-Burguer duplo'] });
    await svc.salvar(user, id, { motivo: null });
    expect((await q(`select detalhe from atendimento_chamado where id = $1`, [id]))[0].detalhe).not.toHaveProperty('classificacao');
    expect(await svc.doCaso(T, id)).toMatchObject({ motivo: 'faltou', fonte: 'plataforma' });
    await expect(svc.salvar({ ...user, tenantId: T2 }, id, { motivo: 'frio' })).rejects.toThrow('Caso não encontrado.');
    await expect(svc.doCaso(T2, id)).rejects.toThrow('Caso não encontrado.');
    await expect(svc.salvar(user, id, { motivo: 'inventado' })).rejects.toThrow('Motivo inválido');
  });

  it('no servidor da loja, a conta vem da nuvem pelo token do servidor, com a loja em uso (V37)', async () => {
    const pedidos: Array<{ url: string; token: string | undefined }> = [];
    const soquetes = new Set<Socket>();
    const nuvem: Server = createServer((req, res) => {
      pedidos.push({ url: req.url ?? '', token: req.headers['x-sync-token'] as string | undefined });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(req.url?.includes('/casos') ? { casos: [], total: 0 } : { canais: [], motivos: [], produtos: [], daNuvem: true }));
    });
    nuvem.on('connection', (s) => {
      soquetes.add(s);
      s.on('close', () => soquetes.delete(s));
    });
    await new Promise<void>((ok) => nuvem.listen(0, '127.0.0.1', () => ok()));
    const antes = { CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(nuvem.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-do-servidor';
      expect(await svc.numeros(T, lojaA, 'mes')).toMatchObject({ daNuvem: true });
      await svc.casos(T, null, { periodo: '7', motivo: 'atraso' });
      expect(pedidos).toEqual([
        { url: `/api/v1/atendimento/numeros-da-loja?periodo=mes&unidade=${lojaA}`, token: 'token-do-servidor' },
        { url: '/api/v1/atendimento/numeros-da-loja/casos?periodo=7&motivo=atraso', token: 'token-do-servidor' },
      ]);
      delete process.env.CLOUD_API;
      await expect(svc.numeros(T, lojaA, '30')).rejects.toThrow('não está ligado à nuvem');
    } finally {
      delete process.env.EDGE_MODE;
      for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      for (const s of soquetes) s.destroy();
      await new Promise<void>((ok) => nuvem.close(() => ok()));
    }
  });
});
