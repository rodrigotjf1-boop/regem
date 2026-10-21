import { BadRequestException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { REQUIRE_PERM } from '../../auth/require-perm.decorator';
import { MODULO_KEY } from '../../auth/require-modulo.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { ACOES_KDS } from '../producao-pedido/kds-auditoria';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TABELAS_DESDE_ZERO, TABELAS_SYNC } from '../sync/sync-config';
import { DeliveryService } from './delivery.service';
import { EntregadoresAoVivoController } from './entregadores-ao-vivo.controller';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "Mostrar num KDS" do Mapa ao vivo (cozinha em estações, entrega 5; mig 338), contra o Postgres de verdade (V6): quais
// telas de KDS o painel manda mostrar o mapa dos entregadores, o que fica gravado, quem fica sabendo e o que o KDS lê.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('mapa-nos-kds.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const T = '5e000000-0000-4000-8000-000000000001';
const OUTRA = '5e000000-0000-4000-8000-000000000002';
const U = '5e000000-0000-4000-8000-000000000011';
const U2 = '5e000000-0000-4000-8000-000000000012';
const COZ = '5e000000-0000-4000-8000-000000000021';
const CHAPA = '5e000000-0000-4000-8000-000000000031';
const EXPED = '5e000000-0000-4000-8000-000000000032';
const REDE = '5e000000-0000-4000-8000-000000000033';
const DA_LOJA_B = '5e000000-0000-4000-8000-000000000034';
const DESLIGADO = '5e000000-0000-4000-8000-000000000035';
const DA_OUTRA = '5e000000-0000-4000-8000-000000000036';
const IMPRESSORA = '5e000000-0000-4000-8000-000000000037';
const ATOR = { id: '5e000000-0000-4000-8000-000000000041', perfil: 'gerente' };

descrever('Mostrar num KDS — o mapa dos entregadores mandado pelo painel (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let producao: ProducaoPedidoService;
  let svc: EntregadoresAoVivoService;
  let delivery: DeliveryService;
  const auditado: any[] = [];
  const emitidos: { nome: string; dado: any }[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const marcas = async () =>
    q(`select id, mostra_mapa as mapa, updated_at as em from kds_tela_ajuste where tenant_id = any($1::uuid[]) order by id`, [[T, OUTRA]]);
  const nomesNoMapa = async (unidade = U) => (await producao.telasDeKds(T, unidade)).filter((t: any) => t.mapa).map((t: any) => t.nome);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    const audita: any = { registrar: async (e: any) => void auditado.push(e) };
    const avisa: any = { emit: (nome: string, dado: any) => (emitidos.push({ nome, dado }), true) };
    producao = new ProducaoPedidoService(db, audita, avisa);
    const d: any = Object.create(DeliveryService.prototype);
    d.db = db;
    delivery = d;
    svc = new EntregadoresAoVivoService(db, delivery, producao, audita, avisa);
    await q(`insert into empresa (id, nome) values ($1,'teste mapa nos kds'), ($2,'outra empresa')`, [T, OUTRA]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja A'), ($2,$3,'Loja B')`, [U, U2, T]);
    await q(`insert into setor (id, tenant_id, unidade_id, nome) values ($1,$2,$3,'Cozinha')`, [COZ, T, U]);
    const equip = (id: string, tenant: string, unidade: string | null, nome: string, extra: { tipo?: string; escopo?: string; setor?: string; ativo?: boolean } = {}) =>
      q(
        `insert into equipamento (id, tenant_id, unidade_id, nome, token, tipo, escopo, setor_id, ativo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, tenant, unidade, nome, 'tok-' + id, extra.tipo ?? 'kds', extra.escopo ?? 'producao', extra.setor ?? null, extra.ativo ?? true],
      );
    await equip(CHAPA, T, U, 'Chapa', { setor: COZ });
    await equip(EXPED, T, U, 'Expedição', { escopo: 'despacho' });
    await equip(REDE, T, null, 'Rede');
    await equip(DA_LOJA_B, T, U2, 'Da loja B');
    await equip(DESLIGADO, T, U, 'Desligado', { ativo: false });
    await equip(DA_OUTRA, OUTRA, null, 'Da outra empresa');
    await equip(IMPRESSORA, T, U, 'Impressora', { tipo: 'impressora' });
  });

  afterAll(async () => {
    if (!pool) return;
    for (const t of ['kds_tela_ajuste', 'sync_exclusao', 'delivery_config', 'equipamento', 'setor', 'unidade'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => undefined);
    await pool.end();
  });

  it('lista as telas de KDS da loja e da rede, com o setor — sem a outra loja, a desligada, a outra empresa e a impressora', async () => {
    const r = await svc.telasDoMapa(T, U);
    expect(r.ligado).toBe(false); // a chave da loja começa desligada (mig 293)
    expect(r.telas).toEqual([
      { id: CHAPA, nome: 'Chapa', escopo: 'producao', setor: 'Cozinha', mapa: false },
      { id: EXPED, nome: 'Expedição', escopo: 'despacho', setor: null, mapa: false },
      { id: REDE, nome: 'Rede', escopo: 'producao', setor: null, mapa: false },
    ]);
  });

  it('marca dois: grava só eles, audita com os nomes, avisa as telas e o KDS lê a marca', async () => {
    const r = await svc.mostrarNosKds(T, U, [EXPED, CHAPA], ATOR);
    expect(r.entraram).toEqual(['Chapa', 'Expedição']);
    expect(r.sairam).toEqual([]);
    expect(r.telas.filter((t) => t.mapa).map((t) => t.nome)).toEqual(['Chapa', 'Expedição']);
    expect((await marcas()).map((m: any) => [m.id, m.mapa])).toEqual([[CHAPA, true], [EXPED, true]]);
    expect(await nomesNoMapa()).toEqual(['Chapa', 'Expedição']); // o que o KDS lê em GET /producao/kds/telas
    expect(auditado).toHaveLength(1);
    expect(auditado[0]).toMatchObject({
      tenantId: T,
      unidadeId: U,
      atorId: ATOR.id,
      atorPerfil: 'gerente',
      tipo: 'config',
      acao: 'mostrou_mapa_nos_kds',
      detalhe: { entraram: ['Chapa', 'Expedição'], sairam: [] },
    });
    expect(emitidos).toEqual([{ nome: 'kds.telas.mudou', dado: { tenantId: T } }]);
  });

  it('desmarcar um: só ele muda — a linha fica com false e o outro não ganha carimbo novo', async () => {
    const antes = await marcas();
    await new Promise((ok) => setTimeout(ok, 20));
    const r = await svc.mostrarNosKds(T, U, [EXPED], ATOR);
    expect(r.entraram).toEqual([]);
    expect(r.sairam).toEqual(['Chapa']);
    const depois = await marcas();
    expect(depois.map((m: any) => [m.id, m.mapa])).toEqual([[CHAPA, false], [EXPED, true]]);
    expect(new Date(depois[1].em).getTime()).toBe(new Date(antes[1].em).getTime()); // Expedição: intocada
    expect(new Date(depois[0].em).getTime()).toBeGreaterThan(new Date(antes[0].em).getTime()); // Chapa: o sync leva
    expect(auditado[1].detalhe).toEqual({ entraram: [], sairam: ['Chapa'] });
    expect(emitidos).toHaveLength(2);
  });

  it('a mesma lista de novo: nada muda — sem auditoria e sem aviso', async () => {
    const r = await svc.mostrarNosKds(T, U, [EXPED], ATOR);
    expect(r).toMatchObject({ entraram: [], sairam: [] });
    expect(auditado).toHaveLength(2);
    expect(emitidos).toHaveLength(2);
  });

  it('recusa lista torta, KDS de outra loja, desligado, de outra empresa e a impressora — sem gravar nada', async () => {
    const antes = await marcas();
    const recusa = async (lista: unknown, motivo: RegExp) => {
      const erro = await svc.mostrarNosKds(T, U, lista, ATOR).then(() => null, (e) => e);
      expect(erro).toBeInstanceOf(BadRequestException);
      expect(erro.message).toMatch(motivo);
    };
    for (const lista of [undefined, null, 'tudo', { id: EXPED }]) await recusa(lista, /Mande a lista dos KDS/);
    for (const lista of [[EXPED, 42], [EXPED, 'nao-e-uuid']]) await recusa(lista, /item que não é KDS/);
    for (const lista of [[DA_LOJA_B], [DESLIGADO], [DA_OUTRA], [IMPRESSORA], [EXPED, DA_LOJA_B]]) await recusa(lista, /não é desta loja ou foi desligado/);
    expect(await marcas()).toEqual(antes);
    expect(auditado).toHaveLength(2);
    expect(emitidos).toHaveLength(2);
  });

  it('tirar de todos (lista vazia): o marcado volta aos pedidos', async () => {
    const r = await svc.mostrarNosKds(T, U, [], ATOR);
    expect(r.sairam).toEqual(['Expedição']);
    expect(await nomesNoMapa()).toEqual([]);
    expect((await marcas()).every((m: any) => m.mapa === false)).toBe(true);
  });

  it('a chave da loja desligada não impede marcar; a resposta diz `ligado` e acompanha a chave', async () => {
    expect((await svc.mostrarNosKds(T, U, [REDE], ATOR)).ligado).toBe(false);
    await delivery.setConfig(T, U, { kdsMapaEntregadores: true });
    expect((await svc.telasDoMapa(T, U)).ligado).toBe(true);
    // O KDS da rede aparece nas duas lojas: marcado de uma, a outra também vê a marca dele.
    expect(await nomesNoMapa(U2)).toEqual(['Rede']);
  });

  it('o KDS apagado leva a marca junto, e a exclusão vai para o outro lado pelo sync', async () => {
    await svc.mostrarNosKds(T, U2, [DA_LOJA_B, REDE], ATOR);
    await q(`delete from equipamento where id = $1`, [DA_LOJA_B]);
    expect(await q(`select 1 from kds_tela_ajuste where id = $1`, [DA_LOJA_B])).toEqual([]);
    expect(await q(`select 1 from sync_exclusao where tenant_id = $1 and tabela = 'kds_tela_ajuste' and registro_id = $2`, [T, DA_LOJA_B])).toHaveLength(1);
  });

  it('a linha que o sync aplica guarda o carimbo do outro lado; a editada aqui ganha a hora de agora', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('regem.sync', 'on', true)`);
      await c.query(`update kds_tela_ajuste set mostra_mapa = true, updated_at = '2020-01-02T03:04:05Z' where id = $1`, [CHAPA]);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(new Date((await q(`select updated_at from kds_tela_ajuste where id = $1`, [CHAPA]))[0].updated_at).toISOString()).toBe('2020-01-02T03:04:05.000Z');
    await q(`update kds_tela_ajuste set mostra_mapa = false, updated_at = '2020-01-02T03:04:05Z' where id = $1`, [CHAPA]);
    expect(new Date((await q(`select updated_at from kds_tela_ajuste where id = $1`, [CHAPA]))[0].updated_at).getFullYear()).toBeGreaterThan(2020);
  });

  it('o aviso em tempo real vai para a sala da empresa, como "kds:telas"', () => {
    const enviados: any[] = [];
    const gw: any = Object.create(RealtimeGateway.prototype);
    gw.server = { to: (sala: string) => ({ emit: (ev: string, dado: any) => enviados.push({ sala, ev, dado }) }) };
    gw.onKdsTelasMudou({ tenantId: T });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).toMatchObject({ sala: `tenant:${T}`, ev: 'kds:telas' });
  });

  it('a marca sincroniza nos dois sentidos, desce desde o zero no servidor já instalado e aparece no Histórico do KDS', () => {
    expect(TABELAS_SYNC.find((t) => t.tabela === 'kds_tela_ajuste')).toMatchObject({ direcao: 'ambos', cursor: 'updated_at' });
    // O que a nuvem marcou antes de a loja receber o `.zip` tem de descer (o piso global do servidor já instalado é "agora").
    expect(TABELAS_DESDE_ZERO.has('kds_tela_ajuste')).toBe(true);
    expect(ACOES_KDS).toContain('mostrou_mapa_nos_kds');
  });

  it('as rotas pedem a gestão do delivery e o módulo KDS', () => {
    for (const rota of ['telasKds', 'mostrarNosKds'] as const) {
      const alvo = (EntregadoresAoVivoController.prototype as any)[rota];
      expect(Reflect.getMetadata(ROLES_KEY, alvo)).toEqual(['presidente', 'gerente', 'supervisao']);
      expect(Reflect.getMetadata(REQUIRE_PERM, alvo)).toEqual({ modulo: 'delivery', acao: undefined });
      expect(Reflect.getMetadata(MODULO_KEY, alvo)).toBe('kds');
      expect(Reflect.getMetadata(GUARDS_METADATA, alvo)).toContain(ModuloGuard);
    }
  });
});
