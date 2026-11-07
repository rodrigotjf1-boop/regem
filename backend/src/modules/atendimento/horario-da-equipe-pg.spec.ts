import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { BadRequestException } from '@nestjs/common';
import * as schema from '../../db/schema';
import { AtendimentoService } from './atendimento.service';
import { AtendimentoController } from './atendimento.controller';
import { FilaEAvisosService } from './fila-e-avisos.service';
import { abrirChamadoPeloRobo, posicaoNaFila } from './abrir-chamado';
import { situacaoDaEquipe, textoDaVolta } from './horario-da-equipe';
import { estadoDaPausa } from '../whatsapp/robo-pausa';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HORÁRIO DA EQUIPE (mig 379 — protótipo `mockups/regem-central-atendimento.html` v10), contra o Postgres real: o recado
// do WhatsApp (a marca no `detalhe`, a resposta ao robô, a pausa que NÃO liga), o pedido em andamento, o aviso ao gerente,
// a fila (situação "abertura", `comRecados`, as contagens e a faixa da equipe) e os ajustes. Aplica a 342, a 353 e a 379
// (só da nuvem: o banco do CI é o de uma loja — ERR-329), com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('horario-da-equipe-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const FUSO = 'America/Sao_Paulo';
const diaSp = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: FUSO });
const semanaSp = (d: Date) =>
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: FUSO, weekday: 'short' }).format(d));

// Uma janela daqui a 3 dias (10:00–11:00): agora está SEMPRE fora dela, e a equipe volta às 09:30 desse dia (30 min antes).
const daqui3 = new Date(Date.now() + 3 * 86_400_000);
const JANELA_LONGE = [{ dia: semanaSp(daqui3), ativo: true, abre: '10:00', fecha: '11:00' }];
const VOLTA = new Date(`${diaSp(daqui3)}T09:30:00-03:00`);
// Todos os dias, 00:00–23:59 (com a folga, sem buraco): agora está SEMPRE dentro.
const SEMPRE_ABERTA = [0, 1, 2, 3, 4, 5, 6].map((dia) => ({ dia, ativo: true, abre: '00:00', fecha: '23:59' }));

