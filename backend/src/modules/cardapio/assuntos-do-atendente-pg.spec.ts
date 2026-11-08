import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Logger } from '@nestjs/common';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AtendimentoService } from '../atendimento/atendimento.service';
import { AtendimentoController } from '../atendimento/atendimento.controller';
import { FilaEAvisosService } from '../atendimento/fila-e-avisos.service';
import { abrirChamadoPeloRobo, posicaoNaFila } from '../atendimento/abrir-chamado';
import { estadoDaPausa } from '../whatsapp/robo-pausa';
import { CardapioService } from './cardapio.service';
import { RoboConsultasController } from './robo-consultas.controller';
import { TEXTO_PADRAO_DO_RECADO, TEXTO_PADRAO_NAO, assuntosDaEmpresa, assuntosPadrao, salvarAssuntosDoAtendente } from './assuntos-do-atendente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS ASSUNTOS QUE NÃO SÃO PEDIDO (mig 381 — protótipo `mockups/regem-central-atendimento.html` v12), contra o Postgres real:
// o RECADO PARA O RESPONSÁVEL no WhatsApp (o "chamar atendente" com o tipo do assunto em "recado": o caso, a marca, o
// resumo e a resposta ao robô; em "Como hoje" o caso comum de antes), a pausa que NÃO liga, a soma só ao recado do mesmo
// assunto, o aviso ao gerente que o ignora (V84), a fila (situação 'responsavel', `comRecados`, só a gestão — RBAC no
// servidor —, as contagens), os ajustes (GET/PUT, a mescla V82, a recusa antes de gravar V86, o banco sem a 381) e a rota
// das instruções do robô. Aplica a 342, a 353, a 379, a 380 e a 381 (só da nuvem: o banco do CI é o de uma loja —
// ERR-329), com a trava da empresa na frente (ERR-377).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('assuntos-do-atendente-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);
const SENHA = 'senha-do-robo-dos-assuntos';

