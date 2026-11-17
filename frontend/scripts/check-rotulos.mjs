// Rótulo LIGADO ao campo (ERR-510): o leitor de tela diz o nome do campo e clicar no rótulo foca o campo. Um rótulo
// (<Label> ou <label>) é SOLTO quando não tem `htmlFor` e não envolve um controle (input, select, textarea, Input…) —
// na tela parece certo, mas o campo fica sem nome (o detector está em `rotulos-soltos.mjs`). Havia 221 no app quando a
// conferência nasceu (17/11/2026): ela é uma CATRACA — `scripts/rotulos-soltos-base.json` guarda a contagem de cada
// arquivo; reprova se um arquivo passar da base (rótulo solto novo) e também se ficar ABAIXO dela (corrigiu: baixe a base
// no mesmo PR, com `--atualizar`, para a dívida não voltar calada). Arquivo que não está na base tem base 0.
// Uso: npm run check:rotulos                    (confere)
//      npm run check:rotulos -- --atualizar     (regrava a base com a contagem de hoje — só depois de corrigir)
//      node scripts/rotulos-soltos.mjs src/…tsx (as linhas dos soltos de um arquivo)
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rotulosSoltos } from './rotulos-soltos.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const src = join(aqui, '..', 'src');
const BASE = join(aqui, 'rotulos-soltos-base.json');

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

caso('o rótulo com htmlFor está ligado', () => assert.equal(rotulosSoltos('const a = <Label htmlFor="x">Nome</Label>;').length, 0));
caso('o rótulo que envolve o campo está ligado', () => assert.equal(rotulosSoltos('const a = <label>Nome <input id="x" /></label>;').length, 0));
caso('o <label> que envolve a caixa de marcar está ligado', () => assert.equal(rotulosSoltos('const a = <label className="f"><input type="checkbox" /> Ativo</label>;').length, 0));
caso('o rótulo que envolve um <Input> está ligado', () => assert.equal(rotulosSoltos('const a = <Label>Valor<Input /></Label>;').length, 0));
caso('o rótulo ao lado do campo, sem htmlFor, é solto', () => {
  const s = rotulosSoltos('const a = <div><Label className="text-xs">Buscar</Label><Input /></div>;');
  assert.equal(s.length, 1);
  assert.equal(s[0].linha, 1);
});
caso('o <label> cru solto também conta', () => assert.equal(rotulosSoltos('const a = <div><label>De</label><input type="date" /></div>;').length, 1));
caso('o rótulo que repassa as props ({...props}) não conta', () => assert.equal(rotulosSoltos('const L = (p) => <label {...p} />;').length, 0));
caso('o rótulo com id (nome do grupo por aria-labelledby) está ligado', () =>
  assert.equal(rotulosSoltos('const a = <div role="group" aria-labelledby="r"><Label id="r">Tema</Label><Button /></div>;').length, 0));

// A contagem de hoje, arquivo a arquivo (só os que têm algum).
function contar() {
  const contagem = {};
  const andar = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith('.tsx')) {
        const s = rotulosSoltos(readFileSync(p, 'utf8'), p);
        if (s.length) contagem[relative(src, p).replace(/\\/g, '/')] = s.length;
      }
    }
  };
  andar(src);
  return Object.fromEntries(Object.entries(contagem).sort(([a], [b]) => a.localeCompare(b)));
}

const hoje = contar();
const total = Object.values(hoje).reduce((s, x) => s + x, 0);
if (process.argv.includes('--atualizar')) {
  writeFileSync(BASE, JSON.stringify(hoje, null, 2) + '\n');
  console.log(`base regravada: ${total} rótulos soltos em ${Object.keys(hoje).length} arquivos`);
  process.exit(0);
}

const base = JSON.parse(readFileSync(BASE, 'utf8'));
const subiu = [];
const desceu = [];
for (const arq of new Set([...Object.keys(hoje), ...Object.keys(base)])) {
  const h = hoje[arq] ?? 0;
  const b = base[arq] ?? 0;
  if (h > b) subiu.push(`${arq}: ${b} → ${h}`);
  else if (h < b) desceu.push(`${arq}: ${b} → ${h}`);
}
caso(`nenhum rótulo solto novo (hoje ${total}; a base guarda a dívida de antes)`, () => {
  if (subiu.length) {
    const detalhe = subiu.map((linha) => {
      const arq = linha.split(':')[0];
      const onde = rotulosSoltos(readFileSync(join(src, arq), 'utf8'), arq).map((r) => `      linha ${r.linha}: ${r.texto}`).join('\n');
      return `   ${linha}\n${onde}`;
    });
    assert.fail(`rótulo sem htmlFor e sem envolver o campo (ERR-510) — ligue com htmlFor + id:\n${detalhe.join('\n')}`);
  }
});
caso('a base acompanha a correção (corrigiu → baixe a base no mesmo PR)', () => {
  if (desceu.length) assert.fail(`menos rótulos soltos que a base — rode "npm run check:rotulos -- --atualizar":\n   ${desceu.join('\n   ')}`);
});
console.log(`check:rotulos — ${n} conferências ok (${total} rótulos soltos na base)`);
