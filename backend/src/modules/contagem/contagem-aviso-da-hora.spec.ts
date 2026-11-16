import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ContagemService } from './contagem.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO "HORA DE CONTAR O ESTOQUE" VAI COM A LOJA DA LISTA (ERR-494). Sem a loja, o aviso era da empresa inteira: numa
// rede de várias lojas, a lista de uma aparecia nas telas de gestão de todas. Postgres real, o serviço de verdade.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('contagem-aviso-da-hora.spec: sem TEST_PG_URL — PULADO');

const horaDeSaoPaulo = () =>
  Number(new Date().toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false }).slice(0, 2));
const hhmm = (h: number) => `${String((h + 24) % 24).padStart(2, '0')}:00`;

descrever('aviso da hora de contar (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const lojaA = randomUUID();
  const lojaB = randomUUID();
  const avisos: any[] = [];
  const svc = new ContagemService(db, { emit: (_: string, a: any) => avisos.push(a) } as any, { registrar: async () => undefined } as any);
  const meus = () => avisos.filter((a) => a.tenantId === T);

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste aviso da contagem')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $3, 'Loja A'), ($2, $3, 'Loja B')`, [lojaA, lojaB, T]);
  });
  afterAll(async () => {
    await q(`delete from contagem_lista where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from unidade where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('a lista da loja A avisa com a loja A; a de outra hora, a desligada e a sem aviso não avisam', async () => {
    // A rotina compara com a hora cheia de São Paulo: se a hora virar no meio do teste, monta de novo (uma vez).
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      avisos.length = 0;
      await q(`delete from contagem_lista where tenant_id = $1`, [T]);
      const h = horaDeSaoPaulo();
      const lista = (nome: string, loja: string | null, hora: string | null, o: { avisa?: boolean; ativa?: boolean } = {}) =>
        q(
          `insert into contagem_lista (tenant_id, unidade_id, nome, recorrencia, hora, enviar_kds, ativo) values ($1, $2, $3, 'diaria', $4, $5, $6)`,
          [T, loja, nome, hora, o.avisa ?? true, o.ativa ?? true],
        );
      await lista('Freezer da loja A', lojaA, hhmm(h));
      await lista('Bebidas da loja B', lojaB, hhmm(h));
      await lista('Lista da rede', null, hhmm(h));
      await lista('De outra hora', lojaA, hhmm(h + 3));
      await lista('Sem horário', lojaA, null);
      await lista('Sem aviso', lojaA, hhmm(h), { avisa: false });
      await lista('Desligada', lojaA, hhmm(h), { ativa: false });
      await svc.alertasContagem();
      if (horaDeSaoPaulo() === h) break;
    }
    const porTitulo = Object.fromEntries(meus().map((a) => [a.titulo, a]));
    expect(Object.keys(porTitulo).sort()).toEqual(['Contagem: Bebidas da loja B', 'Contagem: Freezer da loja A', 'Contagem: Lista da rede']);
    expect(porTitulo['Contagem: Freezer da loja A']).toMatchObject({ tenantId: T, unidadeId: lojaA, tipo: 'gestao', prioridade: 'media' });
    expect(porTitulo['Contagem: Bebidas da loja B'].unidadeId).toBe(lojaB);
    // A lista sem loja (da rede) segue indo para a empresa inteira.
    expect(porTitulo['Contagem: Lista da rede'].unidadeId).toBeNull();
  });
});