descrever('assuntos que não são pedido (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: AtendimentoService;
  let fila: FilaEAvisosService;
  let ctl: AtendimentoController;
  let cardapioSvc: CardapioService;
  const avisos: Array<{ ev: string; p: any }> = [];
  const auditoria: any[] = [];
  const T = randomUUID();
  let lojaA: string;
  let ana = ''; // gerente
  let edu = ''; // execução
  let sara = ''; // supervisão
  let token: string;
  const INSTANCIA = `inst-assuntos-${T.slice(0, 8)}`;
  const antes: Record<string, string | undefined> = {};
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const quem = (colaboradorId: string, categoria: string) => ({ tenantId: T, colaboradorId, categoria }) as any;
  const gerente = () => quem(ana, 'gerente');
  const emitir = (ev: string, p: any) => avisos.push({ ev, p });
  const coluna = async () => (await q(`select atendente_assuntos from robo_config where tenant_id = $1`, [T]))[0]?.atendente_assuntos;
  const gravarAssuntos = (v: unknown) =>
    q(`insert into robo_config (tenant_id, atendente_assuntos) values ($1, $2::jsonb) on conflict (tenant_id) do update set atendente_assuntos = $2::jsonb`, [
      T,
      JSON.stringify(v),
    ]);
  const caso = async (id: string) => (await q(`select * from atendimento_chamado where id = $1`, [id]))[0];
  const chamado = async (extra: Record<string, unknown> = {}) => {
    const c = { telefone: null, criado_em: new Date(Date.now() - 600_000), detalhe: null, responsavel_id: null, tipo: 'humano', status: 'aberto', ...extra } as any;
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, telefone, prioridade, criado_em, responsavel_id, canal, status, detalhe, resolvido_em)
       values ($1, $2, $3, $4, 'normal', $5, $6, 'whatsapp', $7, $8::jsonb, case when $7 = 'resolvido' then now() end) returning id`,
      [T, lojaA, c.tipo, c.telefone, c.criado_em, c.responsavel_id, c.status, c.detalhe ? JSON.stringify(c.detalhe) : null],
    );
    return id as string;
  };
  const marca = (assunto = 'vaga') => ({ responsavel: { assunto, em: new Date(Date.now() - 3_600_000).toISOString() } });
  const dialeto = new PgDialect();
  const textoDa = (consulta: any): string => {
    try {
      return dialeto.sqlToQuery(consulta).sql;
    } catch {
      return '';
    }
  };
  /** O banco com a leitura dos assuntos caindo (as outras consultas seguem). */
  const dbComAssuntosCaindo = () =>
    new Proxy(db, {
      get(alvo, prop) {
        if (prop !== 'execute') return Reflect.get(alvo, prop);
        return (consulta: any) =>
          textoDa(consulta).includes("-> 'atendente_assuntos'") ? Promise.reject(new Error('conexão caiu')) : alvo.execute(consulta);
      },
    });
  const naoUsar = () => new Proxy({}, { get: () => () => Promise.reject(new Error('não deveria ser chamado')) });
  const nulo = () => new Proxy({}, { get: () => async () => null });
  const MSG_DA_VAGA =
    'Assunto: Vaga: atendente de balcão\nQuem: Larissa, 2 anos em lanchonete\nContato: este WhatsApp\nJá fiz: agradeci e disse que o responsável fala com ela';

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
    antes.EDGE_MODE = process.env.EDGE_MODE;
    antes.BOT_RESOLVER_SECRET = process.env.BOT_RESOLVER_SECRET;
    delete process.env.EDGE_MODE; // como NUVEM
    process.env.BOT_RESOLVER_SECRET = SENHA;
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    for (const m of [
      '342_robo_pausa_e_config.sql',
      '353_app_atendimento.sql',
      '379_horario_da_equipe.sql',
      '380_perfis_do_atendente.sql',
      '381_assuntos_do_atendente.sql',
    ])
      await aplicar(m);
    fila = new FilaEAvisosService(db, { emit: emitir } as any, { registrar: async (e: any) => void auditoria.push(e) } as any);
    svc = new AtendimentoService(db, { emit: emitir } as any, {} as any, undefined, fila);
    ctl = new AtendimentoController(svc, nulo() as any, nulo() as any, nulo() as any, fila, nulo() as any, nulo() as any, nulo() as any, nulo() as any, nulo() as any);
    const u = {} as any;
    cardapioSvc = new CardapioService(db, u, u, svc, u, u, { emit: emitir } as any, u);
    await q(`insert into empresa (id, nome) values ($1, 'teste assuntos do atendente')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana') returning id`, [T]);
    [{ id: edu }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Edu') returning id`, [T]);
    [{ id: sara }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Sara') returning id`, [T]);
    token = `tok-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, nome_publico, evolution_instancia) values ($1, null, $2, true, 'Burger da Praça', $3)`,
      [T, token, INSTANCIA],
    );
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(antes)) if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    if (!pool) return;
    for (const tab of ['atendimento_chamado', 'robo_pausa', 'robo_config', 'cardapio_config', 'colaborador', 'unidade'])
      await q(`delete from ${tab} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await q(`delete from robo_config where tenant_id = $1`, [T]);
  });

  // ───────────────────────── o recado no WhatsApp ─────────────────────────

  it('vaga em "recado": o chamar_atendente (a rota do robô) deixa o RECADO PARA O RESPONSÁVEL — tipo, marca, resumo e a resposta ao robô', async () => {
    await gravarAssuntos({ vaga: { modo: 'recado' } });
    const r: any = await cardapioSvc.abrirAtendimento(token, { tipo: 'vaga', telefone: '21977334410', cliente: 'Larissa', mensagem: MSG_DA_VAGA, urgente: true }, SENHA);
    expect(r).toEqual({
      ok: true,
      id: expect.any(String),
      prioridade: 'normal',
      paraOResponsavel: true,
      assunto: 'vaga',
      paraOCliente: TEXTO_PADRAO_DO_RECADO.vaga,
      posicao: null,
      comAlguem: false,
    });
    const c = await caso(r.id);
    expect(c).toMatchObject({ tipo: 'vaga', prioridade: 'normal', status: 'aberto', canal: 'whatsapp', mensagem: MSG_DA_VAGA, responsavel_id: null });
    expect(c.detalhe.responsavel).toEqual({ assunto: 'vaga', em: expect.any(String) });
    expect(Math.abs(new Date(c.detalhe.responsavel.em).getTime() - Date.now())).toBeLessThan(60_000);
    expect(c.detalhe.recado).toBeUndefined(); // não é o recado da abertura (F1)
    expect(c.detalhe.robo).toMatchObject({
      assunto: 'Vaga: atendente de balcão',
      quem: 'Larissa, 2 anos em lanchonete',
      contato: 'este WhatsApp',
      jaFez: 'agradeci e disse que o responsável fala com ela',
    });
    // a tela só relê a fila: nada de "caso novo" (não toca, e o aviso não leva o caso a quem não é da gestão)
    expect(avisos.filter((a) => a.ev === 'atendimento.novo')).toEqual([]);
    expect(avisos).toContainEqual({ ev: 'atendimento.mudou', p: { tenantId: T, id: r.id, motivo: 'recado_para_o_responsavel' } });
    // NÃO cala o robô no número (a caixa vê o chamado)
    const pausa = await estadoDaPausa(db, T, '5521977334410');
    expect(pausa.pausado).toBe(false);
    expect(pausa.chamado).toMatchObject({ id: r.id, paraOResponsavel: true });
    // sem posição na fila
    expect((await posicaoNaFila(db, T, r.id)).posicao).toBeNull();
    // o texto da loja vale no lugar do padrão
    await gravarAssuntos({ fornecedor: { modo: 'recado', texto: 'Mande o catálogo para compras@loja.com' } });
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'fornecedor', telefone: '21933330000', mensagem: 'Assunto: caixas' });
    expect(r2).toMatchObject({ paraOResponsavel: true, assunto: 'fornecedor', paraOCliente: 'Mande o catálogo para compras@loja.com' });
  });

  it('assunto em "Como hoje" (ou "não é por aqui"): o caso comum de antes — tipo humano, na fila, com posição, e cala o robô', async () => {
    const r: any = await cardapioSvc.abrirAtendimento(token, { tipo: 'vaga', telefone: '21977330001', mensagem: 'Motivo: quer emprego' }, SENHA);
    expect(r).toMatchObject({ ok: true, prioridade: 'normal', posicao: 1, comAlguem: false });
    expect(r.paraOResponsavel).toBeUndefined();
    const c = await caso(r.id);
    expect(c.tipo).toBe('humano');
    expect(c.detalhe?.responsavel).toBeUndefined();
    expect(avisos.some((a) => a.ev === 'atendimento.novo' && a.p.chamado.id === r.id)).toBe(true);
    expect((await estadoDaPausa(db, T, '21977330001')).pausado).toBe(true);
    await gravarAssuntos({ vaga: { modo: 'nao' } });
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'vaga', telefone: '21977330002' });
    expect(r2.paraOResponsavel).toBeUndefined();
    expect((await caso(r2.id)).tipo).toBe('humano');
  });

  it('somar: só ao recado do MESMO assunto (12 h); outro assunto é outro recado; o mesmo cliente nunca soma recado e caso comum', async () => {
    await gravarAssuntos({ vaga: { modo: 'recado' }, fornecedor: { modo: 'recado' } });
    const tel = '21966660000';
    const r1: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'vaga', telefone: tel, mensagem: 'Assunto: vaga de chapeiro' });
    const em1 = (await caso(r1.id)).detalhe.responsavel.em;
    avisos.length = 0;
    const r2: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'vaga', telefone: `55${tel}`, mensagem: 'Contato: rh@larissa.com', prioridade: 'urgente' });
    expect(r2).toMatchObject({ id: r1.id, jaAberto: true, paraOResponsavel: true, posicao: null, paraOCliente: TEXTO_PADRAO_DO_RECADO.vaga });
    const c = await caso(r1.id);
    expect(c.mensagem).toBe('Assunto: vaga de chapeiro\nContato: rh@larissa.com');
    expect(c.prioridade).toBe('normal'); // recado não é urgência
    expect(c.detalhe.responsavel.em).toBe(em1); // a marca fica (quando o robô deixou)
    expect(c.detalhe.robo).toMatchObject({ contato: 'rh@larissa.com' });
    expect(avisos).toEqual([{ ev: 'atendimento.mudou', p: { tenantId: T, id: r1.id, motivo: 'robo_somou' } }]);
    // outro assunto: outro recado
    const r3: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'fornecedor', telefone: tel, mensagem: 'Assunto: embalagens' });
    expect(r3.id).not.toBe(r1.id);
    // caso comum do mesmo cliente: não soma no recado (vai para a fila) — e o recado não soma nele
    const r4: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: tel, mensagem: 'Motivo: quer falar com alguém' });
    expect([r1.id, r3.id]).not.toContain(r4.id);
    expect(r4).toMatchObject({ posicao: 1 });
    expect((await caso(r4.id)).tipo).toBe('humano');
    const r5: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'vaga', telefone: tel, mensagem: 'Já fiz: de novo' });
    expect(r5.id).toBe(r1.id);
    expect((await caso(r4.id)).mensagem).toBe('Motivo: quer falar com alguém');
    // com o caso comum aberto, ele é quem manda na conversa: o robô fica calado por ele (o recado não o solta)
    expect(await estadoDaPausa(db, T, tel)).toMatchObject({ pausado: true, motivo: 'chamado', chamado: { id: r4.id } });
    // passadas as 12 h, um recado novo
    await q(`update atendimento_chamado set criado_em = now() - interval '13 hours' where id = $1`, [r1.id]);
    const r6: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'vaga', telefone: tel });
    expect(r6.id).not.toBe(r1.id);
    expect((await q(`select count(*)::int as n from atendimento_chamado where tenant_id = $1`, [T]))[0].n).toBe(4);
  });

  it('caso comum aberto + o robô deixa o recado: o recado nasce à parte e o caso comum não muda', async () => {
    await gravarAssuntos({ parceria: { modo: 'recado' } });
    const comum = await chamado({ telefone: '21955550000' });
    const r: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'parceria', telefone: '21955550000', mensagem: 'Assunto: permuta' });
    expect(r.id).not.toBe(comum);
    expect(r).toMatchObject({ paraOResponsavel: true, assunto: 'parceria' });
    expect((await caso(comum)).mensagem).toBeNull();
  });

  it('o aviso ao gerente ignora o recado para o responsável — e os recados velhos na frente não seguram o caso comum (V84)', async () => {
    const recados: string[] = [];
    for (let i = 0; i < 3; i++) recados.push(await chamado({ tipo: 'vaga', criado_em: new Date(Date.now() - (3 + i) * 3_600_000), detalhe: marca() }));
    const comum = await chamado({ criado_em: new Date(Date.now() - 10 * 60_000) });
    expect(await fila.escalar([T], 1)).toBe(1); // limite 1: os recados (mais velhos) não ocupam a vaga
    expect((await caso(comum)).detalhe.escalado).toMatchObject({ minutos: 3 });
    for (const id of recados) expect((await caso(id)).detalhe.escalado).toBeUndefined();
    expect(await fila.escalar([T])).toBe(0);
  });

  it('o chamar_atendente com a leitura dos assuntos caindo: o caso comum (como hoje), com aviso no log — o robô nunca fica sem chamar', async () => {
    await gravarAssuntos({ vaga: { modo: 'recado' } });
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const r: any = await abrirChamadoPeloRobo(dbComAssuntosCaindo(), emitir, T, null, { tipo: 'vaga', telefone: '21911110000' });
      expect(r.paraOResponsavel).toBeUndefined();
      expect((await caso(r.id)).tipo).toBe('humano');
      expect(aviso.mock.calls.some((x) => String(x[0]).includes('assuntos do atendente não lidos') && String(x[0]).includes('conexão caiu'))).toBe(true);
    } finally {
      aviso.mockRestore();
    }
  });

  // ───────────────────────── a fila ─────────────────────────

  it('a fila: o recado só com comRecados E para a gestão — situação "responsavel", sem posição; as contagens sem ele + paraOResponsavel', async () => {
    const r = await chamado({ tipo: 'vaga', telefone: '21944440000', detalhe: marca() });
    const comum = await chamado({ criado_em: new Date(Date.now() - 60_000) });
    const pego = await chamado({ tipo: 'fornecedor', detalhe: marca('fornecedor'), responsavel_id: ana }); // a gerente pegou

    const com = await svc.fila(gerente(), null, { comRecados: true });
    expect(com.casos.find((c: any) => c.id === r)).toMatchObject({
      situacao: 'responsavel',
      posicao: null,
      responsavel: { assunto: 'vaga', em: expect.any(String) },
      recado: null,
    });
    expect(com.casos.find((c: any) => c.id === comum)).toMatchObject({ situacao: 'fila', posicao: 1, responsavel: null });
    expect(com.casos.find((c: any) => c.id === pego)).toMatchObject({ situacao: 'com_alguem', responsavel: { assunto: 'fornecedor' } });
    expect(com.contagens).toMatchObject({ abertos: 2, naFila: 1, comigo: 1, paraOResponsavel: 1, paraAbertura: 0 });

    // sem comRecados (o app Android, as telas antigas): o recado que espera não vem; as contagens são as mesmas
    const sem = await svc.fila(gerente(), null);
    expect(sem.casos.map((c: any) => c.id).sort()).toEqual([comum, pego].sort());
    expect(sem.contagens).toEqual(com.contagens);

    // presidente e o suporte da distribuição: como a gerente
    for (const cat of ['presidente', 'suporte']) {
      const f = await svc.fila(quem(randomUUID(), cat), null, { comRecados: true });
      expect(f.casos.some((c: any) => c.id === r)).toBe(true);
      expect(f.contagens.paraOResponsavel).toBe(1);
    }

    // execução e supervisão: o servidor nem devolve — nem com comRecados; nem o que a gerente pegou; contagem 0
    for (const [id, cat] of [
      [edu, 'execucao'],
      [sara, 'supervisao'],
    ]) {
      const f = await svc.fila(quem(id, cat), null, { comRecados: true });
      expect(f.casos.map((c: any) => c.id)).toEqual([comum]);
      expect(f.contagens).toMatchObject({ abertos: 1, naFila: 1, paraOResponsavel: 0 });
    }

    // passaram o recado para a execução: ele é dela (com alguém) e ela o vê
    await q(`update atendimento_chamado set responsavel_id = $2 where id = $1`, [r, edu]);
    const doEdu = await svc.fila(quem(edu, 'execucao'), null);
    expect(doEdu.casos.find((c: any) => c.id === r)).toMatchObject({ situacao: 'com_alguem', responsavel: { assunto: 'vaga' } });
    expect(doEdu.contagens).toMatchObject({ comigo: 1, paraOResponsavel: 0 });
  });

  it('resolvidos de hoje e a lista antiga (GET /atendimento): quem não é da gestão não recebe o recado para o responsável', async () => {
    const resolvido = await chamado({ tipo: 'vaga', detalhe: marca(), status: 'resolvido' });
    const comumResolvido = await chamado({ status: 'resolvido' });
    const aberto = await chamado({ tipo: 'parceria', detalhe: marca('parceria') });
    const comum = await chamado();
    const ids = (l: any[]) => l.map((c: any) => c.id).sort();
    expect(ids(await svc.resolvidosHoje(gerente(), null))).toEqual([resolvido, comumResolvido].sort());
    expect((await svc.resolvidosHoje(gerente(), null)).find((c: any) => c.id === resolvido)).toMatchObject({ responsavel: { assunto: 'vaga' } });
    expect(ids(await svc.resolvidosHoje(quem(edu, 'execucao'), null))).toEqual([comumResolvido]);
    expect(ids(await ctl.listar(gerente()))).toEqual([aberto, comum].sort());
    expect(ids(await ctl.listar(quem(edu, 'execucao')))).toEqual([comum]);
    expect(ids(await ctl.listar(quem(sara, 'supervisao')))).toEqual([comum]);
    // a contagem dos resolvidos acompanha a lista
    expect((await svc.fila(quem(edu, 'execucao'), null)).contagens.resolvidosHoje).toBe(1);
    expect((await svc.fila(gerente(), null)).contagens.resolvidosHoje).toBe(2);
  });

  // ───────────────────────── os ajustes ─────────────────────────

  it('GET dos ajustes: sempre os três assuntos com os padrões ("Como hoje", sem texto) e as opções', async () => {
    const r: any = await ctl.ajustes(gerente(), null);
    expect(r.assuntos).toEqual(assuntosPadrao());
    expect(r.assuntosOpcoes).toEqual({
      assuntos: ['fornecedor', 'vaga', 'parceria'],
      modos: ['hoje', 'recado', 'nao'],
      textoMax: 300,
      textoPadrao: TEXTO_PADRAO_DO_RECADO,
      textoPadraoNao: TEXTO_PADRAO_NAO,
    });
    await gravarAssuntos({ fornecedor: { modo: 'bravo', texto: 'oi' }, vaga: 'recado', imprensa: {} });
    expect((await ctl.ajustes(gerente(), null)).assuntos).toEqual({
      fornecedor: { modo: 'hoje', texto: 'oi' },
      vaga: { modo: 'hoje', texto: null },
      parceria: { modo: 'hoje', texto: null },
    });
  });

  it('PUT: grava o que veio, um assunto não apaga o outro, as outras colunas ficam (V82) e cada mudança vai à auditoria', async () => {
    await q(`insert into robo_config (tenant_id, avisar_gerente_min, equipe_atende, atendente_perfis) values ($1, 5, 'loja', '{"direct":{"perfil":"gentil"}}')`, [T]);
    const r1: any = await ctl.salvarAjustes(gerente(), null, { assuntos: { vaga: { modo: 'recado' } } });
    expect(r1.assuntos.vaga).toEqual({ modo: 'recado', texto: null });
    const r2: any = await ctl.salvarAjustes(gerente(), null, { assuntos: { fornecedor: { modo: 'nao', texto: ' Compras só\npelo site ' } } });
    expect(r2.assuntos).toEqual({
      fornecedor: { modo: 'nao', texto: 'Compras só pelo site' },
      vaga: { modo: 'recado', texto: null },
      parceria: { modo: 'hoje', texto: null },
    });
    expect(await coluna()).toEqual({ vaga: { modo: 'recado' }, fornecedor: { modo: 'nao', texto: 'Compras só pelo site' } });
    const [outras] = await q(`select avisar_gerente_min, equipe_atende, atendente_perfis from robo_config where tenant_id = $1`, [T]);
    expect(outras).toEqual({ avisar_gerente_min: 5, equipe_atende: 'loja', atendente_perfis: { direct: { perfil: 'gentil' } } });
    expect(auditoria.map((a) => [a.acao, a.detalhe])).toEqual([
      ['atendente_assunto_alterado', { assunto: 'vaga', campo: 'modo', de: 'hoje', para: 'recado' }],
      ['atendente_assunto_alterado', { assunto: 'fornecedor', campo: 'modo', de: 'hoje', para: 'nao' }],
      ['atendente_assunto_alterado', { assunto: 'fornecedor', campo: 'texto', de: null, para: 'Compras só pelo site' }],
    ]);
    expect(auditoria.every((a) => a.tipo === 'config' && a.entidadeTipo === 'robo_config' && a.atorId === ana && a.atorPerfil === 'gerente')).toBe(true);
    // nada mudou: nada na auditoria; texto vazio volta ao padrão
    auditoria.length = 0;
    await ctl.salvarAjustes(gerente(), null, { assuntos: { vaga: { modo: 'recado' } } });
    expect(auditoria).toEqual([]);
    const r3: any = await ctl.salvarAjustes(gerente(), null, { assuntos: { fornecedor: { texto: '' } } });
    expect(r3.assuntos.fornecedor).toEqual({ modo: 'nao', texto: null });
    expect(auditoria.map((a) => a.detalhe)).toEqual([{ assunto: 'fornecedor', campo: 'texto', de: 'Compras só pelo site', para: null }]);
  });

  it('linha nova (sem robo_config): o PUT cria a linha com o assunto inteiro', async () => {
    const r = await fila.salvarAssuntos(gerente(), { parceria: { texto: 'Mídia kit: imprensa@loja.com' } });
    expect(r.parceria).toEqual({ modo: 'hoje', texto: 'Mídia kit: imprensa@loja.com' });
    expect(await coluna()).toEqual({ parceria: { modo: 'hoje', texto: 'Mídia kit: imprensa@loja.com' } });
  });

  it('mescla campo a campo: um salvamento que leu ANTES do outro gravar não desfaz o campo do outro (V82)', async () => {
    await gravarAssuntos({ vaga: { modo: 'recado' } });
    let outroGravou = false;
    const dbComCorrida = {
      execute: async (consulta: any) => {
        const r = await db.execute(consulta);
        if (!outroGravou && textoDa(consulta).includes("-> 'atendente_assuntos'")) {
          outroGravou = true;
          await q(`update robo_config set atendente_assuntos = jsonb_set(atendente_assuntos, '{vaga,texto}', '"Currículos: rh@loja.com"') where tenant_id = $1`, [T]);
        }
        return r;
      },
    };
    const r = await salvarAssuntosDoAtendente(dbComCorrida, gerente(), { vaga: { modo: 'nao' } });
    expect(outroGravou).toBe(true);
    expect(r.vaga).toEqual({ modo: 'nao', texto: 'Currículos: rh@loja.com' });
    // assunto com lixo no jsonb (não objeto): recomeça do objeto vazio
    await gravarAssuntos({ vaga: 'lixo', fornecedor: { modo: 'recado' } });
    const r2 = await fila.salvarAssuntos(gerente(), { vaga: { modo: 'recado' } });
    expect(r2.vaga).toEqual({ modo: 'recado', texto: null });
    expect(await coluna()).toEqual({ vaga: { modo: 'recado' }, fornecedor: { modo: 'recado' } });
  });

  it('salvar com vários grupos: a recusa dos assuntos vem ANTES de gravar qualquer grupo (V86)', async () => {
    await q(`insert into robo_config (tenant_id, avisar_gerente_min) values ($1, 5)`, [T]);
    const so: any = new AtendimentoController(naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any, fila, naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any, naoUsar() as any);
    await expect(so.salvarAjustes(gerente(), null, { fila: { avisarGerenteMin: 10 }, assuntos: { fornecedor: { modo: 'talvez' } } })).rejects.toThrow(
      'Fornecedor: escolha "Como hoje", "Deixa recado para o responsável" ou "Responde que não é por aqui".',
    );
    await expect(so.salvarAjustes(gerente(), null, { perfis: { whatsapp: { perfil: 'cordial' } }, assuntos: { vaga: { texto: 'a'.repeat(301) } } })).rejects.toThrow(
      'Vaga de emprego: no máximo 300 letras.',
    );
    await expect(so.salvarAjustes(gerente(), null, { fila: { avisarGerenteMin: 10 }, assuntos: { imprensa: { modo: 'recado' } } })).rejects.toThrow('não existe');
    // e a recusa de OUTRO grupo também não grava os assuntos
    await expect(so.salvarAjustes(gerente(), null, { assuntos: { vaga: { modo: 'recado' } }, equipe: { antesMin: 45 } })).rejects.toThrow('Começa a atender');
    const [l] = await q(`select avisar_gerente_min, atendente_perfis, atendente_assuntos from robo_config where tenant_id = $1`, [T]);
    expect(l).toEqual({ avisar_gerente_min: 5, atendente_perfis: {}, atendente_assuntos: {} });
    expect(auditoria).toEqual([]);
  });

  it('num banco sem a 381 (ou sem a robo_config): os padrões, e a TRANSAÇÃO de quem chama segue', async () => {
    const esquema = `assuntos_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    await q(`create schema ${esquema}`);
    const isolado = new Pool({ connectionString: URL_PG, options: `-c search_path=${esquema},public` });
    try {
      const c = await isolado.connect();
      try {
        await c.query('begin');
        const dbTx = drizzle(c as any, { schema });
        expect(await assuntosDaEmpresa(dbTx, T)).toEqual(assuntosPadrao());
        await c.query(`create table ${esquema}.robo_config (tenant_id uuid primary key, equipe_atende text)`);
        await c.query(`insert into ${esquema}.robo_config (tenant_id) values ($1)`, [T]);
        expect(await assuntosDaEmpresa(dbTx, T)).toEqual(assuntosPadrao());
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

  // ───────────────────────── a rota das instruções ─────────────────────────

  describe('a rota de instruções do robô (publico/bot/instrucoes)', () => {
    const u = {} as any;
    const instrucoes = (rota: RoboConsultasController, fluxo = '1') => rota.instrucoes(fluxo, INSTANCIA, '', undefined, SENHA) as Promise<any>;

    it('tudo em "Como hoje": sem a seção; com recado: a seção do WhatsApp nos dois fluxos', async () => {
      const rota = new RoboConsultasController(cardapioSvc);
      const hoje = await instrucoes(rota);
      expect(hoje.texto).not.toContain('ASSUNTOS QUE NÃO SÃO PEDIDO');
      await gravarAssuntos({ vaga: { modo: 'recado' }, parceria: { modo: 'nao', texto: 'Parcerias pelo e-mail mkt@loja.com.' } });
      for (const fluxo of ['1', '2']) {
        const r = await instrucoes(rota, fluxo);
        expect(r.texto).toContain('ASSUNTOS QUE NÃO SÃO PEDIDO (escolhidos pela loja)');
        expect(r.texto).toContain('(tipo = vaga;');
        expect(r.texto).toContain('exatamente: "Parcerias pelo e-mail mkt@loja.com."');
        expect(r.texto).toContain('não peça telefone: o contato é este número do WhatsApp');
      }
    });

    it('erro ao ler os assuntos: as instruções de hoje (o robô não cai), com aviso no log', async () => {
      const hoje = (await instrucoes(new RoboConsultasController(cardapioSvc))).texto;
      await gravarAssuntos({ vaga: { modo: 'recado' } });
      const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      try {
        const rotaQueFalha = new RoboConsultasController(new CardapioService(dbComAssuntosCaindo(), u, u, u, u, u, { emit: () => true } as any, u));
        const r = await instrucoes(rotaQueFalha);
        expect(r.texto).toBe(hoje);
        expect(aviso.mock.calls.some((x) => String(x[0]).includes('assuntos do atendente (whatsapp) não lidos') && String(x[0]).includes('conexão caiu'))).toBe(true);
      } finally {
        aviso.mockRestore();
      }
      // com a leitura de volta, a seção volta
      expect((await instrucoes(new RoboConsultasController(cardapioSvc))).texto).toContain('ASSUNTOS QUE NÃO SÃO PEDIDO');
    });
  });
});
