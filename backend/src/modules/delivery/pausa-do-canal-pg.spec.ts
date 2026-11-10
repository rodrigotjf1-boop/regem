import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { idPausaDoCanal } from '../../common/id-deterministico';
import { CardapioService } from '../cardapio/cardapio.service';
import { resumoDaLoja } from '../cardapio/robo-consultas';
import { PausaDoCanalService } from './pausa-do-canal.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A PAUSA DOS PEDIDOS POR CANAL contra o Postgres real (mig 392; protótipo `mockups/regem-pausa.html`): o gestor pausa o
// cardápio digital no painel com o motivo e o tempo → o cardápio online fecha (o menu diz "pausado" com o motivo e a
// volta), o pedido é recusado com o mesmo texto, o atendente lê a pausa no resumo da loja; reabrir devolve tudo; cada
// pausa e reabertura vão para a auditoria; uma linha por empresa, loja e canal, com o id da chave (a nuvem e o servidor
// da loja chegam à mesma linha). A 392 não é só da nuvem: o banco do CI (o de uma loja) já a tem.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pausa-do-canal-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('pausa por canal (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as any;
  const pausas = new PausaDoCanalService(db, auditoria);
  const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, {} as any, {} as any, { emit: () => true } as any, {} as any);
  const empresas: string[] = [];

  async function loja(opts: { lojas?: number; cardapioPorLoja?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste pausa por canal') returning id`))[0].id as string;
    empresas.push(t);
    const unidades: string[] = [];
    for (let i = 0; i < (opts.lojas ?? 1); i++)
      unidades.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    const tokens: string[] = [];
    const donos = opts.cardapioPorLoja ? unidades : [null];
    for (const u of donos) {
      const token = `tk-${randomUUID()}`;
      // Sem horários = aberta sempre; entrega e retirada ligadas.
      await q(
        `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada)
         values ($1, $2, $3, true, true, 'mesa', true, true)`,
        [t, u, token],
      );
      tokens.push(token);
    }
    const gestor: any = { tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente', nome: 'Rodrigo' };
    return { t, unidades, tokens, gestor };
  }
  const pedido = { tipo: 'entrega', cliente: 'Ana', telefone: '21987654321', itens: [{ produtoId: randomUUID(), quantidade: 1 }] } as any;

  beforeEach(() => void (registros.length = 0));
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pausa_canal', 'cardapio_config', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  it('pausar o cardápio digital fecha o cardápio online, recusa o pedido e o atendente sabe; reabrir devolve', async () => {
    const { t, tokens, gestor } = await loja();
    const antes = await pausas.estado(t, null);
    expect(antes.canais.map((c) => [c.canal, c.disponivel, c.pausa])).toEqual([
      ['cardapio', true, null],
      ['ifood', false, null], // a fase da API
      ['food99', false, null],
    ]);
    expect((await cardapio.menu(tokens[0])).abertoPorTipo).toEqual({ entrega: true, retirada: true, local: true });

    const depois = await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 30 } });
    const p = depois.canais[0].pausa!;
    expect(p).toMatchObject({ rotulo: 'Muitos pedidos agora', frase: 'Estamos com *muitos pedidos agora*', pausadoPorNome: 'Rodrigo' });
    expect(new Date(p.ate).getTime() - Date.now()).toBeGreaterThan(29 * 60_000);

    const menu: any = await cardapio.menu(tokens[0]);
    expect(menu.abertaAgora).toBe(false);
    expect(menu.abertoPorTipo).toEqual({ entrega: false, retirada: false, local: false });
    expect(menu.horarioLabel).toBe(`Pedidos pausados até ${p.volta.hora}`);
    expect(menu.proximaAbertura).toEqual({ entrega: p.volta.hora, retirada: p.volta.hora });
    expect(menu.pausa).toMatchObject({ rotulo: 'Muitos pedidos agora', frase: 'Estamos com *muitos pedidos agora*' });

    const resumo: any = resumoDaLoja(menu, 'https://link');
    expect(resumo).toMatchObject({ abertaAgora: false, pausadaPelaLoja: true, pausa: { motivo: 'Muitos pedidos agora', volta: `às ${p.volta.hora}` } });

    await expect(cardapio.receberPedido(tokens[0], pedido)).rejects.toThrow(
      `Pedidos pausados agora: estamos com muitos pedidos agora. Voltamos às ${p.volta.hora}.`,
    );
    // O agendado passa pela pausa (como pela loja fechada no horário) — e para no que vem depois.
    await expect(cardapio.receberPedido(tokens[0], { ...pedido, agendamento: '2026-12-01T12:00:00-03:00' })).rejects.toThrow(
      'Esta loja não aceita encomendas.',
    );

    expect(registros).toEqual([
      expect.objectContaining({ tenantId: t, atorId: gestor.colaboradorId, tipo: 'delivery', acao: 'pausou_canal', entidadeTipo: 'pausa_canal',
        detalhe: expect.objectContaining({ canal: 'cardapio', motivo: 'pedidos', motivoTexto: null, tempo: '30 min' }) }),
    ]);

    const reaberto = await pausas.reabrir(gestor, null, 'cardapio');
    expect(reaberto.canais[0].pausa).toBeNull();
    expect((await cardapio.menu(tokens[0])).abertoPorTipo).toEqual({ entrega: true, retirada: true, local: true });
    expect(registros.map((r) => r.acao)).toEqual(['pausou_canal', 'reabriu_canal']);
    // Reabrir o que já está aberto não muda nada nem vai para a auditoria.
    await pausas.reabrir(gestor, null, 'cardapio');
    expect(registros).toHaveLength(2);
  });

  it('uma linha por empresa, loja e canal, com o id da chave (o mesmo md5 do Postgres); pausar de novo troca o motivo', async () => {
    const { t, gestor } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    const r = await pausas.pausar(gestor, null, { canais: ['cardapio', 'cardapio'], motivo: 'outro', motivoTexto: 'trocando o gás', tempo: { minutos: 60 } });
    expect(r.canais[0].pausa).toMatchObject({ motivo: 'outro', rotulo: 'Trocando o gás', frase: '*Trocando o gás*' });
    const linhas = await q(`select id, unidade_id, canal, motivo, motivo_texto from pausa_canal where tenant_id = $1`, [t]);
    expect(linhas).toEqual([{ id: idPausaDoCanal(t, null, 'cardapio'), unidade_id: null, canal: 'cardapio', motivo: 'outro', motivo_texto: 'trocando o gás' }]);
    const [{ id }] = await q(`select md5('pausa_canal' || $1 || '' || 'cardapio')::uuid::text as id`, [t]);
    expect(id).toBe(idPausaDoCanal(t, null, 'cardapio'));
  });

  it('reabrir anda o carimbo do sync (a reabertura feita na loja chega à nuvem)', async () => {
    const { t, gestor } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'energia', tempo: { minutos: 30 } });
    const [a] = await q(`select updated_at from pausa_canal where tenant_id = $1`, [t]);
    await new Promise((r) => setTimeout(r, 20));
    await pausas.reabrir(gestor, null, 'cardapio');
    const [b] = await q(`select ate, updated_at from pausa_canal where tenant_id = $1`, [t]);
    expect(b.ate).toBeNull();
    expect(new Date(b.updated_at).getTime()).toBeGreaterThan(new Date(a.updated_at).getTime());
  });

  it('duas pessoas reabrindo juntas: uma reabertura na auditoria', async () => {
    const { gestor } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'cozinha', tempo: { minutos: 30 } });
    await Promise.all([pausas.reabrir(gestor, null, 'cardapio'), pausas.reabrir({ ...gestor, colaboradorId: randomUUID() }, null, 'cardapio')]);
    expect(registros.filter((r) => r.acao === 'reabriu_canal')).toHaveLength(1);
  });

  it('a pausa que passou do tempo não fecha nada (reabre sozinha)', async () => {
    const { t, tokens, gestor } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'fechando', tempo: { minutos: 15 } }, new Date(Date.now() - 20 * 60_000));
    expect((await pausas.estado(t, null)).canais[0].pausa).toBeNull();
    expect((await cardapio.menu(tokens[0])).pausa).toBeNull();
  });

  it('recusa o que a tela não pode mandar, sem gravar nada', async () => {
    const { t, gestor } = await loja();
    const recusa = (dto: any) => pausas.pausar(gestor, null, dto);
    await expect(recusa({ canais: [], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow('Escolha o que pausar.');
    await expect(recusa({ canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow('A pausa do iFood pelo Regem ainda não está ligada.');
    await expect(recusa({ canais: ['cardapio', 'food99'], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow('A pausa da 99 pelo Regem');
    await expect(recusa({ canais: ['totem'], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow('Canal desconhecido.');
    await expect(recusa({ canais: ['cardapio'], motivo: 'outro', tempo: { minutos: 30 } })).rejects.toThrow('Escreva o motivo da pausa.');
    await expect(recusa({ canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 45 } })).rejects.toThrow('Escolha 15 min, 30 min, 1 hora ou "Até".');
    await expect(recusa({ canais: ['cardapio'], motivo: 'pedidos' })).rejects.toThrow('Escolha por quanto tempo pausar.');
    expect(await q(`select 1 from pausa_canal where tenant_id = $1`, [t])).toEqual([]);
    expect(registros).toEqual([]);
  });

  it('por loja: com um cardápio por loja, a pausa é da loja escolhida; sem escolher, pede a loja; a da empresa toda vale para todas', async () => {
    const { t, unidades: [u1, u2], tokens: [tk1, tk2], gestor } = await loja({ lojas: 2, cardapioPorLoja: true });
    expect((await pausas.estado(t, null)).escolherLoja).toBe(true);
    await expect(pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow(
      'Escolha a loja no topo da tela',
    );

    await pausas.pausar(gestor, u1, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 30 } });
    expect((await cardapio.menu(tk1)).pausa).not.toBeNull();
    expect((await cardapio.menu(tk2)).pausa).toBeNull();
    expect((await pausas.estado(t, u1)).canais[0].pausa).not.toBeNull();
    expect((await pausas.estado(t, u2)).canais[0].pausa).toBeNull();
    expect(registros[0]).toMatchObject({ unidadeId: u1, entidadeId: idPausaDoCanal(t, u1, 'cardapio') });

    // A linha da empresa toda (sem loja) vale para a loja também — a regra "da loja OU sem loja" (V4).
    await q(`insert into pausa_canal (id, tenant_id, unidade_id, canal, ate, motivo) values ($1, $2, null, 'cardapio', now() + interval '10 minutes', 'energia')`,
      [idPausaDoCanal(t, null, 'cardapio'), t]);
    expect((await cardapio.menu(tk2)).pausa).toMatchObject({ rotulo: 'Sem energia ou internet' });
  });

  it('a loja escolhida no topo sem cardápio próprio pausa o da empresa toda (o que o cliente abre)', async () => {
    const { t, unidades: [u1], tokens: [tk], gestor } = await loja({ lojas: 2 });
    await pausas.pausar(gestor, u1, { canais: ['cardapio'], motivo: 'entregador', tempo: { minutos: 30 } });
    expect(await q(`select unidade_id from pausa_canal where tenant_id = $1`, [t])).toEqual([{ unidade_id: null }]);
    expect((await cardapio.menu(tk)).pausa).toMatchObject({ rotulo: 'Falta de entregador' });
  });

  it('empresa sem cardápio digital: não há o que pausar', async () => {
    const t = (await q(`insert into empresa (nome) values ('sem cardapio') returning id`))[0].id as string;
    empresas.push(t);
    expect((await pausas.estado(t, null)).canais[0].disponivel).toBe(false);
    await expect(
      pausas.pausar({ tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente' } as any, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 30 } }),
    ).rejects.toThrow('Esta loja não tem cardápio digital.');
  });
});
