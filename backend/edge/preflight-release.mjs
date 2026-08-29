// PREFLIGHT DE RELEASE DO EDGE — roda ANTES de compilar o .exe (Inno) ou gerar o .zip.
//
// Existe porque um .exe 1.20 foi distribuído QUEBRADO (RegemEdgeWeb em loop
// "Cannot find module 'next'" + transacional não descia) por dois motivos que
// NINGUÉM checou na hora do build — só descobrimos caçando log às cegas:
//   1) o dist foi gerado de uma árvore 158 commits ATRÁS do origin/main;
//   2) o web foi como pasta `web/` (cópia arquivo-a-arquivo) em vez de `web.tar`,
//      e o Inno truncou os caminhos > 260 do node_modules/next (MAX_PATH).
//
// Este script FALHA ALTO (exit 1) se qualquer pré-condição de um build bom estiver
// errada, imprimindo EXATAMENTE o quê. Verde aqui = pode compilar/zipar com confiança.
//
// Uso:  node backend/edge/preflight-release.mjs [versao-esperada]
//   (rode de qualquer cwd; os caminhos são ancorados neste arquivo)

import { existsSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const AQUI = dirname(fileURLToPath(import.meta.url)); // backend/edge
const REPO = join(AQUI, '..', '..'); // raiz do repo (C:\Regen)
const DIST = join(REPO, 'regem-edge-dist');
const ISS = join(AQUI, 'regem-edge.iss');
const versaoEsperada = (process.argv[2] || '').trim();

let falhas = 0;
let avisos = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const erro = (m) => { console.log(`  \x1b[31m✗ ${m}\x1b[0m`); falhas++; };
const aviso = (m) => { console.log(`  \x1b[33m⚠ ${m}\x1b[0m`); avisos++; };
const secao = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);

// ── 1) FONTE: a árvore que gerou o dist está no origin/main? ──────────────────
secao('1) Fonte do build (git)');
try {
  execSync('git fetch origin --quiet', { cwd: REPO, stdio: 'ignore' });
  const atras = execSync('git rev-list --count HEAD..origin/main', { cwd: REPO }).toString().trim();
  const head = execSync("git log -1 --format=%h", { cwd: REPO }).toString().trim();
  if (atras === '0') ok(`HEAD (${head}) == origin/main — 0 commits atrás`);
  else erro(`HEAD está ${atras} commit(s) ATRÁS do origin/main — sincronize (git merge --ff-only origin/main) e regenere o dist. NÃO builde daqui.`);
  const sujo = execSync('git status --porcelain', { cwd: REPO }).toString().trim();
  const relevante = sujo.split('\n').filter((l) => /backend\/(edge|src)|frontend\/src|database/.test(l));
  if (relevante.length) aviso(`árvore tem ${relevante.length} mudança(s) não-commitada(s) em código do build — confirme que o dist reflete o que você quer distribuir.`);
  else ok('sem mudanças de código pendentes que afetem o build');
} catch (e) {
  erro(`não consegui checar o git: ${e.message}`);
}

// ── 2) DIST existe e NÃO tem a pasta web/ (a armadilha MAX_PATH) ──────────────
secao('2) Dist gerado');
if (!existsSync(DIST)) {
  erro(`dist ausente em ${DIST} — rode: cd backend && npm run build && node edge/package.mjs (com EDGE_VERSAO)`);
} else {
  ok('regem-edge-dist/ existe');
  if (existsSync(join(DIST, 'web'))) {
    erro('EXISTE regem-edge-dist/web/ (pasta) — é a cópia arquivo-a-arquivo ANTIGA que trunca o next no Inno. O package.mjs atual deve gerar web.tar, não a pasta. Regenere com o package.mjs do origin/main.');
  } else {
    ok('sem pasta web/ solta (bom — o web vai como tar)');
  }
}

