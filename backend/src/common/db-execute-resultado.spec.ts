import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// Guarda do ERR-127: com o driver da aplicação (`drizzle-orm/node-postgres` + `pg`), o
// `db.execute(sql…)` devolve o RESULTADO do pg — um objeto com `rows` —, não uma lista. Quem
// desestrutura (`const [u] = await this.db.execute(…)`) leva "is not iterable" na hora: foi assim
// que o cupom com `max_usos`, ou com condição (1 por cliente, só cliente novo, dias sem compra),
// derrubava a validação e o PEDIDO do cardápio com 500. Leia `(r.rows ?? r)[0]`.
describe('ninguém desestrutura o resultado do db.execute (é objeto, não lista)', () => {
  const SRC = join(__dirname, '..');
  const arquivos = (d: string): string[] =>
    readdirSync(d).flatMap((n) => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? arquivos(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
    });
  const PADRAO = /\b(const|let|var)\s+\[[^\]\n]*\]\s*(:[^=]*)?=\s*await\s+[\w.]*\bexecute\s*\(/;

  it('nenhum `const [x] = await …execute(` no backend', () => {
    const ruins = arquivos(SRC)
      .flatMap((p) =>
        readFileSync(p, 'utf8')
          .split(/\r?\n/)
          .map((linha, i) => (PADRAO.test(linha) ? `${relative(SRC, p)}:${i + 1}` : null)),
      )
      .filter(Boolean);
    expect(ruins).toEqual([]);
  });

  it('o padrão pega o defeito do ERR-127 (e não o `Promise.all` nem a leitura certa)', () => {
    expect(PADRAO.test('      const [u]: any = await this.db.execute(sql`select 1`);')).toBe(true);
    expect(PADRAO.test('    const [r] = await tx.execute(consulta);')).toBe(true);
    expect(PADRAO.test('    const u: any = await this.db.execute(sql`select 1`);')).toBe(false);
    expect(PADRAO.test('    const [a, b] = await Promise.all([this.db.execute(x), y]);')).toBe(false);
    expect(PADRAO.test('    const [c] = this.rows(await tx.execute(sql`select 1`));')).toBe(false);
    expect(PADRAO.test('      const orfaos: any[] = await this.db.execute(sql`select 1`).then((r: any) => r.rows ?? r);')).toBe(false);
  });
});
