import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { ProducaoPedidoService } from './producao-pedido.service';
import { KdsAlertaService } from '../kds/kds-alerta.service';
import { ACOES_KDS } from './kds-auditoria';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUDITORIA DO KDS (pedido do dono, 02/10/2026) — contra o Postgres real.
//
// Limpar a fila, mudar etapas/cores, período da senha, destinos de produção e mexer nos alertas
// não deixavam registro de quem fez. Passam a deixar. O toque de avançar UM card continua sem
// registro de propósito (ver `kds-auditoria.ts`). O registrador é de mentira: a `audit_log` é
// imutável, e o que o teste gravasse nunca mais sairia do banco.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-auditoria.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('auditoria do KDS', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const auditorias: any[] = [];
  const registrador = { registrar: async (a: any) => void auditorias.push(a) } as any;
  const eventos: any[] = [];
  const emissor = { emit: (nome: string, dado: any) => void eventos.push({ nome, dado }) } as any;
  const producao = new ProducaoPedidoService(db, registrador, emissor);
  const alertas = new KdsAlertaService(db, emissor, registrador);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;
  const ATOR = { id: '00000000-0000-4000-8000-0000000000b1', perfil: 'gerente' };

  beforeAll(() => {
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      for (const tabela of ['producao_pedido', 'produto_destino_producao', 'setor_destino_producao', 'kds_alerta_config', 'kds_cor_config', 'senha_contador', 'equipamento', 'produto', 'setor'])
        await pool.query(`delete from ${tabela} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  }, 120_000);
  beforeEach(() => {
    auditorias.length = 0;
    eventos.length = 0;
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste auditoria kds') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    return { t, u };
  }
  const kds = async (t: string, u: string, nome: string) =>
    (await q(`insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo) values ($1,$2,$3,'kds',$4,true) returning id`, [t, u, nome, randomBytes(24).toString('hex')]))[0].id as string;
  const card = async (t: string, u: string, senha: number, status = 'recebido', origem = 'balcao') =>
    (await q(`insert into producao_pedido (tenant_id, unidade_id, senha, senha_prefixo, status, origem, numero) values ($1,$2,$3,'B',$4,$5,$3) returning id`, [t, u, senha, status, origem]))[0].id as string;
  const acoes = () => auditorias.map((a) => a.acao);

  it('limpar a fila: UM registro, com quem fez, quantos cards e as senhas — não um por card', async () => {
    const { t, u } = await empresa();
    const a = await card(t, u, 11);
    const b = await card(t, u, 12, 'preparo');
    await card(t, u, 13, 'entregue'); // já saiu da fila
    const r = await producao.limparFila(t, ATOR.id, { unidadeId: u, canal: 'todos' }, 'gerente');
    expect(r.ok).toBe(true);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({
      tenantId: t,
      unidadeId: u,
      atorId: ATOR.id,
      atorPerfil: 'gerente',
      acao: 'limpou_fila_kds',
      origem: 'kds',
      detalhe: { cards: 2, canal: 'todos', kds: null, setor: null },
    });
    expect(auditorias[0].detalhe.senhas.sort()).toEqual(['B-11', 'B-12']);
    expect(auditorias[0].detalhe.avancos).toBeGreaterThanOrEqual(2);
    const fim = await q(`select status from producao_pedido where id = any($1::uuid[])`, [[a, b]]);
    expect(fim.map((x) => x.status)).toEqual(['entregue', 'entregue']);
  });

  it('limpar a fila vazia não registra; avançar UM card não registra', async () => {
    const { t, u } = await empresa();
    await producao.limparFila(t, ATOR.id, { unidadeId: u }, 'gerente');
    expect(auditorias).toHaveLength(0);
    const id = await card(t, u, 21);
    expect(await producao.avancar(t, ATOR.id, id, 'entrega')).toMatchObject({ ok: true });
    expect(auditorias).toHaveLength(0);
  });

  it('limpar a fila de um KDS registra o nome do KDS', async () => {
    const { t, u } = await empresa();
    const k = await kds(t, u, 'KDS Chapa');
    await card(t, u, 31);
    await producao.limparFila(t, ATOR.id, { unidadeId: u, equipamentoId: k }, 'supervisao');
    expect(auditorias[0]).toMatchObject({ acao: 'limpou_fila_kds', entidadeTipo: 'kds', entidadeId: k, atorPerfil: 'supervisao', detalhe: { kds: 'KDS Chapa', cards: 1 } });
  });

  it('cancelar pedido em produção: o registro ganha a loja e a senha', async () => {
    const { t, u } = await empresa();
    const id = await card(t, u, 41);
    await producao.cancelarPedido(t, ATOR.id, 'gerente', id, 'cliente desistiu');
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'cancelou_pedido_producao', unidadeId: u, entidadeId: id, detalhe: { motivo: 'cliente desistiu', senha: 'B-41' } });
  });

  it('etapas e cores: registra o antes, o depois e o que mudou; salvar igual não registra', async () => {
    const { t, u } = await empresa();
    await producao.setCores(t, u, { verdeAteMin: 4, usaPreparo: false }, ATOR);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'alterou_etapas_kds', tipo: 'config', unidadeId: u, atorId: ATOR.id });
    expect(auditorias[0].detalhe.mudou.sort()).toEqual(['usaPreparo', 'verdeAteMin']);
    expect(auditorias[0].detalhe.antes).toMatchObject({ verdeAteMin: 5, usaPreparo: true });
    expect(auditorias[0].detalhe.depois).toMatchObject({ verdeAteMin: 4, usaPreparo: false, amareloAteMin: 10 });
    auditorias.length = 0;
    await producao.setCores(t, u, { verdeAteMin: 4 }, ATOR);
    expect(auditorias).toHaveLength(0);
  });

  it('período da senha: registra a troca; o mesmo período não registra', async () => {
    const { t, u } = await empresa();
    await producao.setSenhaPeriodo(t, u, 'semanal', ATOR);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'alterou_periodo_senha', detalhe: { antes: 'diario', depois: 'semanal' } });
    auditorias.length = 0;
    await producao.setSenhaPeriodo(t, u, 'semanal', ATOR);
    expect(auditorias).toHaveLength(0);
  });

  it('destinos de produção do produto e do setor: registra pelos nomes; mesma lista não registra', async () => {
    const { t, u } = await empresa();
    const chapa = await kds(t, u, 'KDS Chapa');
    const fritura = await kds(t, u, 'KDS Fritura');
    const prod = (await q(`insert into produto (tenant_id, nome, preco_venda) values ($1,'X-Burger',20) returning id`, [t]))[0].id as string;
    const set = (await q(`insert into setor (tenant_id, unidade_id, nome) values ($1,$2,'Cozinha') returning id`, [t, u]))[0].id as string;

    await producao.setDestinosProduto(t, prod, [chapa], ATOR);
    expect(auditorias).toHaveLength(1);
    expect(auditorias[0]).toMatchObject({ acao: 'alterou_destinos_producao', entidadeTipo: 'produto', entidadeId: prod, detalhe: { alvo: 'produto', nome: 'X-Burger', antes: [], depois: ['KDS Chapa'] } });

    auditorias.length = 0;
    await producao.setDestinosProduto(t, prod, [chapa], ATOR); // a mesma lista
    expect(auditorias).toHaveLength(0);

    await producao.setDestinosProduto(t, prod, [chapa, fritura], ATOR);
    expect(auditorias[0].detalhe).toMatchObject({ antes: ['KDS Chapa'], depois: ['KDS Chapa', 'KDS Fritura'] });

    auditorias.length = 0;
    await producao.setDestinosSetor(t, set, [fritura], ATOR);
    expect(auditorias[0]).toMatchObject({ acao: 'alterou_destinos_producao', entidadeTipo: 'setor', entidadeId: set, detalhe: { alvo: 'setor', nome: 'Cozinha', depois: ['KDS Fritura'] } });
  });

  it('alertas do KDS: criar, editar, excluir e disparar registram quem fez', async () => {
    const { t } = await empresa();
    const criado = await alertas.criar(t, null, { titulo: 'Higienizar bancada', horarios: ['10:00'] }, ATOR);
    await alertas.atualizar(t, criado.id, { titulo: 'Higienizar bancadas', ativo: false }, ATOR);
    await alertas.dispararManual(t, { titulo: 'Fogo na chapa', prioridade: 'danger', duracaoSeg: 30 }, ATOR);
    await alertas.remover(t, criado.id, ATOR);
    expect(acoes()).toEqual(['criou_alerta_kds', 'editou_alerta_kds', 'disparou_alerta_kds', 'excluiu_alerta_kds']);
    expect(auditorias.every((a) => a.atorId === ATOR.id && a.atorPerfil === 'gerente' && a.tenantId === t)).toBe(true);
    expect(auditorias[0]).toMatchObject({ entidadeTipo: 'kds_alerta', entidadeId: criado.id, detalhe: { titulo: 'Higienizar bancada', tipo: 'agendado' } });
    expect(auditorias[1].detalhe).toMatchObject({ titulo: 'Higienizar bancadas', ativo: false });
    expect(auditorias[1].detalhe.campos.sort()).toEqual(['ativo', 'titulo']);
    expect(auditorias[2].detalhe).toMatchObject({ titulo: 'Fogo na chapa', prioridade: 'danger', duracaoSeg: 30 });
    expect(eventos.filter((e) => e.nome === 'kds.alerta.sistema')).toHaveLength(1); // o disparo continua saindo
    // excluir o que não existe (ou de outra empresa) não registra
    auditorias.length = 0;
    await alertas.remover(t, criado.id, ATOR);
    expect(auditorias).toHaveLength(0);
  });

  it('toda ação registrada está na lista que o histórico do KDS consulta', () => {
    for (const a of ['limpou_fila_kds', 'cancelou_pedido_producao', 'alterou_etapas_kds', 'alterou_periodo_senha', 'alterou_destinos_producao', 'criou_alerta_kds', 'editou_alerta_kds', 'excluiu_alerta_kds', 'disparou_alerta_kds'])
      expect(ACOES_KDS).toContain(a);
  });
});
