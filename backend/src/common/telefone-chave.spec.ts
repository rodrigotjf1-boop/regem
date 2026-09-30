import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { DeliveryService } from '../modules/delivery/delivery.service';
import { chaveTelefone, formasNoCadastro, sqlChaveTelefone, telefoneCadastro } from './telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CHAVE do telefone decide se dois registros são o MESMO número (opt-out, lista de exclusão,
// trava do envio — ERR-134). O WhatsApp manda muitos celulares SEM o nono dígito e com o 55; o
// cadastro tem com o 9 e sem o 55. Fixo nunca casa com celular.
const CASOS: [unknown, string | null][] = [
  ['21999998888', '21999998888'],
  ['(21) 99999-8888', '21999998888'],
  ['+55 21 99999-8888', '21999998888'],
  ['5521999998888', '21999998888'],
  ['005521999998888', '21999998888'],
  ['021999998888', '21999998888'], // 0 de longa distância
  ['2199998888', '21999998888'], // celular antigo, sem o 9
  ['552199998888', '21999998888'], // wa_id sem o 9
  ['2133334444', '2133334444'], // fixo fica fixo
  ['552133334444', '2133334444'],
  ['21933334444', '21933334444'],
  ['55999998888', '55999998888'], // DDD 55 (RS), sem o código do país
  ['5555999998888', '55999998888'],
  ['5599998888', '55999998888'], // DDD 55, celular antigo
  ['555599998888', '55999998888'],
  ['', null],
  [null, null],
  ['abc', null],
];

describe('chave do telefone (comparação)', () => {
  it.each(CASOS)('%p → %p', (entrada, chave) => {
    expect(chaveTelefone(entrada)).toBe(chave);
  });

  it('fixo e celular com os mesmos 8 dígitos NÃO são o mesmo número', () => {
    expect(chaveTelefone('2133334444')).not.toBe(chaveTelefone('21933334444'));
  });
});

describe('telefone como o cadastro guarda', () => {
  const ENTRADAS = ['+55 (21) 99999-8888', '21999998888', '55999998888', '5521999998888', '552133334444', '2133334444', '123', '', null];

  it('tira só a formatação e o 55 do país — DDD 55 fica', () => {
    expect(telefoneCadastro('+55 (21) 99999-8888')).toBe('21999998888');
    expect(telefoneCadastro('55999998888')).toBe('55999998888');
    expect(telefoneCadastro('552133334444')).toBe('2133334444');
    expect(telefoneCadastro(null)).toBe('');
  });

  it('é a MESMA regra da entrada de pedidos (DeliveryService.normTel) — senão o cardápio duplica o cliente (ERR-135)', () => {
    const normTel = (DeliveryService as any).normTel as (v: unknown) => string;
    for (const e of ENTRADAS) expect(telefoneCadastro(e)).toBe(normTel(e));
  });

  it('formas em que o cadastro pode estar: sem o 55 (hoje) e com o 55 (antes da correção)', () => {
    expect(formasNoCadastro('+55 21 99999-8888')).toEqual(['21999998888', '5521999998888']);
    expect(formasNoCadastro('123')).toEqual(['123']);
    expect(formasNoCadastro('')).toEqual([]);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('telefone-chave.spec: sem TEST_PG_URL — conferência no banco PULADA');

descrever('chave do telefone em SQL = a do TypeScript (Postgres real)', () => {
  let pool: Pool;
  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
  });
  afterAll(async () => {
    await pool?.end();
  });

  it.each(CASOS)('%p', async (entrada, chave) => {
    const db = drizzle(pool);
    const r: any = await db.execute(sql`select ${sqlChaveTelefone(sql`${entrada as any}`)} as k`);
    expect((r.rows ?? r)[0].k).toBe(chave);
  });
});
