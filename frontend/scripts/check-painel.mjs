// Painel do delivery legível (pedido do dono, 28/10/2026). Confere:
//   1) o cinza do texto secundário do painel (`.app-light .painel-delivery` em globals.css) com 4,5:1 ou mais em cada
//      fundo do painel — e ainda mais claro que o ink-2, para a hierarquia seguir;
//   2) a regra pura `src/lib/escolhas-do-item.ts`: as escolhas do item uma por linha (canal e nosso cardápio);
//   3) o painel usa o tom (contêiner `painel-delivery`) e os itens no formato novo (prévia e detalhe).
// Uso: npm run check:painel
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const css = readFileSync(join(src, 'app', 'globals.css'), 'utf8');

// ── 1) contraste ──────────────────────────────────────────────────────────────────────────────────────────────
const bloco = (seletor) => {
  const i = css.indexOf(`${seletor} {`);
  assert.ok(i >= 0, `bloco ${seletor} não achado em globals.css`);
  return css.slice(i, css.indexOf('}', i));
};
const hsl = (texto, nome) => {
  const m = new RegExp(`--${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`).exec(texto);
  assert.ok(m, `--${nome} não achado`);
  return [Number(m[1]), Number(m[2]) / 100, Number(m[3]) / 100];
};
const rgb = ([h, s, l]) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m].map((v) => Math.round(v * 255));
};
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lum = (cor) => {
  const [r, g, b] = cor.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const claro = bloco('.app-light');
const painel = bloco('.app-light .painel-delivery');
const cinza = rgb(hsl(painel, 'muted-foreground'));
const fundos = {
  'cartão (branco)': rgb(hsl(claro, 'card')),
  'fundo da página': rgb(hsl(claro, 'background')),
  'superfície secundária': rgb(hsl(claro, 'muted')),
  // a linha destacada da lista (bg-primary/15 sobre o branco)
  'linha destacada': (() => {
    const p = rgb(hsl(claro, 'primary'));
    return p.map((v) => Math.round(0.15 * v + 0.85 * 255));
  })(),
};
for (const [nome, fundo] of Object.entries(fundos)) {
  const c = contraste(cinza, fundo);
  assert.ok(c >= 4.5, `painel: o cinza sobre ${nome} dá ${c.toFixed(2)} — abaixo de 4,5`);
}
// Era ilegível (o motivo da mudança) e a hierarquia segue: mais claro que o ink-2.
assert.ok(contraste(rgb(hsl(claro, 'muted-foreground')), fundos['fundo da página']) < 4.5, 'o cinza do app inteiro mudou? (decisão: só no painel)');
assert.ok(
  contraste(cinza, fundos['cartão (branco)']) < contraste(rgb(hsl(claro, 'secondary-foreground')), fundos['cartão (branco)']),
  'o cinza do painel ficou mais escuro que o ink-2: a hierarquia sumiu',
);
assert.deepEqual(cinza, hex('#5B6B7B'));

// ── 2) escolhas do item, uma por linha ─────────────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'check-painel-'));
writeFileSync(
  join(tmp, 'escolhas-do-item.mjs'),
  ts.transpileModule(readFileSync(join(src, 'lib', 'escolhas-do-item.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const { itemComEscolhas } = await import(pathToFileURL(join(tmp, 'escolhas-do-item.mjs')).href);
rmSync(tmp, { recursive: true, force: true });

// Pedido de canal (iFood, 99…): as escolhas no campo `complementos`.
assert.deepEqual(itemComEscolhas({ descricao: 'Trio 08', complementos: 'Batata média · 2x Coca-Cola · Sem gelo' }), {
  nome: 'Trio 08',
  escolhas: ['+ Batata média', '+ 2x Coca-Cola', 'Sem gelo'],
});
// Nosso cardápio: as escolhas no fim do nome — só quando o item traz as opções.
assert.deepEqual(itemComEscolhas({ descricao: 'X-Burger (2x Bacon, Sem cebola)', opcaoIds: ['a', 'b'] }), {
  nome: 'X-Burger',
  escolhas: ['+ 2x Bacon', 'Sem cebola'],
});
// Sem opções, o parêntese é do nome do produto e fica.
assert.deepEqual(itemComEscolhas({ descricao: 'Refrigerante (lata)' }), { nome: 'Refrigerante (lata)', escolhas: [] });
assert.deepEqual(itemComEscolhas({ nome: 'Água' }), { nome: 'Água', escolhas: [] });

// ── 3) o painel usa ─────────────────────────────────────────────────────────────────────────────────────────────
const pagina = readFileSync(join(src, 'app', 'delivery', 'page.tsx'), 'utf8');
assert.match(pagina, /className="painel-delivery contents"/, 'o painel não está dentro do contêiner `painel-delivery`');
assert.match(pagina, /<ItensDoPedido\s/, 'a prévia do pedido não usa ItensDoPedido');
const detalhe = readFileSync(join(src, 'components', 'delivery', 'pedido-detalhe.tsx'), 'utf8');
assert.match(detalhe, /<ItensDoPedido\s/, 'o detalhe do pedido não usa ItensDoPedido');

console.log('check:painel OK — contraste do painel ≥ 4,5:1 em', Object.keys(fundos).length, 'fundos; escolhas uma por linha');
