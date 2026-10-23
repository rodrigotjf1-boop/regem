/**
 * A versão do Node que a nuvem roda: os dois Dockerfiles (backend e frontend) e o CI com a MESMA versão exata, nunca
 * abaixo da correção do boletim do Node de 21/10/2026 (Brotli, CVE-2026-111497, e as autoridades da eMudhra). Guarda
 * o erro que o boletim achou: as imagens em `node:20-alpine`, tag flutuante de uma linha sem suporte, e o CI no 20.
 * O Node embutido no instalador do servidor da loja segue o RELEASES.md (sai com o `.exe`, sob comando).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = join(__dirname, '..', '..', '..');
const ler = (...partes: string[]) => readFileSync(join(RAIZ, ...partes), 'utf8');

/** As linhas `FROM` de um Dockerfile, só a imagem. */
const bases = (texto: string) =>
  texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => /^FROM\s/i.test(l))
    .map((l) => l.split(/\s+/)[1] ?? '');

/** A versão corrigida mínima de cada linha (boletim de 21/10/2026). A 20 e as anteriores não têm correção. */
const MINIMA_DA_LINHA: Record<number, [number, number]> = { 22: [23, 4], 24: [22, 1], 26: [12, 1] };

function corrigida(versao: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(versao);
  if (!m) return false;
  const [maior, menor, correcao] = m.slice(1).map(Number) as [number, number, number];
  const minima = MINIMA_DA_LINHA[maior];
  if (!minima) return false;
  return menor > minima[0] || (menor === minima[0] && correcao >= minima[1]);
}

describe('a versão do Node da nuvem (Dockerfiles e CI)', () => {
  const imagens = [...bases(ler('backend', 'Dockerfile')), ...bases(ler('frontend', 'Dockerfile'))];
  const doCi = [...ler('.github', 'workflows', 'ci.yml').matchAll(/node-version:\s*['"]?([^'"\s]+)['"]?/g)].map((m) => m[1] ?? '');

  it('as quatro linhas FROM usam a mesma imagem, com a versão exata (nada de tag flutuante como node:20-alpine)', () => {
    expect(imagens).toHaveLength(4);
    expect(new Set(imagens).size).toBe(1);
    expect(imagens[0]).toMatch(/^node:\d+\.\d+\.\d+-alpine$/);
  });

  it('o CI roda na mesma versão exata das imagens', () => {
    const daImagem = /^node:(\d+\.\d+\.\d+)-alpine$/.exec(imagens[0] ?? '')?.[1];
    expect(doCi.length).toBeGreaterThan(0);
    expect(new Set(doCi)).toEqual(new Set([daImagem]));
  });

  it('a versão tem a correção do boletim de 21/10/2026 (22.23.4, 24.22.1 ou 26.12.1 em diante, na mesma linha)', () => {
    const versao = /^node:(\d+\.\d+\.\d+)-alpine$/.exec(imagens[0] ?? '')?.[1] ?? '';
    expect(corrigida(versao)).toBe(true);
    // a régua: a linha 20 não tem correção; abaixo da mínima da linha, não vale
    expect(['20.19.5', '22.23.3', '24.22.0', '24.18.0', '26.12.0'].filter(corrigida)).toEqual([]);
    expect(['22.23.4', '24.22.1', '24.23.0', '26.12.1'].every(corrigida)).toBe(true);
  });
});
