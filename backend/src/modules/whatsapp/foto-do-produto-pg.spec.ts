import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { escolherProduto, perguntaDoCliente, produtosDaLoja } from './foto-do-produto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRODUTO DA FOTO CONFERIDO PELO REGEM (ERR-335, 31/10/2026) contra o Postgres: os produtos que o cardápio mostra
// (ativos e não apagados, a regra do menu público) e o que o cliente disse NESTA vez (as mensagens dele depois da última
// resposta da loja; o resumo mandado no meio desta vez não corta). A tabela das conversas é só da nuvem: o teste aplica
// a 215 (o banco do CI é o de uma loja).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('foto-do-produto-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_215 = join(__dirname, '../../../../database/migrations/215_whatsapp_mensagem.sql');

descrever('foto do produto: produtos da loja e a pergunta do cliente (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const empresas: string[] = [];

  beforeAll(async () => {
    await pool.query(readFileSync(MIG_215, 'utf8'));
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['whatsapp_mensagem', 'produto'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa(): Promise<string> {
    const t = (await q(`insert into empresa (nome) values ('teste foto do produto') returning id`))[0].id as string;
    empresas.push(t);
    return t;
  }
  const produto = async (t: string, nome: string, extra: { ativo?: boolean; apagado?: boolean; imagem?: string } = {}) =>
    (
      await q(
        `insert into produto (tenant_id, nome, ativo, imagem_ref, deleted_at) values ($1, $2, $3, $4, $5) returning id`,
        [t, nome, extra.ativo ?? true, extra.imagem ?? null, extra.apagado ? new Date() : null],
      )
    )[0].id as string;
  // `minutos` = há quanto tempo a mensagem foi gravada.
  const msg = (t: string, telefone: string, direcao: 'entrada' | 'saida', texto: string | null, minutos: number) =>
    q(
      `insert into whatsapp_mensagem (tenant_id, telefone, direcao, texto, criado_em) values ($1, $2, $3, $4, now() - make_interval(secs => $5))`,
      [t, telefone, direcao, texto, minutos * 60],
    );

  it('os produtos que o cardápio mostra: ativos e não apagados, da loja; o mesmo nome em duas cópias vem junto', async () => {
    const t = await empresa();
    const outra = await empresa();
    const t07a = await produto(t, 'TRIO 07', { imagem: 'https://fotos.exemplo/t07.jpg' });
    const t07b = await produto(t, 'TRIO 07', { imagem: 'https://fotos.exemplo/t07.jpg' });
    await produto(t, 'Numero 07');
    await produto(t, 'TRIO 09', { ativo: false });
    await produto(t, 'TRIO 10', { apagado: true });
    await produto(outra, 'TRIO 08');
    const lista = await produtosDaLoja(db, t);
    expect(lista.map((p) => p.nome)).toEqual(['Numero 07', 'TRIO 07', 'TRIO 07']);
    expect(lista.filter((p) => p.nome === 'TRIO 07').map((p) => p.id).sort()).toEqual([t07a, t07b].sort());
    expect(lista.find((p) => p.id === t07a)?.imagem).toBe('https://fotos.exemplo/t07.jpg');
    // E a escolha usa essa lista: pediu a foto do trio 07 → as duas cópias do TRIO 07.
    const e = escolherProduto({ idDoLink: lista[0].id, produtos: lista, pergunta: 'tem foto do trio 07?', resposta: 'Olha o Número 07' });
    expect(e.motivo).toBe('foto_pedida');
    expect([...e.ids].sort()).toEqual([t07a, t07b].sort());
  });

  it('a pergunta desta vez: as mensagens do cliente depois da última resposta (o resumo no meio desta vez não corta)', async () => {
    const t = await empresa();
    const tel = '5521987650001';
    await msg(t, tel, 'entrada', 'tem foto do x-bacon?', 9); // vez anterior
    await msg(t, tel, 'saida', 'Olha o X-Bacon', 8); // a resposta da vez anterior corta
    await msg(t, tel, 'entrada', 'Tem foto', 3); // esta vez, em duas mensagens
    await msg(t, tel, 'entrada', 'do trio 07?', 2);
    await msg(t, tel, 'saida', '[resumo mandado no meio desta vez]', 1);
    expect(await perguntaDoCliente(db, t, tel)).toBe('Tem foto\ndo trio 07?');
  });

  it('o número da conversa casa com e sem o 55 e sem o nono dígito; outra loja e mensagem velha (15 min) não entram', async () => {
    const t = await empresa();
    const outra = await empresa();
    await msg(t, '552187650002', 'entrada', 'foto do trio 08', 1); // o wa_id sem o nono dígito
    await msg(outra, '5521987650002', 'entrada', 'foto da coca', 0); // outra loja, mesmo número
    expect(await perguntaDoCliente(db, t, '5521987650002')).toBe('foto do trio 08');
    expect(await perguntaDoCliente(db, t, '21987650002')).toBe('foto do trio 08');
    const velha = await empresa();
    await msg(velha, '5521987650003', 'entrada', 'foto do trio 01', 20);
    expect(await perguntaDoCliente(db, velha, '5521987650003')).toBeNull();
    expect(await perguntaDoCliente(db, t, 'nao-e-numero')).toBeNull();
  });
});