descrever('horário da equipe (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: AtendimentoService;
  let fila: FilaEAvisosService;
  const avisos: any[] = [];
  const auditoria: any[] = [];
  const T = randomUUID();
  let lojaA: string;
  let ana: string;
  let cardapio: string;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const gerente = () => ({ tenantId: T, colaboradorId: ana, categoria: 'gerente' }) as any;
  const emitir = (ev: string, p: any) => avisos.push({ ev, p });
  const horarios = (h: unknown[]) => q(`update cardapio_config set horarios = $2::jsonb where id = $1`, [cardapio, JSON.stringify(h)]);
  const modo = (m: 'sempre' | 'loja') =>
    q(`insert into robo_config (tenant_id, equipe_atende) values ($1, $2) on conflict (tenant_id) do update set equipe_atende = $2`, [T, m]);
  const detalhe = async (id: string) => (await q(`select detalhe from atendimento_chamado where id = $1`, [id]))[0]?.detalhe;
  const chamado = async (extra: Record<string, unknown> = {}) => {
    const c = { telefone: null, criado_em: new Date(Date.now() - 600_000), detalhe: null, responsavel_id: null, ...extra } as any;
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, telefone, prioridade, criado_em, responsavel_id, canal, status, detalhe)
       values ($1, $2, 'humano', $3, 'normal', $4, $5, 'whatsapp', 'aberto', $6::jsonb) returning id`,
      [T, lojaA, c.telefone, c.criado_em, c.responsavel_id, c.detalhe ? JSON.stringify(c.detalhe) : null],
    );
    return id as string;
  };
  const recado = (ateMs: number, emMs = -3_600_000) => ({
    recado: { ate: new Date(Date.now() + ateMs).toISOString(), em: new Date(Date.now() + emMs).toISOString() },
  });

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
    delete process.env.EDGE_MODE; // como NUVEM
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of ['342_robo_pausa_e_config.sql', '353_app_atendimento.sql', '379_horario_da_equipe.sql']) await aplicar(m);
    fila = new FilaEAvisosService(db, { emit: emitir } as any, { registrar: async (e: any) => void auditoria.push(e) } as any);
    svc = new AtendimentoService(db, { emit: emitir } as any, {} as any, undefined, fila);
    await q(`insert into empresa (id, nome) values ($1, 'teste horário da equipe')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana') returning id`, [T]);
    [{ id: cardapio }] = await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo) values ($1, null, $2, true) returning id`, [
      T,
      `tok-${randomUUID()}`,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from robo_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from cardapio_config where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from colaborador where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from unidade where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    await horarios(JANELA_LONGE);
    await modo('loja');
  });

  it('fora do horário: o chamar_atendente do WhatsApp deixa RECADO — a marca, a frase para o cliente, sem posição, e o robô segue', async () => {
    const r: any = await svc.abrirPeloRobo(T, null, { tipo: 'humano', telefone: '21911112222', mensagem: 'O lanche veio frio', cardapioId: cardapio });
    expect(r).toMatchObject({ ok: true, foraDoHorario: true, posicao: null, comAlguem: false });
    expect(r.equipeVolta).toBe(textoDaVolta(VOLTA));
    expect(r.paraOCliente).toBe(`Nossa equipe volta ${textoDaVolta(VOLTA)}. Já deixei o seu recado aqui e respondemos assim que começarmos.`);
    const d = await detalhe(r.id);
    expect(d.recado.ate).toBe(VOLTA.toISOString());
    expect(Math.abs(new Date(d.recado.em).getTime() - Date.now())).toBeLessThan(60_000);
    // a tela recebe o caso (ela decide pelo dado: o recado não toca)
    expect(avisos.some((a) => a.ev === 'atendimento.novo' && a.p.chamado.id === r.id)).toBe(true);
    // o recado NÃO cala o robô no número; o chamado aparece na caixa, com a volta da equipe
    const pausa = await estadoDaPausa(db, T, '5521911112222');
    expect(pausa.pausado).toBe(false);
    expect(pausa.chamado?.id).toBe(r.id);
    expect(pausa.chamado?.recadoAte?.toISOString()).toBe(VOLTA.toISOString());
  });

  it('somar ao recado: o mesmo caso, a marca fica e a resposta repete a frase — também passadas as 12 h (o recado espera a abertura)', async () => {
    const r1: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21911113333', mensagem: 'primeira' });
    expect(r1.foraDoHorario).toBe(true);
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '5521911113333', mensagem: 'segunda' });
    expect(r2).toMatchObject({ id: r1.id, jaAberto: true, foraDoHorario: true, posicao: null, paraOCliente: r1.paraOCliente });
    expect((await detalhe(r1.id)).recado.ate).toBe(VOLTA.toISOString());
    // criado há 13 h e ainda esperando a equipe: continua sendo "o aberto" do número
    await q(`update atendimento_chamado set criado_em = now() - interval '13 hours' where id = $1`, [r1.id]);
    const r3: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21911113333', mensagem: 'terceira' });
    expect(r3.id).toBe(r1.id);
    expect((await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [T]))[0].n).toBe(1);
  });

  it('somar a um caso COMUM (aberto no horário) não vira recado', async () => {
    const id = await chamado({ telefone: '21911114444' });
    const r: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21911114444', mensagem: 'de novo' });
    expect(r).toMatchObject({ id, jaAberto: true, posicao: 1 });
    expect(r.foraDoHorario).toBeUndefined();
    expect((await detalhe(id))?.recado).toBeUndefined();
  });

  it('pedido em andamento conta como horário: o caso dele vai para a fila na hora; pedido concluído vira recado', async () => {
    const pedido = async (status: string) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status, display_id)
           values ($1, $2, 'cardapio', 'delivery', '[]', 10, $3, '77') returning id`,
          [T, lojaA, status],
        )
      )[0].id as string;
    const emPreparo = await pedido('confirmado');
    const r: any = await abrirChamadoPeloRobo(db, emitir, T, lojaA, { tipo: 'erro', telefone: '21922220000', pedidoId: emPreparo });
    expect(r.foraDoHorario).toBeUndefined();
    expect(r.posicao).toBe(1);
    expect((await detalhe(r.id))?.recado).toBeUndefined();

    const concluido = await pedido('concluido');
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, lojaA, { tipo: 'erro', telefone: '21922221111', pedidoId: concluido });
    expect(r2.foraDoHorario).toBe(true);
    expect((await detalhe(r2.id)).recado).toBeTruthy();

    // o recado que passa a ter um pedido em andamento entra na fila AGORA (a tela é avisada como caso novo)
    const r3: any = await abrirChamadoPeloRobo(db, emitir, T, lojaA, { tipo: 'humano', telefone: '21922223333' });
    expect(r3.foraDoHorario).toBe(true);
    avisos.length = 0;
    const outro = await pedido('pronto');
    const r4: any = await abrirChamadoPeloRobo(db, emitir, T, lojaA, { tipo: 'humano', telefone: '21922223333', pedidoId: outro });
    // na fila de agora: o 2º (o do pedido em preparo chegou antes; o recado do pedido concluído não conta)
    expect(r4).toMatchObject({ id: r3.id, jaAberto: true, posicao: 2 });
    expect(r4.foraDoHorario).toBeUndefined();
    const d = await detalhe(r3.id);
    expect(new Date(d.recado.ate).getTime()).toBeLessThanOrEqual(Date.now() + 1000); // acabou agora
    expect(d.recado.em).toBeTruthy(); // o selo "Recado das …" fica
    expect(avisos.some((a) => a.ev === 'atendimento.novo' && a.p.chamado.id === r3.id)).toBe(true);
  });

  it('no horário (ou "Sempre"): o caso comum de hoje, com a posição', async () => {
    await horarios(SEMPRE_ABERTA);
    const r: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21933330000' });
    expect(r).toMatchObject({ posicao: 1 });
    expect(r.foraDoHorario).toBeUndefined();
    await horarios(JANELA_LONGE);
    await modo('sempre');
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21933331111' });
    expect(r2).toMatchObject({ posicao: 2 });
    expect((await detalhe(r2.id))?.recado).toBeUndefined();
  });

  it('o aviso ao gerente ignora o recado até o `ate` e conta o tempo da volta da equipe (não da criação)', async () => {
    const esperando = await chamado({ criado_em: new Date(Date.now() - 2 * 3_600_000), detalhe: recado(3_600_000) });
    const voltouAgora = await chamado({ criado_em: new Date(Date.now() - 2 * 3_600_000), detalhe: recado(-60_000) });
    const voltouHa5 = await chamado({ criado_em: new Date(Date.now() - 2 * 3_600_000), detalhe: recado(-5 * 60_000) });
    expect(await fila.escalar([T])).toBe(1); // o padrão: 3 min
    expect((await detalhe(esperando)).escalado).toBeUndefined();
    expect((await detalhe(voltouAgora)).escalado).toBeUndefined();
    expect((await detalhe(voltouHa5)).escalado).toMatchObject({ minutos: 3 });
    // a marca do escalado é mesclada: o recado fica (o selo continua)
    expect((await detalhe(voltouHa5)).recado).toBeTruthy();
  });

  it('a fila: o recado só com comRecados, na situação "abertura", sem posição; as contagens sem ele + paraAbertura; a faixa da equipe', async () => {
    const r = await chamado({ criado_em: new Date(Date.now() - 3_600_000), detalhe: recado(3_600_000) });
    const comum = await chamado({ criado_em: new Date(Date.now() - 60_000) });
    const pego = await chamado({ detalhe: recado(3_600_000), responsavel_id: ana }); // alguém pegou de madrugada: caso comum

    const sem = await svc.fila(gerente(), null);
    expect(sem.casos.map((c: any) => c.id).sort()).toEqual([comum, pego].sort());
    expect(sem.contagens).toMatchObject({ abertos: 2, naFila: 1, comigo: 1, paraAbertura: 1 });
    expect(sem.equipe).toEqual({ modo: 'loja', atendendo: false, voltaEm: VOLTA.toISOString(), voltaTexto: textoDaVolta(VOLTA) });
    expect(sem.casos.find((c: any) => c.id === pego)).toMatchObject({ situacao: 'com_alguem', recado: { ate: expect.any(String) } });
    expect(sem.casos.find((c: any) => c.id === comum)).toMatchObject({ situacao: 'fila', posicao: 1, recado: null });

    const com = await svc.fila(gerente(), null, { comRecados: true });
    const doRecado = com.casos.find((c: any) => c.id === r);
    expect(doRecado).toMatchObject({ situacao: 'abertura', posicao: null, recado: { ate: expect.any(String), em: expect.any(String) } });
    expect(com.casos.find((c: any) => c.id === comum)).toMatchObject({ situacao: 'fila', posicao: 1 });
    expect(com.contagens).toEqual(sem.contagens); // as contagens não dependem do pedido da lista
    expect((await posicaoNaFila(db, T, comum)).posicao).toBe(1); // o recado não passa na frente
    expect((await posicaoNaFila(db, T, r)).posicao).toBeNull();

    // passou o `ate`: um caso comum na fila (o primeiro — chegou antes), com o selo
    await q(`update atendimento_chamado set detalhe = jsonb_set(detalhe, '{recado,ate}', to_jsonb($2::text)) where id = $1`, [
      r,
      new Date(Date.now() - 60_000).toISOString(),
    ]);
    const depois = await svc.fila(gerente(), null);
    expect(depois.casos.find((c: any) => c.id === r)).toMatchObject({ situacao: 'fila', posicao: 1, recado: { em: expect.any(String) } });
    expect(depois.contagens).toMatchObject({ abertos: 3, naFila: 2, paraAbertura: 0 });
  });

  it('a fila esconde o recado também com a sessão do banco em outro fuso (V46)', async () => {
    await chamado({ detalhe: recado(3_600_000) });
    const fusoTokio = new Pool({ connectionString: URL_PG, options: '-c timezone=Asia/Tokyo' });
    try {
      const outro = new AtendimentoService(drizzle(fusoTokio, { schema }) as any, { emit: () => true } as any, {} as any);
      const r = await outro.fila(gerente(), null);
      expect(r.casos).toEqual([]);
      expect(r.contagens.paraAbertura).toBe(1);
    } finally {
      await fusoTokio.end();
    }
  });

  it('ajustes "Horário da equipe": padrões, ausente mantém, só as próprias colunas, texto vazio = padrão, auditoria', async () => {
    await q(`delete from robo_config where tenant_id = $1`, [T]);
    expect(await fila.ajusteDaEquipe(T)).toEqual({ atende: 'sempre', antesMin: 30, depoisMin: 60, textoFora: null });
    await q(`insert into robo_config (tenant_id, avisar_gerente_min) values ($1, 5)`, [T]);
    expect(await fila.salvarEquipe(gerente(), { atende: 'loja' })).toEqual({ atende: 'loja', antesMin: 30, depoisMin: 60, textoFora: null });
    expect(await fila.salvarEquipe(gerente(), { antesMin: 60, textoFora: '  Voltamos {volta}.  ' })).toEqual({
      atende: 'loja',
      antesMin: 60,
      depoisMin: 60,
      textoFora: 'Voltamos {volta}.',
    });
    expect((await q(`select avisar_gerente_min from robo_config where tenant_id = $1`, [T]))[0].avisar_gerente_min).toBe(5); // outro dono (V82)
    expect(auditoria.map((a) => [a.acao, a.detalhe])).toEqual([
      ['equipe_atende_alterado', { de: 'sempre', para: 'loja' }],
      ['equipe_comeca_alterado', { de: 30, para: 60 }],
      ['equipe_texto_fora_alterado', { de: null, para: 'Voltamos {volta}.' }],
    ]);
    // nada mudou: nada grava, nada na auditoria
    auditoria.length = 0;
    await fila.salvarEquipe(gerente(), { atende: 'loja' });
    expect(auditoria).toEqual([]);
    // inválido: recusa e não grava
    await expect(fila.salvarEquipe(gerente(), { depoisMin: 90 })).rejects.toThrow(BadRequestException);
    expect((await fila.ajusteDaEquipe(T)).depoisMin).toBe(60);
    // texto vazio volta ao padrão
    expect((await fila.salvarEquipe(gerente(), { textoFora: '' })).textoFora).toBeNull();
    // a situação usa o ajuste: a frase da loja, com a folga de 1 h antes de abrir
    await fila.salvarEquipe(gerente(), { textoFora: 'Voltamos {volta}.' });
    const s = await situacaoDaEquipe(db, T, { cardapioId: cardapio });
    const volta1h = new Date(`${diaSp(daqui3)}T09:00:00-03:00`);
    expect(s).toMatchObject({ modo: 'loja', atendendo: false, frase: `Voltamos ${textoDaVolta(volta1h)}.` });
    expect(s.voltaEm?.toISOString()).toBe(volta1h.toISOString());
  });

  it('salvar com vários grupos: a recusa do horário da equipe vem ANTES de gravar a fila (V86)', async () => {
    await q(`insert into robo_config (tenant_id, avisar_gerente_min) values ($1, 5) on conflict (tenant_id) do update set avisar_gerente_min = 5`, [T]);
    const naoUsar = new Proxy({}, { get: () => () => Promise.reject(new Error('não deveria ser chamado')) });
    const ctl = new AtendimentoController(svc, naoUsar as any, naoUsar as any, naoUsar as any, fila, naoUsar as any, naoUsar as any, naoUsar as any, naoUsar as any, naoUsar as any);
    await expect(ctl.salvarAjustes(gerente(), null, { fila: { avisarGerenteMin: 10 }, equipe: { antesMin: 45 } })).rejects.toThrow('Começa a atender');
    expect((await q(`select avisar_gerente_min from robo_config where tenant_id = $1`, [T]))[0].avisar_gerente_min).toBe(5);
  });

  it('num banco sem a robo_config (ou sem as colunas da 379): "sempre", e a TRANSAÇÃO de quem chama segue', async () => {
    const esquema = `horario_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await q(`create schema ${esquema}`);
    const isolado = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema},public` });
    try {
      const c = await isolado.connect();
      try {
        await c.query('begin');
        const dbTx = drizzle(c as any, { schema });
        expect(await situacaoDaEquipe(dbTx, T)).toMatchObject({ modo: 'sempre', atendendo: true });
        await c.query(`create table ${esquema}.robo_config (tenant_id uuid primary key)`);
        await c.query(`insert into ${esquema}.robo_config (tenant_id) values ($1)`, [T]);
        expect(await situacaoDaEquipe(dbTx, T)).toMatchObject({ modo: 'sempre', atendendo: true });
        expect((await c.query('select 1 as ok')).rows[0].ok).toBe(1); // a transação não foi derrubada
        await c.query('rollback');
      } finally {
        c.release();
      }
    } finally {
      await isolado.end();
      await q(`drop schema ${esquema} cascade`);
    }
  });

  it('no servidor da loja (sem a robo_config): sempre "sempre", sem ler o banco (V1)', async () => {
    process.env.EDGE_MODE = 'true';
    try {
      expect(await situacaoDaEquipe({ execute: () => Promise.reject(new Error('não deveria ler')) } as any, T)).toMatchObject({ modo: 'sempre', atendendo: true });
    } finally {
      delete process.env.EDGE_MODE;
    }
  });
});
