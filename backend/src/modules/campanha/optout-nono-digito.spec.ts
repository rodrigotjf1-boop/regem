import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { registrarEvento, registrarSaida, registrarVolta, estaNaListaDeExclusao } from '../../common/consentimento-marketing';
import { chaveTelefone } from '../../common/telefone-chave';
import { esquecerCliente } from '../cliente/esquecer-cliente';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OPT-OUT COM O NONO DÍGITO E COM HISTÓRICO (ERR-134, mig 300), contra o Postgres real.
//
// O banco do CI é montado como servidor de loja: `marketing_optout` (mig 226) e o histórico
// (mig 300) são só da nuvem e não existem nele. Os dois sobem num schema SÓ DESTE TESTE, na
// frente do `public` (sem FK para tabela compartilhada — LIC-088); empresa e cliente são os do
// `public`, com uma empresa própria.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('optout-nono-digito.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

descrever('opt-out com o nono dígito e com histórico (ERR-134)', () => {
  const SCHEMA = `teste_optout_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const T = randomUUID();
  let admin: Pool;
  let pool: Pool;
  let db: any;
  let svc: CampanhaService;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const cliente = async (nome: string, telefone: string) =>
    (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [T, nome, telefone]))[0]
      .id as string;
  const lista = async () => q(`select telefone from marketing_optout where tenant_id = $1 order by criado_em`, [T]);
  const historico = async () =>
    q(`select acao, origem, telefone_chave, autor_id from marketing_consentimento where tenant_id = $1 order by em, id`, [T]);

  beforeAll(async () => {
    admin = new Pool({ connectionString: URL_PG });
    await admin.query(`create schema ${SCHEMA}`);
    pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
    // A lista de exclusão como a 226 cria (só a tabela — a 226 também altera `campanha`).
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);`);
    const conf: any = await pool.query(semFkCompartilhada(readFileSync(join(MIGS, '300_marketing_consentimento.sql'), 'utf8')));
    const linhas = (Array.isArray(conf) ? conf[conf.length - 1] : conf).rows;
    if (linhas.some((l: any) => !l.ok)) throw new Error(`conferência da 300: ${JSON.stringify(linhas)}`);
    db = drizzle(pool, { schema });
    svc = new CampanhaService(db, {} as any, {} as any, {} as any);
    await admin.query(`insert into empresa (id, nome) values ($1,'teste opt-out nono digito')`, [T]);
  });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`delete from cliente where tenant_id = $1`, [T]).catch(() => {});
    await admin.query(`delete from empresa where id = $1`, [T]).catch(() => {});
    await admin.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin.end();
  });

  it('a chave do banco (regem_telefone_chave, mig 300) = a do código', async () => {
    for (const t of ['552199998888', '+55 (21) 99999-8888', '2133334444', '5599998888', '0800 123 4567', '']) {
      const [r] = await q(`select regem_telefone_chave($1) as k`, [t]);
      expect(r.k).toBe(chaveTelefone(t));
    }
  });

  it('SAIR vindo do WhatsApp SEM o 9 tira da campanha o cadastro COM o 9 — e o fixo parecido continua', async () => {
    await cliente('Ana', '21999998888');
    await cliente('Fixo da Ana', '2133334444');
    await cliente('Sem telefone (mig 073)', 'S/N-0123456789');
    expect((await svc.previa(T, 'todos')).total).toBe(2);

    expect(await registrarSaida(db, { tenantId: T, telefone: '552199998888', origem: 'whatsapp', motivo: 'palavra_chave' })).toBe(true);
    // Antes: só o 55 era tirado → '2199998888' ≠ '21999998888' e a Ana continuava na campanha.
    expect((await svc.previa(T, 'todos')).total).toBe(1);
    expect(await estaNaListaDeExclusao(db, T, '(21) 99999-8888')).toBe(true);
    expect(await estaNaListaDeExclusao(db, T, '2133334444')).toBe(false);
  });

  it('o mesmo número em outra forma não duplica a lista; o histórico registra cada pedido', async () => {
    await registrarSaida(db, { tenantId: T, telefone: '5521999998888', origem: 'whatsapp', motivo: 'palavra_chave' });
    expect(await lista()).toHaveLength(1);
    const h = await historico();
    expect(h.filter((e: any) => e.acao === 'saida')).toHaveLength(2);
    expect(h.every((e: any) => e.telefone_chave === '21999998888')).toBe(true);
  });

  it('a trava do envio confere a lista pela chave E a marca do cadastro', async () => {
    const saiu = (tel: string, id: string | null = null) => (svc as any).saiuAntesDoEnvio(T, tel, id);
    expect(await saiu('21999998888')).toBe(true); // lista, com o 9
    expect(await saiu('2133334444')).toBe(false); // o fixo não saiu
    const bia = await cliente('Bia', '21977776666');
    expect(await saiu('21977776666', bia)).toBe(false);
    await svc.toggleOptOut(T, bia, true, randomUUID());
    expect(await saiu('21977776666', bia)).toBe(true); // antes: só a lista era conferida no envio
  });

  it('VOLTAR tira da lista em TODAS as formas e deixa a volta no histórico', async () => {
    expect(await registrarVolta(db, { tenantId: T, telefone: '5521999998888', origem: 'whatsapp' })).toBe(1);
    expect(await lista()).toHaveLength(0);
    expect((await historico()).filter((e: any) => e.telefone_chave === '21999998888').map((e: any) => e.acao)).toEqual([
      'saida',
      'saida',
      'volta',
    ]);
    expect((await svc.previa(T, 'todos')).total).toBe(2); // Ana voltou; a Bia saiu pelo painel
  });

  it('o botão do painel registra saída e volta no histórico, com quem da loja fez', async () => {
    const autor = randomUUID();
    const caio = await cliente('Caio', '21966665555');
    await svc.toggleOptOut(T, caio, true, autor);
    await svc.toggleOptOut(T, caio, false, autor);
    const h = (await historico()).filter((e: any) => e.telefone_chave === '21966665555');
    expect(h.map((e: any) => [e.acao, e.origem, e.autor_id])).toEqual([
      ['saida', 'painel', autor],
      ['volta', 'painel', autor],
    ]);
    expect(await lista()).toHaveLength(0); // o painel mexe na marca do cadastro, não na lista
  });

  it('"Excluir conta" (LGPD) apaga os eventos do cadastro — e só os dele', async () => {
    const eli = await cliente('Eli', '21955554444');
    await registrarEvento(db, { tenantId: T, telefone: '21955554444', clienteId: eli, origem: 'painel' }, 'saida');
    const antes = (await historico()).length;
    expect(await esquecerCliente(db, T, eli)).toMatchObject({ clienteApagado: true });
    const depois = await historico();
    expect(depois).toHaveLength(antes - 1);
    expect(depois.some((e: any) => e.telefone_chave === '21955554444')).toBe(false);
  });

  it('SAIR repassado pelo n8n marca o cadastro guardado na forma antiga (sem o 9)', async () => {
    const duda = await cliente('Duda', '2188887777'); // cadastro antigo, sem o 9
    await svc.optOutPorTelefone(T, '+55 21 98888-7777', 'manual');
    const [c] = await q(`select opt_out_marketing from cliente where id = $1`, [duda]);
    expect(c.opt_out_marketing).toBe(true);
    const nomes = (await svc.listarOptout(T)).map((l: any) => l.nome);
    expect(nomes).toContain('Duda');
  });
});