// ── 3) web.tar existe e CONTÉM node_modules/next ─────────────────────────────
secao('3) App (web.tar) com o next dentro');
const webTar = join(DIST, 'web.tar');
if (!existsSync(webTar)) {
  erro('regem-edge-dist/web.tar AUSENTE — o RegemEdgeWeb não sobe sem ele. Regenere o dist.');
} else {
  const mb = (statSync(webTar).size / 1048576).toFixed(1);
  ok(`web.tar presente (${mb} MB)`);
  try {
    const lista = execSync(`tar -tf "${webTar}"`, { maxBuffer: 64 * 1024 * 1024 }).toString();
    if (/(^|\/)node_modules\/next\/package\.json/m.test(lista)) ok('web.tar contém node_modules/next (o app vai subir)');
    else erro('web.tar NÃO contém node_modules/next — RegemEdgeWeb cairá em loop "Cannot find module \'next\'". Rebuild do frontend (npm run build) antes do package.mjs.');
    if (/(^|\/)server\.js$/m.test(lista) || /(^|\/)\.\/server\.js$/m.test(lista)) ok('web.tar contém server.js (standalone)');
    else aviso('não encontrei server.js na raiz do web.tar — confira o output standalone do Next.');
  } catch (e) {
    erro(`não consegui inspecionar o web.tar (tar): ${e.message}`);
  }
}

// ── 4) sync-daemon do dist tem os fixes de sync (keyset + don't-abort) ────────
secao('4) sync-daemon do dist (transacional desce)');
const daemon = join(DIST, 'edge', 'sync-daemon.mjs');
if (!existsSync(daemon)) {
  erro('regem-edge-dist/edge/sync-daemon.mjs ausente — dist incompleto.');
} else {
  const src = readFileSync(daemon, 'utf8');
  if (src.includes('pull_cursores')) ok('pull KEYSET por tabela presente (#393 — tabela grande não "pula")');
  else erro('sync-daemon SEM keyset (pull_cursores) — versão ANTIGA. O dist saiu de uma árvore velha. Regenere do origin/main.');
  if (src.includes('IGNORADA')) ok('pull don\'t-abort presente (linha "veneno" não trava o pull inteiro)');
  else erro('sync-daemon SEM don\'t-abort — uma linha ruim aborta o pull e o transacional PARA de descer. Regenere do origin/main.');
}

// ── 5) versões batem: version.txt == .iss AppVer == esperada ─────────────────
secao('5) Versão consistente');
let vTxt = '';
let vIss = '';
const versaoTxt = join(DIST, 'version.txt');
if (existsSync(versaoTxt)) { vTxt = readFileSync(versaoTxt, 'utf8').trim(); ok(`version.txt = ${vTxt}`); }
else erro('regem-edge-dist/version.txt ausente — o instalador reportaria 0. Rode o package.mjs com EDGE_VERSAO definido.');
if (existsSync(ISS)) {
  const m = readFileSync(ISS, 'utf8').match(/#define\s+AppVer\s+"([^"]+)"/);
  vIss = m ? m[1] : '';
  if (vIss) ok(`.iss AppVer = ${vIss}`);
  else erro('não achei #define AppVer no regem-edge.iss');
} else erro('regem-edge.iss ausente');
if (vTxt && vIss && vTxt !== vIss) erro(`version.txt (${vTxt}) ≠ .iss AppVer (${vIss}) — o .exe sairia com versão trocada. Alinhe os dois.`);
else if (vTxt && vIss) ok('version.txt == .iss AppVer');
if (versaoEsperada) {
  if (vTxt === versaoEsperada && vIss === versaoEsperada) ok(`bate com a versão pedida (${versaoEsperada})`);
  else erro(`versão pedida ${versaoEsperada} ≠ version.txt ${vTxt} / .iss ${vIss}`);
}

// ── Veredito ─────────────────────────────────────────────────────────────────
console.log('');
if (falhas === 0) {
  console.log(`\x1b[42m\x1b[30m PREFLIGHT OK \x1b[0m ${avisos ? `(${avisos} aviso(s))` : ''} — pode compilar o regem-edge.iss no Inno / gerar o .zip.`);
  process.exit(0);
} else {
  console.log(`\x1b[41m\x1b[37m PREFLIGHT FALHOU: ${falhas} problema(s) \x1b[0m — NÃO gere o .exe/.zip até resolver acima.`);
  process.exit(1);
}
