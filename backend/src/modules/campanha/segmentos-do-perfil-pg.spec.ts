import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarEvento, registrarSaida } from '../../common/consentimento-marketing';
import { conferirSegmentoDoPerfil, ehSegmentoDoPerfil, sqlSegmentoDoPerfil } from '../../common/segmentos-do-perfil';
import { ClienteService } from '../cliente/cliente.service';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F7 parte 1 do plano do perfil do cliente: os segmentos "pelo perfil" na lista e na campanha (Postgres). As tabelas só da
// nuvem (226 e 300 — a lista de exclusão e o histórico do consentimento —, 459 e 463 — o perfil) num schema SÓ DESTE TESTE,
// sem FK para as compartilhadas (LIC-088); empresa, cliente e modulo_ativacao são os do `public`, com uma empresa própria.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('segmentos-do-perfil-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

describe('segmentos pelo perfil (sem banco)', () => {
  it('só as chaves "perfil_…" são daqui; as outras seguem com a regra de cada serviço', () => {
    expect(ehSegmentoDoPerfil('perfil_campeoes')).toBe(true);
    expect(ehSegmentoDoPerfil('campeoes')).toBe(false);
    expect(sqlSegmentoDoPerfil('todos')).toBeNull();
    expect(sqlSegmentoDoPerfil(undefined)).toBeNull();
  });
});

descrever('segmentos pelo perfil (Postgres)', () => {
  const SCHEMA = `teste_segperfil_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const T = randomUUID();
  const OUTRA = randomUUID();
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let campanhas: CampanhaService;
  let clientes: ClienteService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);`);
    for (const m of ['300_marketing_consentimento.sql', '459_perfil_do_cliente.sql', '463_cliente_evento_sensibilidade.sql'])
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, m), 'utf8')));
    db = drizzle(pool, { schema });
    campanhas = new CampanhaService(db, {} as any, {} as any, {} as any);
    clientes = new ClienteService(db as any, {} as any, { registrar: async () => {} } as any);
    await admin.query(`insert into empresa (id, nome) values ($1,'teste segmentos do perfil'), ($2,'outra')`, [T, OUTRA]);
    await admin.query(`insert into modulo_ativacao (tenant_id, modulo, ativo) values ($1,'perfil_cliente',true)`, [T]);
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`delete from modulo_ativacao where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`delete from cliente where tenant_id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA]]).catch(() => {});
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it('a campanha pelo perfil alcança só o aceite CLICADO (a caixa já marcada não conta); a lista mostra o segmento todo', async () => {
    const cliente = async (nome: string, telefone: string, segmento: string) => {
      const id = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [T, nome, telefone]))[0].id as string;
      await q(`insert into cliente_perfil (cliente_id, tenant_id, segmento) values ($1,$2,$3)`, [id, T, segmento]);
      return id;
    };
    const ana = await cliente('Ana', '21988880001', 'campeoes'); // aceitou na chave do Perfil
    const bia = await cliente('Bia', '21988880002', 'campeoes'); // só a caixa que já vinha marcada
    await cliente('Caio', '21988880003', 'campeoes'); // nenhum evento
    const duda = await cliente('Duda', '21988880004', 'em_risco'); // aceitou pelo WhatsApp (VOLTAR)
    const eva = await cliente('Eva', '21988880005', 'campeoes'); // aceitou e depois recusou
    await registrarEvento(db, { tenantId: T, telefone: '21988880001', clienteId: ana, origem: 'cardapio_perfil' }, 'aceite');
    await registrarEvento(db, { tenantId: T, telefone: '21988880002', clienteId: bia, origem: 'cardapio_checkout_marcada' }, 'aceite');
    await registrarEvento(db, { tenantId: T, telefone: '21988880004', clienteId: duda, origem: 'whatsapp' }, 'volta');
    await registrarEvento(db, { tenantId: T, telefone: '21988880005', clienteId: eva, origem: 'cardapio_perfil' }, 'aceite');
    await registrarSaida(db, { tenantId: T, telefone: '21988880005', clienteId: eva, origem: 'cardapio_perfil', motivo: 'cardapio_perfil' }, 'recusa');
    await q(`insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo)
             values ($1,'dinheiro',$2,2.1,0.97,8,3.8,6,true), ($3,'dinheiro',$2,1.1,0.6,3,2.7,3,false)`, [ana, T, bia]);

    expect((await campanhas.previa(T, 'perfil_campeoes')).total).toBe(1); // só a Ana
    expect((await campanhas.previa(T, 'perfil_em_risco')).total).toBe(1); // a Duda (VOLTAR pelo WhatsApp)
    expect((await campanhas.previa(T, 'perfil_dinheiro')).total).toBe(1); // o selo da Ana (a Bia sem selo)
    // A campanha comum não muda: todos menos quem saiu (a Eva).
    expect((await campanhas.previa(T, 'todos')).total).toBe(4);

    // A lista (Delivery › Clientes) mostra o segmento inteiro — o aceite é regra da campanha, não da lista.
    const lista: any = await clientes.crmClientes(T, { segmento: 'perfil_campeoes', limite: 50, offset: 0 } as any);
    const nomes = (lista.itens ?? lista.clientes ?? lista.rows ?? lista).map((x: any) => x.nome).sort();
    expect(nomes).toEqual(['Ana', 'Bia', 'Caio', 'Eva']);
  });

  it('recusa fora das regras: supervisão, módulo desligado; segmento comum passa direto', async () => {
    await expect(conferirSegmentoDoPerfil(db, { tenantId: T, categoria: 'supervisao' }, 'perfil_campeoes')).rejects.toBeInstanceOf(ForbiddenException);
    await expect(conferirSegmentoDoPerfil(db, { tenantId: OUTRA, categoria: 'presidente' }, 'perfil_campeoes')).rejects.toThrow(/Ligue o módulo/);
    await expect(conferirSegmentoDoPerfil(db, { tenantId: T, categoria: 'gerente' }, 'perfil_campeoes')).resolves.toBeUndefined();
    await expect(conferirSegmentoDoPerfil(db, { tenantId: OUTRA, categoria: 'supervisao' }, 'todos')).resolves.toBeUndefined();
  });
});
