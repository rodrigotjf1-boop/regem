import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarEvento, registrarSaida } from '../../common/consentimento-marketing';
import { conferirSegmentoDoPerfil, ehSegmentoDoPerfil, SEGMENTOS_DO_PERFIL, sqlSegmentoDoPerfil } from '../../common/segmentos-do-perfil';
import { ClienteService } from '../cliente/cliente.service';
import { AudienciasIntegracaoService, contagemSegura } from '../integracao-api/audiencias-integracao.service';
import type { IntegracaoCtxData } from '../integracao-api/integracao-token.guard';
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

  it('a contagem que sai pela porta (F9): de 1 a 4 vira null; zero e negativo saem zero', () => {
    expect([0, 1, 4, 5, 312, -3, null, 'x'].map(contagemSegura)).toEqual([0, null, null, 5, 312, 0, 0, 0]);
  });
});

descrever('segmentos pelo perfil (Postgres)', () => {
  const SCHEMA = `teste_segperfil_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const T = randomUUID();
  const OUTRA = randomUUID();
  const A = randomUUID(); // a empresa de duas lojas da porta do Liame (F9)
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
    // 466 (os cliques do cardápio): o público "olharam e não pediram" lê dela — a porta do Liame conta todos os públicos.
    for (const m of ['300_marketing_consentimento.sql', '459_perfil_do_cliente.sql', '463_cliente_evento_sensibilidade.sql', '466_cardapio_interacao.sql'])
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, m), 'utf8')));
    db = drizzle(pool, { schema });
    campanhas = new CampanhaService(db, {} as any, {} as any, {} as any);
    clientes = new ClienteService(db as any, {} as any, { registrar: async () => {} } as any);
    await admin.query(`insert into empresa (id, nome) values ($1,'teste segmentos do perfil'), ($2,'outra'), ($3,'duas lojas')`, [T, OUTRA, A]);
    await admin.query(`insert into modulo_ativacao (tenant_id, modulo, ativo) values ($1,'perfil_cliente',true), ($2,'perfil_cliente',true)`, [T, A]);
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`delete from modulo_ativacao where tenant_id = any($1::uuid[])`, [[T, OUTRA, A]]).catch(() => {});
    await admin.query(`delete from cliente where tenant_id = any($1::uuid[])`, [[T, OUTRA, A]]).catch(() => {});
    await admin.query(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA, A]]).catch(() => {});
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

  // F9 parte 1 (mig 483): o tamanho de cada público pela porta do Liame — os MESMOS segmentos da campanha, só os números.
  it('a porta do Liame conta os públicos: só cliente com perfil, a loja principal, o aceite clicado sem SAIR e nada de 1 a 4', async () => {
    const L1 = randomUUID();
    const L2 = randomUUID();
    let n = 0;
    const cliente = async (segmento: string | null, loja: string, aceite?: 'clicado' | 'marcada') => {
      const tel = `2197000${String(++n).padStart(4, '0')}`;
      const id = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [A, `Cliente ${n}`, tel]))[0].id as string;
      if (segmento) await q(`insert into cliente_perfil (cliente_id, tenant_id, segmento, unidade_id) values ($1,$2,$3,$4)`, [id, A, segmento, loja]);
      if (aceite) await registrarEvento(db, { tenantId: A, telefone: tel, clienteId: id, origem: aceite === 'clicado' ? 'cardapio_perfil' : 'cardapio_checkout_marcada' }, 'aceite');
      return { id, tel };
    };
    // Loja 1: 7 campeões — 6 com aceite clicado (o 6º pediu para sair) e 1 só com a caixa que já vinha marcada.
    const camp: { id: string; tel: string }[] = [];
    for (let i = 0; i < 6; i++) camp.push(await cliente('campeoes', L1, 'clicado'));
    camp.push(await cliente('campeoes', L1, 'marcada'));
    await q(`insert into marketing_optout (tenant_id, telefone) values ($1,$2)`, [A, camp[5].tel]);
    // os 5 primeiros pedem no dinheiro no bolso
    for (const c of camp.slice(0, 5))
      await q(`insert into cliente_evento_sensibilidade (cliente_id, tipo, tenant_id, rr, prob, pedidos, esperado, dias_com_pedido, selo)
               values ($1,'dinheiro',$2,2.1,0.97,8,3.8,6,true)`, [c.id, A]);
    // Loja 1: 3 em risco (o número pequeno). Loja 2: 2 campeões com aceite clicado. Sem perfil (só pela 99): nunca conta.
    for (let i = 0; i < 3; i++) await cliente('em_risco', L1);
    for (let i = 0; i < 2; i++) await cliente('campeoes', L2, 'clicado');
    await cliente(null, L1, 'clicado');

    const svc = new AudienciasIntegracaoService(db);
    const ctx = (unidadeId: string | null, lojaUnica: boolean, tenantId = A) =>
      ({ tokenId: randomUUID(), tenantId, unidadeId, abrangencia: unidadeId ? 'loja' : 'empresa', lojaUnica, escopos: ['clientes.audiencias.ler'], cliente: 'liame', autorizadoPor: randomUUID(), prefixo: 'rgm_it_' }) as IntegracaoCtxData;
    const pub = (r: any, chave: string) => r.publicos.find((p: any) => p.chave === chave);

    const daLoja1: any = await svc.audiencias(ctx(L1, false));
    expect(daLoja1.perfil_ligado).toBe(true);
    expect(daLoja1.minimo).toBe(5);
    expect(daLoja1.clientes_com_perfil).toBe(10); // 7 campeões + 3 em risco (a loja 2 e o sem perfil ficam de fora)
    expect(daLoja1.aceitaram_ofertas).toBe(5); // o 6º saiu; a caixa marcada não conta
    expect(pub(daLoja1, 'campeoes')).toEqual({ chave: 'campeoes', rotulo: 'Campeões', grupo: 'segmento', clientes: 7, aceitaram_ofertas: 5 });
    expect(pub(daLoja1, 'em_risco')).toMatchObject({ clientes: null, aceitaram_ofertas: 0 }); // 3: não se informa
    expect(pub(daLoja1, 'dinheiro')).toMatchObject({ grupo: 'evento', clientes: 5, aceitaram_ofertas: 5 });
    expect(pub(daLoja1, 'leais')).toMatchObject({ clientes: 0, aceitaram_ofertas: 0 });
    expect(pub(daLoja1, 'olhou')).toMatchObject({ grupo: 'interesse', clientes: 0 });
    // os públicos são os da campanha, na mesma ordem, com a chave sem o "perfil_"
    expect(daLoja1.publicos.map((p: any) => p.chave)).toEqual(Object.keys(SEGMENTOS_DO_PERFIL).map((k) => k.replace(/^perfil_/, '')));
    // só números: nenhum campo de pessoa em lugar nenhum da resposta
    const campos = new Set<string>();
    const juntar = (v: any) => { if (Array.isArray(v)) v.forEach(juntar); else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { campos.add(k); juntar(x); } };
    juntar(daLoja1);
    expect([...campos].sort()).toEqual(['aceitaram_ofertas', 'calculado_em', 'chave', 'clientes', 'clientes_com_perfil', 'grupo', 'minimo', 'perfil_ligado', 'publicos', 'rotulo']);
    expect(JSON.stringify(daLoja1)).not.toMatch(/2197000|Cliente \d|[0-9a-f]{8}-[0-9a-f]{4}-/);

    // A empresa inteira (ou a de loja única): todos os clientes com perfil.
    const todas: any = await svc.audiencias(ctx(null, false));
    expect(todas.clientes_com_perfil).toBe(12);
    expect(pub(todas, 'campeoes')).toMatchObject({ clientes: 9, aceitaram_ofertas: 7 });
    expect((await svc.audiencias(ctx(L2, true))).clientes_com_perfil).toBe(12);
    // Loja 2 de uma empresa de várias lojas: 2 clientes — não se informa.
    expect((await svc.audiencias(ctx(L2, false))).clientes_com_perfil).toBeNull();

    // O módulo "Perfil do cliente" desligado: nenhum público, nenhuma consulta ao perfil.
    expect(await svc.audiencias(ctx(null, false, OUTRA))).toEqual({
      perfil_ligado: false, calculado_em: null, minimo: 5, clientes_com_perfil: null, aceitaram_ofertas: null, publicos: [],
    });
  });
});
