import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AtendimentoService } from './atendimento.service';
import { abrirChamadoPeloRobo, clienteRespondeu } from './abrir-chamado';
import { compararNaFila } from './fila';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A FILA DA CENTRAL DE ATENDIMENTO (Onda 1, mig 350 — protótipo aprovado pelo dono em 02/11/2026), contra o Postgres
// real: a ordem e as contagens são SQL, a chave do telefone é SQL e o "hoje" é o da operação (ERR-120).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('atendimento-fila-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

// A equipe do "Passar" lê a situação do app de atendimento (mig 353), que mora só na nuvem: o teste aplica as migrations
// (o banco do CI é o de uma loja — ERR-329).
const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('fila da central de atendimento (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let svc: AtendimentoService;
  const avisos: any[] = [];
  const auditoria: any[] = [];
  const T = randomUUID();
  let lojaA: string;
  let lojaB: string;
  let ana: string; // gerente
  let bruno: string; // execução
  let carla: string; // bloqueada
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const gerente = () => ({ tenantId: T, colaboradorId: ana, categoria: 'gerente' }) as any;
  const atendente = () => ({ tenantId: T, colaboradorId: bruno, categoria: 'execucao' }) as any;
  const emitir = (ev: string, p: any) => avisos.push({ ev, p });

  const chamado = async (extra: Record<string, unknown> = {}) => {
    const c = {
      tipo: 'humano',
      telefone: null,
      prioridade: 'normal',
      unidade_id: lojaA,
      criado_em: new Date(Date.now() - 600_000),
      prazo_em: null,
      responsavel_id: null,
      aguardando_desde: null,
      canal: 'whatsapp',
      status: 'aberto',
      ...extra,
    } as any;
    const [{ id }] = await q(
      `insert into atendimento_chamado (tenant_id, unidade_id, tipo, telefone, prioridade, criado_em, prazo_em,
                                        responsavel_id, aguardando_desde, canal, status, resolvido_em)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [T, c.unidade_id, c.tipo, c.telefone, c.prioridade, c.criado_em, c.prazo_em, c.responsavel_id, c.aguardando_desde,
        c.canal, c.status, c.resolvido_em ?? null],
    );
    return id as string;
  };

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
    for (const m of ['342_robo_pausa_e_config.sql', '353_app_atendimento.sql']) await aplicar(m);
    svc = new AtendimentoService(db, { emit: emitir } as any, {} as any, { registrar: async (e: any) => void auditoria.push(e) } as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste fila de atendimento')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    [{ id: ana }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana') returning id`, [T]);
    [{ id: bruno }] = await q(`insert into colaborador (tenant_id, nome) values ($1, 'Bruno') returning id`, [T]);
    [{ id: carla }] = await q(`insert into colaborador (tenant_id, nome, status) values ($1, 'Carla', 'bloqueado') returning id`, [T]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from colaborador where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from unidade where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    auditoria.length = 0;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
  });

  it('a ordem do banco é a da regra: prazo, urgente, quem espera há mais tempo — e a posição de quem espera alguém', async () => {
    const agora = Date.now();
    const novo = await chamado({ criado_em: new Date(agora - 60_000) });
    const velho = await chamado({ criado_em: new Date(agora - 900_000) });
    const urgente = await chamado({ prioridade: 'urgente', criado_em: new Date(agora - 30_000) });
    const prazoLongo = await chamado({ canal: '99food', prazo_em: new Date(agora + 600_000) });
    const prazoCurto = await chamado({ canal: 'ifood', prazo_em: new Date(agora + 120_000) });
    const comAna = await chamado({ responsavel_id: ana, criado_em: new Date(agora - 1_200_000) });

    const { casos, eu } = await svc.fila(gerente(), null);
    expect(eu).toBe(ana); // quem pediu a fila (a tela marca "Comigo" sem ler o token)
    expect(casos.map((c: any) => c.id)).toEqual([prazoCurto, prazoLongo, urgente, comAna, velho, novo]);
    // a mesma ordem da regra pura (o app e a tela usam a regra; o banco, o SQL)
    expect([...casos].sort(compararNaFila).map((c: any) => c.id)).toEqual(casos.map((c: any) => c.id));
    const pos = Object.fromEntries(casos.map((c: any) => [c.id, c.posicao]));
    expect(pos).toEqual({ [prazoCurto]: null, [prazoLongo]: null, [urgente]: 1, [comAna]: null, [velho]: 2, [novo]: 3 });
    const doAna = casos.find((c: any) => c.id === comAna);
    expect(doAna).toMatchObject({ responsavelNome: 'Ana', situacao: 'com_alguem' });
  });

  it('a loja em uso vê os seus casos e os sem loja (o robô atende a empresa toda); o presidente na rede vê todos', async () => {
    const daA = await chamado({ unidade_id: lojaA });
    const daB = await chamado({ unidade_id: lojaB });
    const semLoja = await chamado({ unidade_id: null });
    const ids = async (u: string | null) => (await svc.fila(gerente(), u)).casos.map((c: any) => c.id).sort();
    expect(await ids(lojaA)).toEqual([daA, semLoja].sort());
    expect(await ids(lojaB)).toEqual([daB, semLoja].sort());
    expect(await ids(null)).toEqual([daA, daB, semLoja].sort());
  });

  it('as contagens vêm do banco: abertos, com prazo, na fila, comigo, aguardando e resolvidos hoje', async () => {
    await chamado({});
    await chamado({ prazo_em: new Date(Date.now() + 300_000), canal: 'ifood' });
    await chamado({ responsavel_id: ana });
    await chamado({ responsavel_id: bruno, aguardando_desde: new Date() });
    await chamado({ status: 'resolvido', resolvido_em: new Date() });
    await chamado({ status: 'resolvido', resolvido_em: new Date(Date.now() - 3 * 86_400_000) }); // de outro dia
    const { contagens } = await svc.fila(gerente(), null);
    expect(contagens).toEqual({ abertos: 4, comPrazo: 1, naFila: 1, comigo: 1, aguardando: 1, resolvidosHoje: 1 });
  });

  it('"resolvidos hoje" é o dia da operação mesmo com a sessão do banco em outro fuso (V46)', async () => {
    const hoje = await chamado({ status: 'resolvido', resolvido_em: new Date() });
    await chamado({ status: 'resolvido', resolvido_em: new Date(Date.now() - 2 * 86_400_000) });
    // ontem às 23h no relógio da operação: é de ONTEM, mesmo que no fuso da sessão (UTC na nuvem) já seja "hoje"
    const [{ ontem23 }] = await q(
      `select (date_trunc('day', now() at time zone 'America/Sao_Paulo') - interval '1 hour') at time zone 'America/Sao_Paulo' as ontem23`,
    );
    await chamado({ status: 'resolvido', resolvido_em: ontem23 });
    const fusoTokio = new Pool({ connectionString: URL_PG, options: '-c timezone=Asia/Tokyo' });
    try {
      const outro = new AtendimentoService(drizzle(fusoTokio, { schema }) as any, { emit: () => true } as any, {} as any);
      const lista = await outro.resolvidosHoje(gerente(), null);
      expect(lista.map((c: any) => c.id)).toEqual([hoje]);
    } finally {
      await fusoTokio.end();
    }
  });

  it('pegar: só um pega; repetir não muda a hora; o outro ouve quem pegou; resolvido não se pega', async () => {
    const id = await chamado({});
    const r = await svc.pegar(gerente(), id);
    expect(r).toMatchObject({ ok: true, responsavelId: ana });
    const [{ pego_em: primeira }] = await q(`select pego_em from atendimento_chamado where id = $1`, [id]);
    await svc.pegar(gerente(), id);
    const [{ pego_em: segunda }] = await q(`select pego_em from atendimento_chamado where id = $1`, [id]);
    expect(new Date(segunda).getTime()).toBe(new Date(primeira).getTime());
    await expect(svc.pegar(atendente(), id)).rejects.toThrow('Ana já pegou este caso.');
    expect(avisos.filter((a) => a.ev === 'atendimento.mudou').length).toBe(2);

    const feito = await chamado({ status: 'resolvido', resolvido_em: new Date() });
    await expect(svc.pegar(gerente(), feito)).rejects.toThrow('Este caso já foi resolvido.');
    await expect(svc.pegar(gerente(), randomUUID())).rejects.toThrow('Caso não encontrado.');
  });

  it('pegar ao mesmo tempo: a gravação é condicional, um só fica com o caso', async () => {
    const id = await chamado({});
    const r = await Promise.allSettled([svc.pegar(gerente(), id), svc.pegar(atendente(), id)]);
    expect(r.filter((x) => x.status === 'fulfilled').length).toBe(1);
    const [{ responsavel_id }] = await q(`select responsavel_id from atendimento_chamado where id = $1`, [id]);
    expect([ana, bruno]).toContain(responsavel_id);
  });

  it('passar: para quem está ativo, ou de volta para a fila; fica na auditoria; a execução não tira o caso de outra pessoa', async () => {
    const id = await chamado({});
    await svc.passar(gerente(), id, { para: bruno });
    expect((await q(`select responsavel_id, pego_em from atendimento_chamado where id = $1`, [id]))[0]).toMatchObject({
      responsavel_id: bruno,
    });
    expect(auditoria[0]).toMatchObject({ acao: 'passou_caso', entidadeId: id, detalhe: { de: null, para: bruno } });

    await expect(svc.passar(gerente(), id, { para: carla })).rejects.toThrow('Essa pessoa não está ativa na equipe.');
    await expect(svc.passar(gerente(), id, { para: 'nao-e-id' })).rejects.toThrow('Escolha para quem passar o caso.');

    const daAna = await chamado({ responsavel_id: ana });
    await expect(svc.passar(atendente(), daAna, { para: bruno })).rejects.toThrow('Só a gestão passa o caso de outra pessoa.');

    await svc.passar(gerente(), id, { para: null });
    expect((await q(`select responsavel_id, pego_em from atendimento_chamado where id = $1`, [id]))[0]).toEqual({
      responsavel_id: null,
      pego_em: null,
    });
    expect(auditoria[1]).toMatchObject({ acao: 'devolveu_caso_para_fila', detalhe: { de: bruno, para: null } });
  });

  it('aguardar o cliente: quem marca fica com o caso; o cliente responde no WhatsApp e o caso volta para a fila', async () => {
    const id = await chamado({ telefone: '21987654321' });
    await expect(svc.aguardar(gerente(), id, {})).rejects.toThrow('Informe "aguardando" (true ou false).');
    await svc.aguardar(gerente(), id, { aguardando: true });
    let [c] = await q(`select responsavel_id, aguardando_desde from atendimento_chamado where id = $1`, [id]);
    expect(c.responsavel_id).toBe(ana);
    expect(c.aguardando_desde).not.toBeNull();
    expect((await svc.fila(gerente(), null)).casos[0]).toMatchObject({ id, situacao: 'aguardando' });

    avisos.length = 0;
    // o cliente responde com o número em outro formato (com 55): a chave do telefone acha o caso
    expect(await clienteRespondeu(db, emitir, T, '5521987654321')).toBe(1);
    [c] = await q(`select responsavel_id, aguardando_desde from atendimento_chamado where id = $1`, [id]);
    expect(c).toEqual({ responsavel_id: ana, aguardando_desde: null });
    expect(avisos).toEqual([{ ev: 'atendimento.mudou', p: { tenantId: T, id, motivo: 'cliente_respondeu' } }]);
    // de novo: não há o que voltar
    expect(await clienteRespondeu(db, emitir, T, '21987654321')).toBe(0);
  });

  it('o cliente que responde nunca derruba a entrada da mensagem', async () => {
    expect(await clienteRespondeu({} as any, emitir, T, '21987654321')).toBe(0);
    expect(await clienteRespondeu(db, emitir, T, null)).toBe(0);
  });

  it('resolver tira o "aguardando" e avisa a tela', async () => {
    const id = await chamado({ responsavel_id: ana, aguardando_desde: new Date() });
    await svc.resolver(T, id, ana);
    expect((await q(`select status, aguardando_desde from atendimento_chamado where id = $1`, [id]))[0]).toEqual({
      status: 'resolvido',
      aguardando_desde: null,
    });
    expect(avisos.some((a) => a.ev === 'atendimento.mudou' && a.p.id === id && a.p.motivo === 'resolveu')).toBe(true);
  });

  it('a equipe do "Passar": só quem está ativo, da loja em uso ou sem loja, com a marca de quem pergunta', async () => {
    const [{ id: daB }] = await q(`insert into colaborador (tenant_id, nome, unidade_id) values ($1, 'Davi da B', $2) returning id`, [T, lojaB]);
    try {
      const nomes = async (u: string | null) => (await svc.equipe(gerente(), u)).map((p: any) => p.nome);
      expect(await nomes(lojaA)).toEqual(['Ana', 'Bruno']); // Carla está bloqueada; Davi é da loja B
      expect(await nomes(null)).toEqual(['Ana', 'Bruno', 'Davi da B']);
      expect((await svc.equipe(gerente(), null)).find((p: any) => p.eu)?.nome).toBe('Ana');
      // Quem está no app agora vem com a situação ("Bruno · ocupado: caixa"); quem parou de avisar há mais de 3 min, não.
      expect((await svc.equipe(gerente(), lojaA)).every((p: any) => p.presenca === null)).toBe(true);
      await q(
        `insert into atendimento_presenca (colaborador_id, tenant_id, estado, motivo, atualizado_em)
         values ($1, $3, 'ocupado', 'caixa', now()), ($2, $3, 'disponivel', null, now() - interval '4 minutes')`,
        [bruno, ana, T],
      );
      const porNome = Object.fromEntries((await svc.equipe(gerente(), lojaA)).map((p: any) => [p.nome, p.presenca]));
      expect(porNome).toEqual({ Ana: null, Bruno: { estado: 'ocupado', motivo: 'caixa' } });
    } finally {
      await q(`delete from atendimento_presenca where tenant_id = $1`, [T]);
      await q(`delete from colaborador where id = $1`, [daB]);
    }
  });

  it('o chamado do robô nasce do canal WhatsApp; o chamado antigo (sem canal) mostra o canal do pedido', async () => {
    const r: any = await abrirChamadoPeloRobo(db, emitir, T, null, { tipo: 'humano', telefone: '21912345678' });
    expect((await q(`select canal from atendimento_chamado where id = $1`, [r.id]))[0].canal).toBe('whatsapp');

    const [{ id: ped }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status, display_id)
       values ($1, $2, 'ifood', 'delivery', '[]', 10, 'confirmado', '4521') returning id`,
      [T, lojaA],
    );
    const antigo = await chamado({ canal: null, tipo: 'cancelamento' });
    await q(`update atendimento_chamado set pedido_id = $2 where id = $1`, [antigo, ped]);
    const caso = (await svc.fila(gerente(), null)).casos.find((c: any) => c.id === antigo);
    expect(caso).toMatchObject({ canal: 'ifood', pedidoNaPlataforma: '4521', pedidoStatus: 'confirmado' });
  });
});
