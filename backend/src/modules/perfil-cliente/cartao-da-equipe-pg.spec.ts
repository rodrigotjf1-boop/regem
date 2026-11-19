import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { cartaoDaEquipe, clienteDoCaso } from './cartao-da-equipe';

const MIG_459 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '459_perfil_do_cliente.sql');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

// F6b do plano do perfil do cliente: o cartão curto que a equipe vê no caso da Central (Postgres, transação desfeita).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cartao-da-equipe-pg.spec: sem TEST_PG_URL — PULADO');

descrever('o cartão do cliente no caso da Central (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (459) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088): a
  // transação do teste só tem DML — DDL com a trava da empresa dentro dela é o risco do ERR-539 (deadlock com as outras suítes no banco dividido).
  const SCHEMA = `teste_perfil_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    await pool.query(semFkCompartilhada(readFileSync(MIG_459, 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  it('acha o cliente direto pelo pedido ou pelo telefone; nada para iFood/99, módulo desligado ou "não analisar"', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const t = (await q(`insert into empresa (nome) values ('teste cartão da equipe') returning id`))[0].id as string;
      const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
      const ana = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21988880001') returning id`, [t]))[0].id as string;
      const pedido = async (canal: string) =>
        (await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id)
           values ($1,$2,$3,$4,'1','Ana','entrega','concluido','[]'::jsonb,50,$5) returning id`,
          [t, u, canal, randomUUID(), ana],
        ))[0].id as string;
      const direto = await pedido('cardapio_web');
      const do99 = await pedido('99food');
      await q(
        `insert into cliente_perfil (cliente_id, tenant_id, confianca, etiquetas, camadas) values ($1,$2,'media','{reclamou_repetido}',$3::jsonb)`,
        [ana, t, JSON.stringify({ gosto: { de_sempre: { nome: 'X-Bacon da casa', pedidos: 5 } }, reclamacoes: { grupos: [{ motivo: 'atraso', nome: 'atraso', vezes: 2 }] }, avaliacoes: { quantas: 3, media: 3.3, ultimas: [3, 2, 5] } })],
      );
      await q(`insert into cliente_declarado (tenant_id, cliente_id, chave, valor, origem) values ($1,$2,'alergia','"camarão"','cardapio_perfil'), ($1,$2,'respostas_curtas','true','cardapio_perfil')`, [t, ana]);
      const db = drizzle(c as any);

      // Pelo pedido direto e pelo telefone (com 55 e sem o 9 — a chave do telefone); o pedido da 99 não forma perfil.
      expect(await clienteDoCaso(db, t, { pedidoId: direto, canal: 'whatsapp' })).toBe(ana);
      expect(await clienteDoCaso(db, t, { telefone: '552188880001', canal: 'whatsapp' })).toBe(ana);
      expect(await clienteDoCaso(db, t, { pedidoId: do99, canal: 'whatsapp' })).toBeNull();
      expect(await clienteDoCaso(db, t, { telefone: '21988880001', canal: '99food' })).toBeNull();

      // Módulo desligado (o padrão): sem cartão.
      expect(await cartaoDaEquipe(db, t, ana)).toBeNull();
      await q(`insert into modulo_ativacao (tenant_id, unidade_id, modulo, ativo) values ($1, null, 'perfil_cliente', true)`, [t]);
      const cartao = await cartaoDaEquipe(db, t, ana);
      expect(cartao).toMatchObject({
        nome: 'Ana',
        deSempre: 'X-Bacon da casa',
        jeito: ['pediu respostas curtas'],
        cuidados: ['alergia a camarão (o cliente pediu para guardar)'],
        reclamacoes: [{ nome: 'atraso', vezes: 2 }],
        avaliacoes: { media: 3.3, quantas: 3, ultimas: [3, 2, 5] },
        etiquetas: ['reclamou_repetido'],
      });
      // Sem valor gasto nem número de pedidos no cartão da equipe.
      expect(JSON.stringify(cartao)).not.toMatch(/gasto|ticket|pedidos_diretos|rfm/);

      await q(`insert into cliente_escolha (tenant_id, cliente_id, escolha, valor, origem) values ($1,$2,'nao_analisar',true,'cardapio_perfil')`, [t, ana]);
      expect(await cartaoDaEquipe(db, t, ana)).toBeNull();
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
