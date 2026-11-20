import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hojeISO } from '../../common/data';
import { CalendarioDaLojaService } from './calendario-da-loja.service';
import { somarDias } from './calendario-regra';

const MIG_461 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '461_calendario_da_loja.sql');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

// F2 do plano do perfil do cliente: o calendário da loja (Postgres, transação desfeita).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('calendario-da-loja-pg.spec: sem TEST_PG_URL — PULADO');

descrever('o calendário da loja (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (461) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088): a
  // transação do teste só tem DML (ERR-539).
  const SCHEMA = `teste_calend_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    await pool.query(semFkCompartilhada(readFileSync(MIG_461, 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  it('junta a regra, o evento da loja e o feriado da Escala; a loja de cada um; excluir; a cópia por loja e dia', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const t = (await q(`insert into empresa (nome) values ('teste calendário') returning id`))[0].id as string;
      const lojaA = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja A') returning id`, [t]))[0].id as string;
      const lojaB = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja B') returning id`, [t]))[0].id as string;
      const svc = new CalendarioDaLojaService(drizzle(c as any) as any);
      const presidente = { tenantId: t, colaboradorId: null, categoria: 'presidente' } as any;
      const gerenteB = { tenantId: t, colaboradorId: null, categoria: 'gerente' } as any;

      const hoje = hojeISO();
      const d3 = somarDias(hoje, 3);
      const d10 = somarDias(hoje, 10);
      // Evento da loja A, toda semana a partir de d3; e um de "todas as lojas" (sem loja).
      const { id: promo } = await svc.criar(presidente, lojaA, { nome: 'Smash em dobro', tipo: 'promocao', dia: d3, hora: '19:00', repete: 'semana' });
      await svc.criar(presidente, null, { nome: 'Show no estádio', tipo: 'show', dia: d10, repete: 'nao' });
      // O feriado da cidade cadastrado em Escalas › Feriado / evento (loja A) e as férias de alguém (não entram).
      await q(`insert into dia_especial (tenant_id, unidade_id, data, tipo, nome) values ($1,$2,$3::date,'feriado','Aniversário da cidade')`, [t, lojaA, d10]);
      const colab = (await q(`select id from colaborador where tenant_id = $1 limit 1`, [t]))[0]?.id ?? null;
      if (colab) await q(`insert into dia_especial (tenant_id, colaborador_id, data, tipo, nome) values ($1,$2,$3::date,'ferias','Férias')`, [t, colab, d3]);

      const p = svc.periodo(hoje, somarDias(hoje, 20));
      const daA = await svc.listar(t, lojaA, p.de, p.ate);
      const daLoja = daA.filter((e) => e.origem !== 'regra');
      expect(daLoja.filter((e) => e.nome === 'Smash em dobro').map((e) => e.dia)).toEqual([d3, somarDias(d3, 7), somarDias(d3, 14)]);
      expect(daLoja.find((e) => e.nome === 'Show no estádio')).toMatchObject({ dia: d10, origem: 'loja', unidadeId: null, podeEditar: false });
      expect(daLoja.find((e) => e.nome === 'Aniversário da cidade')).toMatchObject({ dia: d10, origem: 'escala', grupo: 'feriado' });
      expect(daLoja.some((e) => e.nome === 'Férias')).toBe(false);
      expect(daLoja.find((e) => e.nome === 'Smash em dobro')).toMatchObject({ podeEditar: true, hora: '19:00' });
      // A regra fixa vem junto (o período de 21 dias sempre tem ao menos o vale do dia 20 ou o 5º dia útil).
      expect(daA.some((e) => e.origem === 'regra' && e.grupo === 'dinheiro')).toBe(true);
      // A loja B não vê o evento da A nem o feriado da A; vê o de todas as lojas.
      const daB = (await svc.listar(t, lojaB, p.de, p.ate)).filter((e) => e.origem !== 'regra').map((e) => e.nome);
      expect(daB).toEqual(['Show no estádio']);

      // O gerente da loja B não edita nem exclui o evento da A (nem descobre que existe).
      await expect(svc.editar(gerenteB, lojaB, promo, { nome: 'Outro', tipo: 'promocao', dia: d3, repete: 'nao' })).rejects.toBeInstanceOf(NotFoundException);
      await expect(svc.excluir(gerenteB, lojaB, promo)).rejects.toBeInstanceOf(NotFoundException);
      // Quem é da A edita: deixa de repetir.
      await svc.editar(presidente, lojaA, promo, { nome: 'Smash em dobro', tipo: 'promocao', dia: d3, repete: 'nao' });
      expect((await svc.listar(t, lojaA, p.de, p.ate)).filter((e) => e.nome === 'Smash em dobro').map((e) => e.dia)).toEqual([d3]);

      // A cópia por loja e dia: todos os dias (461), os sem evento com []; rodar de novo só reescreve.
      const r1 = await svc.materializar(t);
      expect(r1).toEqual({ lojas: 2, dias: 2 * 461 });
      const [copia] = await q(`select eventos from calendario_loja_dia where unidade_id = $1 and dia = $2::date`, [lojaA, d3]);
      expect(copia.eventos.map((e: any) => e.nome)).toContain('Smash em dobro');
      const [copiaB] = await q(`select eventos from calendario_loja_dia where unidade_id = $1 and dia = $2::date`, [lojaB, d3]);
      expect(copiaB.eventos.map((e: any) => e.nome)).not.toContain('Smash em dobro');
      await svc.excluir(presidente, lojaA, promo);
      await svc.materializar(t);
      expect(await q(`select count(*)::int as n from calendario_loja_dia where tenant_id = $1`, [t])).toEqual([{ n: 2 * 461 }]);
      const [depois] = await q(`select eventos from calendario_loja_dia where unidade_id = $1 and dia = $2::date`, [lojaA, d3]);
      expect(depois.eventos.map((e: any) => e.nome)).not.toContain('Smash em dobro');
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('"mexe na sua loja?": a vez do ano passado contra o mesmo dia da semana nas semanas antes, só desta loja', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const t = (await q(`insert into empresa (nome) values ('teste efeito') returning id`))[0].id as string;
      const loja = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja A') returning id`, [t]))[0].id as string;
      const outra = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja B') returning id`, [t]))[0].id as string;
      const svc = new CalendarioDaLojaService(drizzle(c as any) as any);
      const presidente = { tenantId: t, colaboradorId: null, categoria: 'presidente' } as any;
      // Um evento da loja que repete todo ano: a vez de amanhã e a do ano passado.
      const amanha = somarDias(hojeISO(), 1);
      const anoPassado = `${Number(amanha.slice(0, 4)) - 1}${amanha.slice(4)}`;
      if (amanha.slice(5) === '02-29') return; // 29/02 não tem a vez do ano passado
      await svc.criar(presidente, loja, { nome: 'Festa da cidade', tipo: 'show', dia: anoPassado, repete: 'ano' });
      const pedidos = async (u: string, dia: string, n: number, status = 'concluido') =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, criado_em)
           select $1, $2, 'cardapio_web', gen_random_uuid()::text, '1', 'X', 'entrega', $5, '[]'::jsonb, 50,
                  ($3::date + time '20:00') at time zone 'America/Sao_Paulo'
             from generate_series(1, $4)`,
          [t, u, dia, n, status],
        );
      await pedidos(loja, anoPassado, 30);
      for (let k = 1; k <= 8; k++) await pedidos(loja, somarDias(anoPassado, -7 * k), 10);
      // Cancelado e pedido de OUTRA loja não contam.
      await pedidos(loja, anoPassado, 20, 'cancelado');
      await pedidos(outra, anoPassado, 50);

      const itens = await svc.listarComEfeito(t, loja, amanha, somarDias(amanha, 3));
      const festa = itens.find((e) => e.nome === 'Festa da cidade');
      // Algumas semanas de referência podem cair em dia de outro evento (feriado, 5º dia útil, dia 20) e ficam fora:
      // a média continua 10 nos dias comuns.
      expect(festa?.efeito).toMatchObject({ vezes: 1, forca: 'fraco' });
      expect(festa?.efeito?.variacao).toBeCloseTo(2, 5);
      expect(festa?.efeito?.texto).toBe('+200% na última vez · pouco histórico');
      // A regra fixa também leva a medida (sem pedido nos anos antes, ou "sem histórico" se a data não aconteceu).
      expect(itens.every((e) => !!e.efeito)).toBe(true);
      // A loja B: o evento não é dela — não aparece.
      expect((await svc.listarComEfeito(t, outra, amanha, somarDias(amanha, 3))).some((e) => e.nome === 'Festa da cidade')).toBe(false);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('o período: padrão de 60 dias, no máximo 120, nada invertido', () => {
    const svc = new CalendarioDaLojaService({} as any);
    const p = svc.periodo();
    expect(p.de).toBe(hojeISO());
    expect(p.ate).toBe(somarDias(hojeISO(), 59));
    expect(() => svc.periodo('2026-12-01', '2026-11-01')).toThrow(/antes/);
    expect(() => svc.periodo('2026-01-01', '2026-12-31')).toThrow(/120/);
    expect(() => svc.periodo('2026-13-01', '2026-12-31')).toThrow(/inválido/);
  });
});
