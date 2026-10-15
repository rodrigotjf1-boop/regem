import { createHash, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ESTAÇÃO DE IMPRESSÃO (mig 324, fase 1 da central de impressão): o PC que imprime as impressoras
// ligadas nele. Antes, no modo local, o servidor imprimia TODA a fila pelo Windows dele — a USB de
// um PDV, do PC do delivery ou da cozinha nunca saía ("OpenPrinter falhou"). Aqui: a credencial da
// estação, a fila que cada um pega, a confirmação só da própria estação, o "Ligada em" e o
// pareamento pelo código. Postgres real (a regra é SQL).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('estacao-impressao.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const hash = (s: string) => createHash('sha256').update(s).digest('hex');

descrever('estação de impressão (Postgres)', () => {
  let pool: Pool;
  let equip: EquipamentoService;
  let fila: ProducaoPedidoService;
  const q = (s: string, p: any[] = []) => pool.query(s, p);

  const T = randomUUID();
  const LOJA_1 = randomUUID();
  const LOJA_2 = randomUUID();
  const S1 = randomUUID(); // estação do PC do delivery
  const S2 = randomUUID(); // estação de um PDV
  const S_REVOGADA = randomUUID();
  const PDV = randomUUID(); // terminal de PDV com o MESMO segredo: não é estação
  const SEGREDO = 'segredo-da-estacao-' + randomUUID();
  const IMP_S1 = randomUUID(); // USB no PC do delivery
  const IMP_S2 = randomUUID(); // USB no PDV
  const IMP_SERVIDOR = randomUUID(); // USB no servidor da loja
  const IMP_REDE = randomUUID(); // rede, sem estação
  const IMP_LOJA2 = randomUUID();

  const equipamento = (id: string, tipo: string, extra: Record<string, any> = {}) => {
    const cols = { id, tenant_id: T, unidade_id: LOJA_1, tipo, nome: tipo + ' ' + id.slice(0, 4), token: 'tok-' + randomUUID(), ...extra };
    const nomes = Object.keys(cols);
    return q(
      `insert into equipamento (${nomes.join(', ')}) values (${nomes.map((_, i) => `$${i + 1}`).join(', ')})`,
      Object.values(cols),
    );
  };
  const job = async (equipamentoId: string) =>
    (await q(
      `insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo)
       values ($1,$2,$3,'cliente','cupom') returning id`,
      [T, LOJA_1, equipamentoId],
    )).rows[0].id as string;
  const situacao = async (id: string) =>
    (await q(`select status, claim_por from impressao_job where id = $1`, [id])).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    // Só-nuvem, ausente no banco do CI (montado como servidor local): o salvar impressora pergunta
    // por ela se o servidor da loja está ativo (edgeAtivo).
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
    const db = drizzle(pool, { schema }) as any;
    equip = new EquipamentoService(db, { registrar: async () => undefined } as any);
    fila = Object.create(ProducaoPedidoService.prototype);
    (fila as any).db = db;
    (fila as any).agentesVistos = new Map(); // Object.create não roda os inicializadores de campo
    await q(`insert into empresa (id, nome) values ($1, 'teste estacao')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja 1'), ($2,$3,'Loja 2')`, [LOJA_1, LOJA_2, T]);
    await equipamento(S1, 'estacao_impressao', { segredo_hash: hash(SEGREDO), pareado_em: new Date() });
    await equipamento(S2, 'estacao_impressao', { segredo_hash: hash('outro-' + SEGREDO), pareado_em: new Date() });
    await equipamento(S_REVOGADA, 'estacao_impressao', {
      segredo_hash: hash(SEGREDO), ativo: false, revogado_em: new Date(),
    });
    await equipamento(PDV, 'pdv', { segredo_hash: hash(SEGREDO) });
    await equipamento(IMP_S1, 'impressora', { conexao: 'local', dispositivo: 'MP-4200 TH', estacao_id: S1, faz_cupom: true });
    await equipamento(IMP_S2, 'impressora', { conexao: 'local', dispositivo: 'EPSON', estacao_id: S2, faz_cupom: true });
    await equipamento(IMP_SERVIDOR, 'impressora', { conexao: 'local', dispositivo: 'EPSON CAIXA 2', faz_cupom: true });
    await equipamento(IMP_REDE, 'impressora', { conexao: 'rede', host: '10.0.0.9', faz_producao: true });
    await equipamento(IMP_LOJA2, 'impressora', { conexao: 'local', dispositivo: 'X', unidade_id: LOJA_2 });
  });

  afterAll(async () => {
    if (!pool) return;
    await q('delete from impressao_job where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from impressora_status where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from unidade where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  beforeEach(() => q('delete from impressao_job where tenant_id = $1', [T]));

  describe('credencial (validarEstacao)', () => {
    it('estação pareada com o segredo certo: vale', async () => {
      expect((await equip.validarEstacao(S1, SEGREDO))?.id).toBe(S1);
    });
    it('segredo errado, sem segredo ou id malformado: não vale', async () => {
      expect(await equip.validarEstacao(S1, 'errado')).toBeNull();
      expect(await equip.validarEstacao(S1, null)).toBeNull();
      expect(await equip.validarEstacao('nao-e-uuid', SEGREDO)).toBeNull();
    });
    it('estação revogada: não vale, mesmo com o segredo certo', async () => {
      expect(await equip.validarEstacao(S_REVOGADA, SEGREDO)).toBeNull();
    });
    it('terminal de PDV com o mesmo segredo não é estação: não vale', async () => {
      expect(await equip.validarEstacao(PDV, SEGREDO)).toBeNull();
    });
  });

  describe('quem pega cada impressão (jobsPendentes)', () => {
    it('a estação pega SÓ as impressoras ligadas nela, e reserva em nome dela', async () => {
      const j1 = await job(IMP_S1);
      await job(IMP_S2);
      await job(IMP_SERVIDOR);
      await job(IMP_REDE);
      const pegos = await fila.jobsPendentes(T, LOJA_1, { estacaoId: S1 });
      expect(pegos.map((x: any) => x.id)).toEqual([j1]);
      expect(pegos[0].dispositivo).toBe('MP-4200 TH');
      expect((await situacao(j1)).claim_por).toBe(`estacao:${S1}`);
    });

    it('o token de sempre (servidor da loja / agente antigo) NÃO pega impressora de estação', async () => {
      await job(IMP_S1);
      await job(IMP_S2);
      const servidor = await job(IMP_SERVIDOR);
      const rede = await job(IMP_REDE);
      const pegos = await fila.jobsPendentes(T, LOJA_1, { maquina: 'CAIXA-1', dispositivos: ['EPSON CAIXA 2', 'MP-4200 TH', 'EPSON'] });
      expect(pegos.map((x: any) => x.id).sort()).toEqual([servidor, rede].sort());
    });

    it('sem se identificar (agente mais antigo): também não pega impressora de estação', async () => {
      await job(IMP_S1);
      const servidor = await job(IMP_SERVIDOR);
      const pegos = await fila.jobsPendentes(T, LOJA_1);
      expect(pegos.map((x: any) => x.id)).toEqual([servidor]);
    });
  });

  describe('confirmações: só da própria estação', () => {
    it('a estação confirma a dela; a de outra é recusada e fica como estava', async () => {
      const dela = await job(IMP_S1);
      const doServidor = await job(IMP_SERVIDOR);
      await fila.jobsPendentes(T, LOJA_1, { estacaoId: S1 });
      await expect(fila.marcarImpresso(T, doServidor, null, S1)).rejects.toThrow(/desta estação/);
      expect((await situacao(doServidor)).status).toBe('pendente');
      await fila.marcarImpresso(T, dela, 'qualquer-nome', S1);
      expect((await situacao(dela)).status).toBe('impresso');
      // A estação não "aprende" máquina: a impressora dela já está no cadastro.
      const imp = await q('select agente_maquina from equipamento where id = $1', [IMP_S1]);
      expect(imp.rows[0].agente_maquina).toBeNull();
    });

    it('erro: a estação não marca erro na impressão de outra estação', async () => {
      const daS1 = await job(IMP_S1);
      await expect(fila.marcarErro(T, daS1, 'sem papel', false, S2)).rejects.toThrow(/desta estação/);
      expect((await situacao(daS1)).status).toBe('pendente');
      await fila.marcarErro(T, daS1, 'sem papel', false, S1);
      expect((await q('select tentativas, erro from impressao_job where id = $1', [daS1])).rows[0]).toEqual({ tentativas: 1, erro: 'sem papel' });
    });

    it('devolver: só a estação que reservou devolve', async () => {
      const j = await job(IMP_S1);
      await fila.jobsPendentes(T, LOJA_1, { estacaoId: S1 });
      await fila.devolverJob(T, j, null, S2);
      expect((await situacao(j)).status).toBe('enviando');
      await fila.devolverJob(T, j, null, S1);
      expect((await situacao(j)).status).toBe('pendente');
    });
  });

  describe('"Ligada em" no cadastro da impressora', () => {
    it('liga a impressora na estação e devolve no formato público', async () => {
      const r: any = await equip.salvarImpressora(T, { id: IMP_SERVIDOR, estacaoId: S2 });
      expect(r.estacaoId).toBe(S2);
      // Editar outro campo sem mandar a estação mantém a ligação (V16).
      const r2: any = await equip.salvarImpressora(T, { id: IMP_SERVIDOR, vias: 2 });
      expect(r2.estacaoId).toBe(S2);
      // Vazio volta para o servidor da loja.
      const r3: any = await equip.salvarImpressora(T, { id: IMP_SERVIDOR, estacaoId: null });
      expect(r3.estacaoId).toBeNull();
    });

    it('recusa estação revogada, de outra loja, inexistente ou que não é estação', async () => {
      await expect(equip.salvarImpressora(T, { id: IMP_SERVIDOR, estacaoId: S_REVOGADA })).rejects.toThrow(/revogada/);
      await expect(equip.salvarImpressora(T, { id: IMP_LOJA2, estacaoId: S1 })).rejects.toThrow(/outra loja/);
      await expect(equip.salvarImpressora(T, { id: IMP_SERVIDOR, estacaoId: randomUUID() })).rejects.toThrow(/não encontrada/);
      await expect(equip.salvarImpressora(T, { id: IMP_SERVIDOR, estacaoId: PDV })).rejects.toThrow(/não encontrada/);
    });
  });

  it('pareamento pelo código de 6 dígitos: a estação recebe o segredo e passa a valer', async () => {
    const nova = randomUUID();
    await equipamento(nova, 'estacao_impressao');
    expect(await equip.validarEstacao(nova, 'qualquer')).toBeNull(); // sem parear: nada vale
    const { codigo } = await equip.gerarCodigo(T, nova, randomUUID(), 'presidente');
    const par: any = await equip.parearPorCodigo(codigo);
    expect(par.terminalId).toBe(nova);
    expect((await equip.validarEstacao(nova, par.segredo))?.id).toBe(nova);
  });
});
