// Confere o Atendimento contra o ERR-514 (17/11/2026): as linhas "ThrottlerException: Too Many Requests" empilhadas no caso.
//  1. As peças IRMÃS do detalhe do caso (`function Caso` em app/atendimento/page.tsx) têm chaves DIFERENTES. Com a mesma
//     chave (`key={c.id}` em seis delas), o React perdia a cópia antiga sem desmontá-la quando uma peça aparecia ou sumia:
//     ela ficava na tela congelada e o relógio dela seguia lendo o servidor — até o 429 da rede inteira.
//  2. As peças do caso que leem sozinhas param com a aba escondida (o limite do servidor é por rede).
//  3. O cliente da API troca o 429 por uma frase em português (o texto cru do servidor ia para a tela).
// Uso: npm run check:atendimento
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ler = (p) => readFileSync(join(src, p), 'utf8').replace(/\r\n/g, '\n');

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log(`  ✓ ${nome}`);
};

caso('as peças irmãs do caso têm chaves diferentes (sem `key={c.id}` repetido)', () => {
  const pagina = ler('app/atendimento/page.tsx');
  const ini = pagina.indexOf('\nfunction Caso(');
  assert.ok(ini > 0, 'não achei `function Caso(` em app/atendimento/page.tsx');
  const resto = pagina.slice(ini + 1);
  const fim = resto.search(/\n(export )?function /);
  const corpo = fim > 0 ? resto.slice(0, fim) : resto;
  // a chave é um texto com crase (`chat-${c.id}`) OU uma expressão sem chaves (c.id)
  const chaves = [...corpo.matchAll(/\bkey=\{(`[^`]*`|[^{}]+)\}/g)].map((m) => m[1].trim());
  assert.ok(chaves.length >= 6, `esperava as chaves das peças do caso (achei ${chaves.length})`);
  const repetidas = chaves.filter((k, i) => chaves.indexOf(k) !== i);
  assert.deepEqual(repetidas, [], `chave repetida entre as peças do caso: ${[...new Set(repetidas)].join(', ')}`);
  assert.ok(!chaves.includes('c.id'), 'peça do caso com `key={c.id}` puro: use um prefixo da peça (`chat-${c.id}`)');
});

caso('as leituras automáticas do caso param com a aba escondida', () => {
  for (const arq of ['chat-da-plataforma.tsx', 'avisar-o-entregador.tsx', 'conversa-do-caso.tsx', 'conversa-do-instagram.tsx', 'conversa-do-messenger.tsx']) {
    const t = ler(`components/atendimento/${arq}`);
    const relogios = [...t.matchAll(/setInterval\(([\s\S]*?)\},? *\d[\d_]*\)/g)].map((m) => m[1]);
    assert.ok(relogios.length > 0, `${arq}: não achei o relógio de leitura`);
    for (const r of relogios) assert.match(r, /document\.visibilityState === 'visible'/, `${arq}: o relógio lê com a aba escondida`);
  }
});

caso('o cliente da API troca o 429 por uma frase em português, nos três caminhos', () => {
  const api = ler('lib/api.ts');
  assert.match(api, /export const MSG_MUITAS_CHAMADAS = '[^']+'/);
  const vezes = (api.match(/if \(res\.status === 429\) throw muitasChamadas\(\);/g) || []).length;
  assert.equal(vezes, 3, `o 429 tratado em ${vezes} de 3 caminhos (req, pub, reqAparelho)`);
});

console.log(`\ncheck:atendimento — ${n} grupos de casos, todos certos.`);
