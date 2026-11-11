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
      ['ifood', false, null], // sem a integração ligada nesta loja (F5)
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
    // Perto da meia-noite a volta é "amanhã" (o CI de 10/11 às 23:48 pegou o teste que supunha o mesmo dia — ERR-434).
    expect(menu.horarioLabel).toBe(`Pedidos pausados até ${p.volta.amanha ? 'amanhã às ' : ''}${p.volta.hora}`);
    expect(menu.proximaAbertura).toEqual({ entrega: p.volta.hora, retirada: p.volta.hora });
    expect(menu.pausa).toMatchObject({ rotulo: 'Muitos pedidos agora', frase: 'Estamos com *muitos pedidos agora*' });

    const resumo: any = resumoDaLoja(menu, 'https://link');
    expect(resumo).toMatchObject({ abertaAgora: false, pausadaPelaLoja: true, pausa: { motivo: 'Muitos pedidos agora', volta: p.volta.texto } });
    // F3 (mig 394): a mensagem pronta (sem nome, sem o destaque) no resumo, e ela é a "mensagem de ausência" durante a pausa
    // — o atendente do n8n já usa a de ausência com a loja fechada.
    const semDestaque = `⏸️ Pedidos pausados por alguns minutos\n\nOi! Estamos com muitos pedidos agora e pausamos os pedidos para não atrasar ninguém.\n\n🕒 Voltamos ${p.volta.texto}.`;
    expect(resumo.pausa.mensagem.startsWith(semDestaque)).toBe(true);
    expect(resumo.robo.ausencia).toBe(resumo.pausa.mensagem);
    expect(menu.pausa).toMatchObject({ mensagemPersonalizada: false, mensagem: expect.stringContaining('Estamos com *muitos pedidos agora*') });

    await expect(cardapio.receberPedido(tokens[0], pedido)).rejects.toThrow(
      `Pedidos pausados agora: estamos com muitos pedidos agora. Voltamos ${p.volta.texto}.`,
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
    // F5: sem o canal ligado para esta loja, o iFood e a 99 recusam ANTES de gravar (o cardápio digital junto também não pausa).
    await expect(recusa({ canais: ['ifood'], motivo: 'pedidos', tempo: { minutos: 30 } })).rejects.toThrow('O iFood desta loja não está ligado para pausar pelo Regem.');
    await expect(recusa({ canais: ['cardapio', 'food99'], motivo: 'pedidos', tempo: { minutos: 30 }, tempo99: { minutos: 10 } })).rejects.toThrow(
      'A 99 desta loja não está ligada para pausar pelo Regem.',
    );
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
    // F2: sem cardápio, o grupo do aviso não aparece e gravar é recusado com o caminho.
    expect(await pausas.ajustes(t, null)).toMatchObject({ temCardapio: false, minutos: 5, som: 'bipe' });
    await expect(
      pausas.salvarAjustes({ tenantId: t, colaboradorId: randomUUID(), categoria: 'gerente' } as any, null, { minutos: 3 }),
    ).rejects.toThrow('A loja ainda não tem cardápio online');
  });

  // ── F2 (mig 393): o estender e o aviso antes de reabrir ─────────────────────────────────────────────────────────
  it('F2: estender soma ao fim — dois cliques juntos somam os dois —, audita, e o canal reaberto recusa', async () => {
    const { t, gestor } = await loja();
    await pausas.pausar(gestor, null, { canais: ['cardapio'], motivo: 'pedidos', tempo: { minutos: 15 } });
    const fim = async () => new Date((await q(`select ate from pausa_canal where tenant_id = $1`, [t]))[0].ate).getTime();
    const antes = await fim();
    // A corrida FORÇADA (V72): uma conexão do teste segura a linha; os dois cliques ficam presos atrás DELA e saem juntos.
    const trava = await pool.connect();
    let r: any[];
    try {
      await trava.query('begin');
      await trava.query('select 1 from pausa_canal where id = $1 for update', [idPausaDoCanal(t, null, 'cardapio')]);
      const [{ pid }] = (await trava.query('select pg_backend_pid() as pid')).rows;
      const cliques = Promise.all([
        pausas.estender(gestor, null, 'cardapio', 10),
        pausas.estender({ ...gestor, colaboradorId: randomUUID() }, null, 'cardapio', 10),
      ]);
      const limite = Date.now() + 15_000;
      for (;;) {
        const [{ n }] = await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [pid]);
        if (n >= 2 || Date.now() > limite) break;
        await new Promise((res) => setTimeout(res, 50));
      }
      await trava.query('commit');
      r = await cliques;
    } finally {
      trava.release(true); // descarta a conexão: nunca volta ao pool com a transação aberta (ERR-161)
    }
    expect((await fim()) - antes).toBe(20 * 60_000);
    expect(r[0].minutosParaEstender).toEqual([10, 30]);
    expect(registros.filter((x) => x.acao === 'estendeu_canal')).toHaveLength(2);
    expect(registros.find((x) => x.acao === 'estendeu_canal')).toMatchObject({ entidadeId: idPausaDoCanal(t, null, 'cardapio'), detalhe: expect.objectContaining({ canal: 'cardapio', minutos: 10 }) });
    await expect(pausas.estender(gestor, null, 'cardapio', 15)).rejects.toThrow('Estenda por 10 ou 30 minutos.');
    await pausas.reabrir(gestor, null, 'cardapio');
    await expect(pausas.estender(gestor, null, 'cardapio', 10)).rejects.toThrow('Este canal já reabriu.');
    expect(registros.filter((x) => x.acao === 'estendeu_canal')).toHaveLength(2);
  });

  it('F2: o aviso da loja — padrão 5 min e bipe; o ajuste grava só o que mudou, anda o carimbo do sync e audita', async () => {
    const { t, gestor } = await loja();
    expect((await pausas.estado(t, null)).aviso).toEqual({ minutos: 5, som: 'bipe' });
    expect(await pausas.ajustes(t, null)).toMatchObject({ minutos: 5, som: 'bipe', temCardapio: true, opcoes: { minutos: [0, 1, 3, 5, 10], sons: ['bipe', 'campainha'] } });
    const [c0] = await q(`select updated_at from cardapio_config where tenant_id = $1`, [t]);
    await new Promise((r) => setTimeout(r, 20));
    await pausas.salvarAjustes(gestor, null, pausas.conferirAjustes({ minutos: '3', som: 'campainha' }));
    expect((await pausas.estado(t, null)).aviso).toEqual({ minutos: 3, som: 'campainha' });
    const [c1] = await q(`select updated_at, pausa_aviso_min, pausa_som from cardapio_config where tenant_id = $1`, [t]);
    expect([c1.pausa_aviso_min, c1.pausa_som]).toEqual([3, 'campainha']);
    expect(new Date(c1.updated_at).getTime()).toBeGreaterThan(new Date(c0.updated_at).getTime());
    expect(registros.filter((x) => x.acao === 'alterou_aviso_da_pausa')).toEqual([
      expect.objectContaining({ tenantId: t, tipo: 'config', detalhe: { antes: { minutos: 5, som: 'bipe' }, depois: { minutos: 3, som: 'campainha' } } }),
    ]);
    // Igual ao gravado: nada muda nem vai para a auditoria; fora da lista é recusado antes de gravar.
    await pausas.salvarAjustes(gestor, null, { minutos: 3 });
    expect(registros.filter((x) => x.acao === 'alterou_aviso_da_pausa')).toHaveLength(1);
    expect(() => pausas.conferirAjustes({ minutos: 2 })).toThrow('Avisar antes de reabrir');
    expect(() => pausas.conferirAjustes({ som: 'sirene' })).toThrow('Som do aviso');
  });

  it('F4: responder em áudio — ligado por padrão; desligar grava e audita; só booleano', async () => {
    const { t, gestor } = await loja();
    expect(await pausas.ajustes(t, null)).toMatchObject({ audio: true });
    await pausas.salvarAjustes(gestor, null, pausas.conferirAjustes({ audio: false }));
    expect(await pausas.ajustes(t, null)).toMatchObject({ audio: false });
    const [c] = await q(`select pausa_audio from cardapio_config where tenant_id = $1`, [t]);
    expect(c.pausa_audio).toBe(false);
    expect(registros.filter((x) => x.acao === 'desligou_audio_da_pausa')).toHaveLength(1);
    expect(registros.filter((x) => x.acao === 'alterou_aviso_da_pausa')).toHaveLength(0); // mudar o áudio não é mudar o aviso
    await pausas.salvarAjustes(gestor, null, { audio: false }); // igual: nada
    expect(registros.filter((x) => /audio_da_pausa/.test(x.acao))).toHaveLength(1);
    expect(() => pausas.conferirAjustes({ audio: 'sim' })).toThrow('true ou false');
  });

  it('F2: com um cardápio por loja, o aviso é o da loja escolhida', async () => {
    const { t, unidades: [u1, u2], gestor } = await loja({ lojas: 2, cardapioPorLoja: true });
    await pausas.salvarAjustes(gestor, u1, { minutos: 10 });
    expect((await pausas.estado(t, u1)).aviso).toEqual({ minutos: 10, som: 'bipe' });
    expect((await pausas.estado(t, u2)).aviso).toEqual({ minutos: 5, som: 'bipe' });
  });
});
