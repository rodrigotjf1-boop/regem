import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { agoraEmSaoPaulo, especiaisDoTipo, especialDaData } from '../../common/horario-da-data';
import { instanteNoFuso } from '../../common/pausa-do-canal';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { DiasEspeciaisService } from './dias-especiais.service';
import { DiasEspeciaisPausaService } from './dias-especiais-pausa.service';
import { lerDiasEspeciais } from './dias-especiais';

/* eslint-disable @typescript-eslint/no-explicit-any */

// H3 dos dias especiais contra o Postgres real (decisão 5 do protótipo `regem-dias-especiais.html`): a rotina pausa o iFood e a
// 99 pela pausa de SEMPRE (a do painel), uma vez por janela; respeita a equipe que reabriu; o canal não ligado fica registrado
// uma vez; "só a retirada" e a chave desligada não pausam. A pausa_canal (mig 392) e a horario_especial (mig 512) estão no
// banco do CI (não são só da nuvem). O iFood e a 99 de verdade ficam de fora: `canaisExternos` diz se estão ligados.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('dias-especiais-pausa-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('a pausa sozinha do iFood e da 99 no dia especial (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = new AuditoriaService(db);
  const canaisLigados = (ligados: boolean) =>
    ({
      canaisExternos: async () => ({
        ifood: { disponivel: ligados, unidadeId: null, motivo: ligados ? null : 'O iFood desta loja não está ligado.' },
        food99: { disponivel: ligados, unidadeId: null, motivo: ligados ? null : 'A 99 desta loja não está ligada.' },
      }),
      acordar: async () => undefined,
    }) as any;
  const pausas = new PausaDoCanalService(db, auditoria, canaisLigados(true));
  const rotina = new DiasEspeciaisPausaService(db, pausas, auditoria);
  const dias = new DiasEspeciaisService(db, auditoria);
  const empresas: string[] = [];
  const hoje = agoraEmSaoPaulo().dia;
  const as = (hhmm: string) => instanteNoFuso(hoje, hhmm);
  // Todos os dias da semana das 18:00 às 23:00 (o dia de hoje sempre abre).
  const SEMANA = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia: d, abre: '18:00', fecha: '23:00', ativo: true }));
  const antes = process.env.DIAS_ESPECIAIS_PAUSA_AUTOMATICA;

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pausa do dia especial') returning id`))[0].id as string;
    empresas.push(t);
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, aberto, modo, tipo_delivery, tipo_retirada, horarios)
       values ($1, null, $2, true, true, 'mesa', true, true, $3::jsonb)`,
      [t, `tk-${randomUUID()}`, JSON.stringify(SEMANA)],
    );
    const quem: any = { tenantId: t, colaboradorId: null, categoria: 'presidente', nome: 'Rodrigo' };
    return { t, quem };
  }
  const pausaDe = async (t: string, canal: string) =>
    (await q(`select to_char(ate at time zone 'America/Sao_Paulo', 'HH24:MI') as ate, motivo, motivo_texto, pausado_por_nome from pausa_canal where tenant_id = $1 and canal = $2`, [t, canal]))[0];

  afterAll(async () => {
    if (antes === undefined) delete process.env.DIAS_ESPECIAIS_PAUSA_AUTOMATICA;
    else process.env.DIAS_ESPECIAIS_PAUSA_AUTOMATICA = antes;
    if (empresas.length) {
      for (const t of ['pausa_canal', 'horario_especial', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  it('dia fechado: às 17:30 pausa o iFood até as 23:00 e a 99 até o fim do dia, uma vez; a equipe que reabriu não é pausada de novo', async () => {
    const { t, quem } = await loja();
    await dias.criar(quem, null, { data: hoje, nome: 'Natal de teste', funcionamento: 'fechada' });
    // Antes da janela (16:30): nada.
    expect(await rotina.volta(as('16:30'), [t])).toEqual([]);
    const r = await rotina.volta(as('17:30'), [t]);
    expect(r.map((x) => [x.chave.split(':').slice(2).join(':'), x.resultado])).toEqual([
      ['ifood:18:00', 'pausado'],
      ['food99', 'pausado'],
    ]);
    expect(await pausaDe(t, 'ifood')).toEqual({ ate: '23:00', motivo: 'outro', motivo_texto: 'Fechado hoje: Natal de teste', pausado_por_nome: 'Regem (dia especial)' });
    expect(await pausaDe(t, 'food99')).toMatchObject({ ate: '23:59', motivo_texto: 'Fechado hoje: Natal de teste' });
    // A auditoria de cada decisão.
    expect((await q(`select detalhe ->> 'resultado' as r from audit_log where tenant_id = $1 and acao = 'dia_especial_pausou_canal' order by seq`, [t])).map((x) => x.r)).toEqual(['pausado', 'pausado']);
    // Outra volta: já feito.
    expect(await rotina.volta(as('17:35'), [t])).toEqual([]);
    // A equipe reabre o iFood às 19:00: a rotina não pausa de novo.
    await pausas.reabrir(quem, null, 'ifood', as('19:00'));
    expect(await rotina.volta(as('19:05'), [t])).toEqual([]);
    expect((await pausaDe(t, 'ifood')).ate).toBeNull();
  });

  it('outro horário (18 às 21; o normal é até 23): só o iFood, a partir das 21:00, até as 23:00', async () => {
    const { t, quem } = await loja();
    await dias.criar(quem, null, { data: hoje, nome: 'Véspera de teste', funcionamento: 'horario', abre: '18:00', fecha: '21:00' });
    expect(await rotina.volta(as('20:50'), [t])).toEqual([]);
    expect((await rotina.volta(as('21:05'), [t])).map((x) => x.resultado)).toEqual(['pausado']);
    expect(await pausaDe(t, 'ifood')).toMatchObject({ ate: '23:00', motivo_texto: 'Hoje fechamos às 21:00: Véspera de teste' });
    expect(await pausaDe(t, 'food99')).toBeUndefined();
  });

  it('a pausa manual mais longa não é encurtada; o canal não ligado fica registrado uma vez; retirada e chave desligada não pausam', async () => {
    // A equipe já tinha pausado o iFood até as 23:30, antes da janela: "já estava pausado".
    const a = await loja();
    await dias.criar(a.quem, null, { data: hoje, nome: 'Feriado A', funcionamento: 'fechada' });
    await pausas.pausar({ ...a.quem, colaboradorId: randomUUID() }, null, { canais: ['ifood'], motivo: 'pedidos', tempo: { ate: '23:30' } }, as('16:00'));
    const ra = await rotina.volta(as('17:30'), [a.t]);
    expect(ra.map((x) => [x.chave.split(':').slice(2, 3)[0], x.resultado])).toEqual([
      ['ifood', 'ja_estava_pausado'],
      ['food99', 'pausado'],
    ]);
    expect(await pausaDe(a.t, 'ifood')).toMatchObject({ ate: '23:30', motivo: 'pedidos' });
    expect(await rotina.volta(as('17:40'), [a.t])).toEqual([]);

    // A loja sem o iFood e a 99 ligados: registrado uma vez, sem pausar.
    const b = await loja();
    await dias.criar(b.quem, null, { data: hoje, nome: 'Feriado B', funcionamento: 'fechada' });
    const semCanais = new DiasEspeciaisPausaService(db, new PausaDoCanalService(db, auditoria, canaisLigados(false)), auditoria);
    expect((await semCanais.volta(as('17:30'), [b.t])).map((x) => x.resultado)).toEqual(['canal_nao_ligado', 'canal_nao_ligado']);
    expect(await semCanais.volta(as('17:35'), [b.t])).toEqual([]);
    expect(await pausaDe(b.t, 'ifood')).toBeUndefined();

    // Só a retirada e a chave desligada: nada.
    const c = await loja();
    await dias.criar(c.quem, null, { data: hoje, nome: 'Feriado C', funcionamento: 'fechada', pausarCanais: false });
    const d = await loja();
    await dias.criar(d.quem, null, { data: hoje, nome: 'Feriado D', funcionamento: 'fechada', conjunto: 'retirada' });
    expect(await rotina.volta(as('17:30'), [c.t, d.t])).toEqual([]);
  });

  it('a lista diz se a pausa sozinha está ligada (a variável) e o que cada dia vai pausar', async () => {
    const { t, quem } = await loja();
    await dias.criar(quem, null, { data: hoje, nome: 'Feriado E', funcionamento: 'fechada' });
    delete process.env.DIAS_ESPECIAIS_PAUSA_AUTOMATICA;
    let l: any = await dias.listar(t, null);
    expect(l.pausaAutomatica).toBe(false);
    expect(l.itens[0].pausas).toEqual([]);
    process.env.DIAS_ESPECIAIS_PAUSA_AUTOMATICA = '1';
    l = await dias.listar(t, null);
    expect(l.pausaAutomatica).toBe(true);
    expect(l.itens[0].pausas).toEqual([
      { canal: 'ifood', desde: '18:00', ate: '23:00' },
      { canal: 'food99', desde: '18:00', ate: null },
    ]);
  });

  it('o mesmo dia criado na nuvem e na loja (o par que o sync junta): grava sem 23505, as duas pontas leem o mesmo e a pausa sai uma vez (ERR-640)', async () => {
    const { t, quem } = await loja();
    const naNuvem = await dias.criar(quem, null, { data: hoje, nome: 'Feito na nuvem', funcionamento: 'fechada' });
    // O mesmo dia chegando da outra ponta pelo sync: id de lá, alterado antes. Com o índice único da 512, era 23505 para
    // sempre (o lote do sync travado).
    const daLoja = randomUUID();
    await q(
      `insert into horario_especial (id, tenant_id, unidade_id, data, nome, funcionamento, conjunto, updated_at)
       values ($1, $2, null, $3::date, 'Feito na loja', 'fechada', 'todos', now() - interval '1 hour')`,
      [daLoja, t, hoje],
    );
    let lista = await lerDiasEspeciais(db, t, null, hoje, hoje);
    expect(lista.map((e) => e.nome)).toEqual(['Feito na nuvem', 'Feito na loja']); // o alterado por último na frente
    expect(especialDaData(especiaisDoTipo(lista, 'entrega'), hoje)?.nome).toBe('Feito na nuvem');
    // A loja muda o dela depois: passa a valer o da loja (o updated_at viaja com a linha, então a nuvem lê igual).
    await q(`update horario_especial set nome = 'Mudado na loja' where id = $1`, [daLoja]);
    lista = await lerDiasEspeciais(db, t, null, hoje, hoje);
    expect(lista[0].nome).toBe('Mudado na loja');
    expect(especialDaData(especiaisDoTipo(lista, 'retirada'), hoje)?.nome).toBe('Mudado na loja');
    // A tela mostra os dois (exclua um) — na mesma ordem.
    expect((await dias.listar(t, null)).itens.map((e: any) => e.nome)).toEqual(['Mudado na loja', 'Feito na nuvem']);
    // A mesma ponta segue recusando o dia repetido: a conferência do serviço, com a trava da empresa (V24).
    await expect(dias.criar(quem, null, { data: hoje, nome: 'De novo', funcionamento: 'fechada' })).rejects.toThrow('Já há um dia especial');
    // A rotina da pausa: os dois pedem a mesma pausa, ela sai uma vez por canal.
    const r = await rotina.volta(as('17:30'), [t]);
    expect(r.map((x) => x.resultado)).toEqual(['pausado', 'pausado']);
    expect(naNuvem.id).toBeTruthy();
  });
});
