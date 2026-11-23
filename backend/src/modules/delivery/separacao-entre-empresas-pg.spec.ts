import { createHash, randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EntregadorService } from '../entregador/entregador.service';
import { Food99Service } from '../integracoes/food99/food99.service';
import { WhatsappController } from '../whatsapp/whatsapp.controller';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SEPARAÇÃO ENTRE EMPRESAS NAS INTEGRAÇÕES (auditoria de 22/11/2026, S3-01, S2-01, S2-02 e S2-03), contra Postgres:
// · o id de um entregador de outra empresa no despacho mostrava o GPS ao vivo dele no rastreio;
// · o nome de uma instância da Evolution dava acesso às conversas de outra loja;
// · o id de uma loja da 99 bastava para ligá-la em outra empresa e pegar o token;
// · um aviso sem assinatura desligava a 99 de uma loja.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('separacao-entre-empresas-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('separação entre empresas nas integrações (Postgres real)', () => {
  // As tabelas do app do entregador são só da nuvem e o banco do CI é de loja: cópias mínimas num schema só deste teste.
  const SCHEMA = `teste_separacao_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const u = {} as any;
  const delivery = new DeliveryService(db, u, u, u, u, u, { flashPedidos: () => undefined } as any);
  const entregador = new EntregadorService(db, delivery, u);
  const whatsapp = new WhatsappService(db);
  const food99: any = new Food99Service(db, u, { emit: () => true } as any);
  const A = randomUUID();
  const B = randomUUID();
  const edgeAntes = process.env.EDGE_MODE;

  const colaborador = async (t: string, nome: string) =>
    (await q(`insert into colaborador (tenant_id, nome) values ($1,$2) returning id`, [t, nome]))[0].id as string;
  const pedido = async (t: string, status: string, extra: { entregador?: string; rastreio?: string } = {}) =>
    (await q(
      `insert into pedido_externo (tenant_id, canal, external_id, tipo, itens, total, status, entregador_id, rastreio_token)
       values ($1,'cardapio',$2,'entrega','[]',20,$3,$4,$5) returning id`,
      [t, randomUUID(), status, extra.entregador ?? null, extra.rastreio ?? null],
    ))[0].id as string;
  const situacao = async (id: string) => (await q(`select status, entregador_id from pedido_externo where id = $1`, [id]))[0];
  const ligacao99 = async (t: string, merchant: string | null, ativo = true) =>
    (await q(`insert into integracao (tenant_id, canal, merchant_id, ativo) values ($1,'99food',$2,$3) returning id`, [t, merchant, ativo]))[0].id as string;
  const lerLigacao = async (id: string) => (await q(`select merchant_id, ativo from integracao where id = $1`, [id]))[0];
  const limpar99 = () => q(`delete from integracao where tenant_id = any($1::uuid[])`, [[A, B]]);

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    await pool.query(`create schema ${SCHEMA}`);
    await pool.query(`create table ${SCHEMA}.entregador_posicao (colaborador_id uuid primary key, tenant_id uuid not null, lat numeric not null,
      lng numeric not null, precisao numeric, atualizado_em timestamptz not null default now())`);
    await pool.query(`create table ${SCHEMA}.entregador_preferencia (colaborador_id uuid primary key, compartilha_contato boolean not null default false)`);
    await pool.query(`create table ${SCHEMA}.entregador_chegada (pedido_id uuid, lat numeric, lng numeric, criado_em timestamptz not null default now())`);
    await q(`insert into empresa (id, nome) values ($1,'teste separacao A'), ($2,'teste separacao B')`, [A, B]);
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    if (edgeAntes !== undefined) process.env.EDGE_MODE = edgeAntes;
    for (const t of ['pedido_externo', 'integracao', 'cardapio_config', 'colaborador'])
      await q(`delete from ${t} where tenant_id = any($1::uuid[])`, [[A, B]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[A, B]]).catch(() => undefined);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  });

  describe('S3-01: o GPS do entregador', () => {
    it('despachar ou avançar com o entregador de outra empresa é recusado e o pedido fica como estava', async () => {
      const deB = await colaborador(B, 'Entregador B');
      const p = await pedido(A, 'pronto');
      await expect(delivery.despachar(A, p, { entregadorId: deB, entregadorNome: 'Teste' })).rejects.toThrow('não é desta empresa');
      await expect(delivery.avancar(A, p, { entregadorId: deB, entregadorNome: 'Teste' })).rejects.toThrow('não é desta empresa');
      await expect(delivery.despachar(A, p, { entregadorId: 'nao-e-uuid' })).rejects.toThrow('não é desta empresa');
      expect(await situacao(p)).toEqual({ status: 'pronto', entregador_id: null });
    });

    it('o entregador da própria empresa passa na conferência', async () => {
      const deA = await colaborador(A, 'Entregador A');
      await expect((delivery as any).conferirEntregador(A, deA)).resolves.toBeUndefined();
    });

    it('uma ligação antiga com o id de outra empresa não mostra a posição; a da própria empresa, sim', async () => {
      const deB = await colaborador(B, 'Entregador B2');
      const deA = await colaborador(A, 'Entregador A2');
      await q(`insert into ${SCHEMA}.entregador_posicao (colaborador_id, tenant_id, lat, lng) values ($1,$2,-10.5,-20.5), ($3,$4,-11.5,-21.5)`, [deB, B, deA, A]);
      await pedido(A, 'pronto', { entregador: deB, rastreio: 'rastreiooutra' });
      await pedido(A, 'pronto', { entregador: deA, rastreio: 'rastreiopropria' });
      expect((await entregador.rastreioPublico('rastreiooutra')).entregador?.pos).toBeNull();
      expect((await entregador.rastreioPublico('rastreiopropria')).entregador?.pos).toEqual({ lat: -11.5, lng: -21.5 });
    });
  });

  describe('S2-01: a instância da Evolution', () => {
    const controller = () => {
      const vincular = jest.fn(async () => ({ ok: true }));
      return { vincular, c: new WhatsappController({ vincular } as any, u, u, u) };
    };

    it.each(['presidente', 'gerente'])('%s não liga uma instância pelo nome', (categoria) => {
      const { c, vincular } = controller();
      expect(() => c.vincular({ tenantId: A, categoria } as any, { instancia: 'loja-b' })).toThrow(ForbiddenException);
      expect(vincular).not.toHaveBeenCalled();
    });

    it('o suporte da DMS liga', async () => {
      const { c, vincular } = controller();
      await c.vincular({ tenantId: A, categoria: 'suporte' } as any, { instancia: 'loja-a' });
      expect(vincular).toHaveBeenCalledWith(A, 'loja-a');
    });

    it('nome com caminho e a instância principal ou de marketing de outra loja são recusados', async () => {
      await q(`insert into cardapio_config (tenant_id, token, evolution_instancia, marketing_instancia) values ($1,$2,'loja-b-principal','loja-b-marketing')`, [B, `tk-${randomUUID()}`]);
      await q(`insert into cardapio_config (tenant_id, token) values ($1,$2)`, [A, `tk-${randomUUID()}`]);
      for (const nome of ['x/../loja-b-principal', 'x%2f..%2floja-b', 'a\\b', 'a?b', 'a#b'])
        await expect(whatsapp.vincular(A, nome)).rejects.toThrow('Nome de instância inválido');
      await expect(whatsapp.vincular(A, 'loja-b-principal')).rejects.toThrow('já pertence a outra loja');
      await expect(whatsapp.vincular(A, 'loja-b-marketing')).rejects.toThrow('já pertence a outra loja');
      expect((await q(`select evolution_instancia from cardapio_config where tenant_id = $1`, [A]))[0].evolution_instancia).toBeNull();
    });
  });

  describe('S2-02: a loja da 99', () => {
    beforeEach(() => limpar99());

    it('a loja ligada em outra empresa não entra por nenhuma das três rotas', async () => {
      const M = randomUUID();
      await ligacao99(B, M);
      const daA = await ligacao99(A, null, false);
      await expect(food99.vincular(A, M)).rejects.toThrow('já está ligada a outra empresa');
      await expect(food99.salvarCredenciais(A, null, '', '', M)).rejects.toThrow('já está ligada a outra empresa');
      await expect(delivery.salvarIntegracao(A, { canal: '99food', merchantId: M, ativo: true })).rejects.toThrow('já está ligada a outra empresa');
      expect(await lerLigacao(daA)).toEqual({ merchant_id: null, ativo: false });
    });
  });

  describe('S2-03: o aviso de vínculo da 99', () => {
    const avisoDesligar = (m: string) => JSON.stringify({ type: 'shopBindStatus', data: { bindStatus: 'unbind', appShopIDList: [m] } });
    beforeEach(() => limpar99());

    it('sem assinatura e a 99 diz que a loja segue autorizada: nada muda', async () => {
      const M = randomUUID();
      const id = await ligacao99(A, M);
      jest.spyOn(food99, 'consultarLojasAutorizadas').mockResolvedValue({ ok: true, lojas: [{ appShopId: M, nome: null }] });
      await food99.processarWebhook(avisoDesligar(M));
      expect((await lerLigacao(id)).ativo).toBe(true);
    });

    it('sem assinatura e a 99 não responde: nada muda', async () => {
      const M = randomUUID();
      const id = await ligacao99(A, M);
      jest.spyOn(food99, 'consultarLojasAutorizadas').mockResolvedValue({ ok: false, lojas: [] });
      await food99.processarWebhook(avisoDesligar(M));
      expect((await lerLigacao(id)).ativo).toBe(true);
    });

    it('sem assinatura, mas a 99 confirma que a loja saiu: desliga', async () => {
      const M = randomUUID();
      const id = await ligacao99(A, M);
      jest.spyOn(food99, 'consultarLojasAutorizadas').mockResolvedValue({ ok: true, lojas: [] });
      await food99.processarWebhook(avisoDesligar(M));
      expect((await lerLigacao(id)).ativo).toBe(false);
    });

    it('com a assinatura certa: desliga sem precisar perguntar', async () => {
      const M = randomUUID();
      const id = await ligacao99(A, M);
      jest.spyOn(food99, 'appSecretEnv').mockReturnValue('segredo-de-teste');
      const consulta = jest.spyOn(food99, 'consultarLojasAutorizadas');
      const raw = avisoDesligar(M);
      await food99.processarWebhook(raw, createHash('md5').update(`${raw}segredo-de-teste`).digest('hex'));
      expect((await lerLigacao(id)).ativo).toBe(false);
      expect(consulta).not.toHaveBeenCalled();
    });
  });
});
