import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { MOTIVO_BAIXA_NAO_ACEITO, baixarPendenciasAntigas, escopoDoTurno, pendenciasDoTurno } from './pendencias-turno';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PENDÊNCIAS DO TURNO contra o Postgres real: o que conta como pendente em cada turno, a baixa
// administrativa das antigas (sem efeito colateral) e o fechamento do turno do delivery barrado.
// Sem banco (`TEST_PG_URL`), pula.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pendencias-turno.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

it('o caixa do delivery cuida das entregas; qualquer outro, das retiradas', () => {
  expect(escopoDoTurno('delivery')).toBe('delivery');
  for (const o of ['pdv', undefined, null, '', 'outro']) expect(escopoDoTurno(o as any)).toBe('pdv');
});

descrever('pendências do turno (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const AGORA = new Date('2026-10-02T21:00:00-03:00');
  const ha = (horas: number) => new Date(AGORA.getTime() - horas * 3_600_000);

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `teste pendências ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  /** Um pedido com o mínimo: tipo, status, quando foi criado e, se for o caso, para quando foi agendado. */
  async function pedido(tenant: string, p: { tipo?: string; status?: string; criado?: Date; agendamento?: Date | null; unidade?: string | null; canal?: string }) {
    const r = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, criado_em, agendamento, unidade_id, cliente_nome)
       values ($1, $2, $3, $4, 30, $5, $6, $7, 'Cliente teste') returning id`,
      [tenant, p.canal ?? 'anotaai', p.tipo ?? 'entrega', p.status ?? 'confirmado', p.criado ?? ha(1), p.agendamento ?? null, p.unidade ?? null],
    );
    return r[0].id as string;
  }
  /** Quem abre e fecha o caixa tem de existir (o caixa aponta para o colaborador). */
  const pessoa = async (tenant: string) => (await q(`insert into colaborador (tenant_id, nome) values ($1, 'Operador teste') returning id`, [tenant]))[0].id as string;
  const linha = async (id: string) => (await q(`select status, concluido_em, cancelado_em, motivo_cancelamento, updated_at from pedido_externo where id = $1`, [id]))[0];
  const servico = () => new (FinanceiroService as any)(db, auditoria, { imprimirCupomCaixa: async () => undefined }) as FinanceiroService;
  const abrirCaixa = async (tenant: string, origem: string, dono: string) =>
    (await q(`insert into caixa_sessao (tenant_id, origem, status, valor_abertura, aberta_por_id) values ($1, $2, 'aberta', 0, $3) returning id`, [tenant, origem, dono]))[0].id as string;
  const statusCaixa = async (id: string) => (await q(`select status from caixa_sessao where id = $1`, [id]))[0].status as string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      await q(`delete from lancamento_caixa where tenant_id = $1`, [id]);
      await q(`delete from caixa_sessao where tenant_id = $1`, [id]);
      await q(`delete from pedido_externo where tenant_id = $1`, [id]);
      await q(`delete from colaborador where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });
  beforeEach(() => auditoria.registrar.mockClear());

  it('delivery conta as entregas em aberto; balcão conta as retiradas; concluído e cancelado não contam', async () => {
    const t = await empresa();
    const outra = await empresa();
    for (const status of ['novo', 'confirmado', 'pronto', 'despachado', 'entregue']) await pedido(t, { tipo: 'entrega', status });
    await pedido(t, { tipo: 'entrega', status: 'concluido' });
    await pedido(t, { tipo: 'entrega', status: 'cancelado' });
    await pedido(t, { tipo: 'retirada', status: 'pronto' });
    await pedido(t, { tipo: 'retirada', status: 'novo', canal: 'totem' });
    await pedido(outra, { tipo: 'entrega', status: 'confirmado' }); // de outra empresa: nunca aparece
    const d = await pendenciasDoTurno(db, t, null, 'delivery', AGORA);
    expect(d.total).toBe(5);
    expect(d.itens.map((p) => p.status).sort()).toEqual(['confirmado', 'despachado', 'entregue', 'novo', 'pronto']);
    expect(d.itens.every((p) => p.tipo === 'entrega')).toBe(true);
    const b = await pendenciasDoTurno(db, t, null, 'pdv', AGORA);
    expect(b.total).toBe(2);
    expect(b.itens.every((p) => p.tipo === 'retirada')).toBe(true);
  });

  it('encomenda agendada para mais tarde não é pendência deste turno; a que já passou da hora é', async () => {
    const t = await empresa();
    await pedido(t, { tipo: 'retirada', status: 'confirmado', agendamento: new Date(AGORA.getTime() + 2 * 3_600_000) }); // daqui a 2 h
    await pedido(t, { tipo: 'retirada', status: 'confirmado', agendamento: new Date(AGORA.getTime() + 26 * 3_600_000) }); // amanhã
    const atrasada = await pedido(t, { tipo: 'retirada', status: 'confirmado', agendamento: ha(3) });
    const r = await pendenciasDoTurno(db, t, null, 'pdv', AGORA);
    expect(r.itens.map((p) => p.id)).toEqual([atrasada]);
  });

  it('por loja: vê os pedidos da loja e os sem loja (marketplace); não vê os de outra loja', async () => {
    const t = await empresa();
    const lojaA = randomUUID();
    const lojaB = randomUUID();
    const a = await pedido(t, { unidade: lojaA });
    const semLoja = await pedido(t, { unidade: null });
    await pedido(t, { unidade: lojaB });
    const r = await pendenciasDoTurno(db, t, lojaA, 'delivery', AGORA);
    expect(r.itens.map((p) => p.id).sort()).toEqual([a, semLoja].sort());
    expect((await pendenciasDoTurno(db, t, null, 'delivery', AGORA)).total).toBe(3); // presidente na rede vê tudo
  });

  it('marca o que está parado há mais de 24 h e quanto disso a baixa alcança (em rota fica de fora)', async () => {
    const t = await empresa();
    await pedido(t, { tipo: 'retirada', status: 'pronto', criado: ha(30) });
    await pedido(t, { tipo: 'retirada', status: 'pronto', criado: ha(2) });
    const r = await pendenciasDoTurno(db, t, null, 'pdv', AGORA);
    expect(r).toMatchObject({ total: 2, antigas: 1, baixaveis: 1, horasAntiga: 24 });
    expect(r.itens.map((p) => p.antiga)).toEqual([false, true]); // os mais novos primeiro
    await pedido(t, { tipo: 'entrega', status: 'despachado', criado: ha(50) });
    await pedido(t, { tipo: 'entrega', status: 'confirmado', criado: ha(50) });
    expect(await pendenciasDoTurno(db, t, null, 'delivery', AGORA)).toMatchObject({ total: 2, antigas: 2, baixaveis: 1 });
  });

  it('baixa administrativa: aceito vira concluído, nunca aceito vira cancelado; recente, em rota e outro turno ficam como estão', async () => {
    const t = await empresa();
    const outra = await empresa();
    const pronto = await pedido(t, { tipo: 'retirada', status: 'pronto', criado: ha(72) });
    const confirmado = await pedido(t, { tipo: 'retirada', status: 'confirmado', criado: ha(30) });
    const novo = await pedido(t, { tipo: 'retirada', status: 'novo', criado: ha(40), canal: 'cardapio_web' });
    const recente = await pedido(t, { tipo: 'retirada', status: 'pronto', criado: ha(5) });
    const entregaAntiga = await pedido(t, { tipo: 'entrega', status: 'confirmado', criado: ha(72) }); // outro turno
    const alheio = await pedido(outra, { tipo: 'retirada', status: 'pronto', criado: ha(72) });
    const antes = (await linha(pronto)).updated_at;

    const r = await baixarPendenciasAntigas(db, t, null, 'pdv', AGORA);
    expect(r).toMatchObject({ concluidos: 2, cancelados: 1, porCanal: { anotaai: 2, cardapio_web: 1 } });
    expect(r.ids.sort()).toEqual([pronto, confirmado, novo].sort());

    expect(await linha(pronto)).toMatchObject({ status: 'concluido', cancelado_em: null });
    expect(new Date((await linha(pronto)).concluido_em).getTime()).toBe(AGORA.getTime());
    expect(new Date((await linha(pronto)).updated_at).getTime()).not.toBe(new Date(antes).getTime()); // o sincronismo enxerga
    expect((await linha(confirmado)).status).toBe('concluido');
    expect(await linha(novo)).toMatchObject({ status: 'cancelado', motivo_cancelamento: MOTIVO_BAIXA_NAO_ACEITO, concluido_em: null });
    expect((await linha(recente)).status).toBe('pronto');
    expect((await linha(entregaAntiga)).status).toBe('confirmado');
    expect((await linha(alheio)).status).toBe('pronto');
    // nenhum lançamento de caixa nasce da baixa
    expect(await q(`select count(*)::int n from lancamento_caixa where tenant_id = $1`, [t])).toEqual([{ n: 0 }]);
    // repetir não faz mais nada
    expect(await baixarPendenciasAntigas(db, t, null, 'pdv', AGORA)).toMatchObject({ concluidos: 0, cancelados: 0 });
  });

  it('baixa do turno do delivery não mexe em pedido em rota, por mais antigo que seja', async () => {
    const t = await empresa();
    const emRota = await pedido(t, { tipo: 'entrega', status: 'despachado', criado: ha(90) });
    const entregue = await pedido(t, { tipo: 'entrega', status: 'entregue', criado: ha(90) });
    const parado = await pedido(t, { tipo: 'entrega', status: 'confirmado', criado: ha(90) });
    expect(await baixarPendenciasAntigas(db, t, null, 'delivery', AGORA)).toMatchObject({ concluidos: 1, cancelados: 0 });
    expect((await linha(emRota)).status).toBe('despachado');
    expect((await linha(entregue)).status).toBe('entregue');
    expect((await linha(parado)).status).toBe('concluido');
  });

  describe('fechar o turno', () => {
    const fechar = (t: string, ator: string, perfil: string, extra: Record<string, unknown> = {}) =>
      servico().fecharSessao(t, ator, perfil, { valoresInformados: {}, origem: 'delivery', ...extra } as any);

    it('delivery com entrega pendente: operador é barrado e o caixa continua aberto', async () => {
      const t = await empresa();
      const operador = await pessoa(t);
      const caixa = await abrirCaixa(t, 'delivery', operador);
      await pedido(t, { tipo: 'entrega', status: 'despachado' });
      await pedido(t, { tipo: 'entrega', status: 'confirmado' });
      await expect(fechar(t, operador, 'execucao')).rejects.toMatchObject({ response: { codigo: 'PENDENCIAS_DO_TURNO', total: 2 } });
      await expect(fechar(t, operador, 'supervisao')).rejects.toThrow(/Há 2 entregas pendentes/);
      // o técnico de suporte passa no @Roles como gerente, mas não fecha o caixa da loja com pendência
      await expect(fechar(t, operador, 'suporte')).rejects.toMatchObject({ response: { codigo: 'PENDENCIAS_DO_TURNO' } });
      expect(await statusCaixa(caixa)).toBe('aberta');
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });

    it('gerente sem motivo é barrado; com o motivo fecha, e o motivo vai para a auditoria', async () => {
      const t = await empresa();
      const gerente = await pessoa(t);
      const caixa = await abrirCaixa(t, 'delivery', gerente);
      const p = await pedido(t, { tipo: 'entrega', status: 'despachado' });
      await expect(fechar(t, gerente, 'gerente')).rejects.toMatchObject({ response: { codigo: 'PENDENCIAS_DO_TURNO_JUSTIFICAR', total: 1 } });
      await expect(fechar(t, gerente, 'gerente', { justificativaPendencias: 'ok' })).rejects.toThrow(/escreva o motivo/);
      expect(await statusCaixa(caixa)).toBe('aberta');
      const r = await fechar(t, gerente, 'gerente', { justificativaPendencias: '  entregador sem   sinal, confere amanhã ' });
      expect(r.sessao.status).toBe('fechada');
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({
          acao: 'fechou_turno_com_pendencias',
          atorId: gerente,
          atorPerfil: 'gerente',
          entidadeId: caixa,
          detalhe: { total: 1, justificativa: 'entregador sem sinal, confere amanhã', pedidos: [p] },
        }),
      );
    });

    it('delivery sem pendência fecha como sempre, sem pedir motivo; retirada pendente não barra o delivery', async () => {
      const t = await empresa();
      const operador = await pessoa(t);
      const caixa = await abrirCaixa(t, 'delivery', operador);
      await pedido(t, { tipo: 'entrega', status: 'concluido' });
      await pedido(t, { tipo: 'retirada', status: 'pronto' }); // é do balcão
      await pedido(t, { tipo: 'entrega', status: 'confirmado', agendamento: new Date(Date.now() + 5 * 3_600_000) }); // encomenda para mais tarde
      const r = await fechar(t, operador, 'execucao');
      expect(r.sessao.status).toBe('fechada');
      expect(await statusCaixa(caixa)).toBe('fechada');
      expect(auditoria.registrar).toHaveBeenCalledTimes(1); // só o "fechou_caixa" de sempre
    });

    it('balcão com retirada pendente NÃO é barrado no servidor (a tela é que avisa antes)', async () => {
      const t = await empresa();
      const operador = await pessoa(t);
      const caixa = await abrirCaixa(t, 'pdv', operador);
      await pedido(t, { tipo: 'retirada', status: 'pronto' });
      await pedido(t, { tipo: 'entrega', status: 'despachado' });
      const r = await servico().fecharSessao(t, operador, 'execucao', { valoresInformados: {}, origem: 'pdv' } as any);
      expect(r.sessao.status).toBe('fechada');
      expect(await statusCaixa(caixa)).toBe('fechada');
    });

    it('o que a tela recebe: bloqueia no delivery, só avisa no balcão; e só gerente/presidente é "gestor"', async () => {
      const t = await empresa();
      await pedido(t, { tipo: 'entrega', status: 'confirmado' });
      await pedido(t, { tipo: 'retirada', status: 'pronto', criado: new Date(Date.now() - 30 * 3_600_000) });
      const s = servico();
      expect(await s.pendenciasDoTurno(t, null, 'delivery', 'execucao')).toMatchObject({ escopo: 'delivery', total: 1, bloqueia: true, gestor: false, justificativaMinima: 10 });
      expect(await s.pendenciasDoTurno(t, null, 'pdv', 'gerente')).toMatchObject({ escopo: 'pdv', total: 1, antigas: 1, baixaveis: 1, bloqueia: false, gestor: true });
      expect((await s.pendenciasDoTurno(t, null, 'pdv', 'suporte')).gestor).toBe(false);
    });

    it('baixar as antigas: só gerente ou presidente, e fica na auditoria com o que NÃO foi feito', async () => {
      const t = await empresa();
      const gerente = await pessoa(t);
      await pedido(t, { tipo: 'retirada', status: 'pronto', criado: new Date(Date.now() - 30 * 3_600_000) });
      // O serviço mede a idade pelo relógio de verdade: o pedido "recente" também. Sem `criado`
      // ele nascia 1 h antes do AGORA fixo do arquivo (02/10/2026) e, 24 h depois dessa data,
      // passou a contar como antigo — o teste quebrou sozinho, sem ninguém mexer no código.
      await pedido(t, { tipo: 'retirada', status: 'pronto', criado: new Date(Date.now() - 3_600_000) });
      const s = servico();
      for (const perfil of ['execucao', 'supervisao', 'suporte']) await expect(s.baixarPendenciasAntigas(t, gerente, perfil, null, 'pdv')).rejects.toThrow(/Só gerente ou presidente/);
      expect(auditoria.registrar).not.toHaveBeenCalled();
      const r = await s.baixarPendenciasAntigas(t, gerente, 'gerente', null, 'pdv');
      expect(r).toMatchObject({ concluidos: 1, cancelados: 0, pendencias: { total: 1, antigas: 0 } });
      expect(auditoria.registrar).toHaveBeenCalledWith(
        expect.objectContaining({ acao: 'baixou_pendencias_antigas', atorPerfil: 'gerente', detalhe: expect.objectContaining({ escopo: 'pdv', concluidos: 1, semEfeitos: expect.stringContaining('não baixou estoque') }) }),
      );
      // sem nada antigo, não grava auditoria à toa
      auditoria.registrar.mockClear();
      expect(await s.baixarPendenciasAntigas(t, gerente, 'presidente', null, 'pdv')).toMatchObject({ concluidos: 0, cancelados: 0 });
      expect(auditoria.registrar).not.toHaveBeenCalled();
    });
  });
});
