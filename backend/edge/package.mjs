// Monta a pasta distribuível do Regem Edge (para copiar ao PC da loja).
// Uso (na pasta backend/): npm run build && node edge/package.mjs
// Saída: ../regem-edge-dist/  → copie para o PC da loja e siga edge/INSTALL-WINDOWS.md
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync, readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';
import { createHash } from 'node:crypto';

const raiz = process.cwd(); // backend/
const out = join(raiz, '..', 'regem-edge-dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Não copiar: binários portáteis do instalador (edge/bundle), node_modules de
// desenvolvimento, nem edge/Output (o .exe que o Inno Setup compila — copiá-lo
// geraria um instalador-dentro-do-instalador, inchando centenas de MB). O
// node_modules de PRODUÇÃO é gerado do zero mais abaixo (npm ci --omit=dev).
// PROTEÇÃO DE PROPRIEDADE (Fase 1): também barra o que vaza o FONTE/lógica na loja:
//   - .map (sourcemaps reconstroem o TS original com comentários),
//   - .d.ts (declarações revelam a estrutura interna),
//   - .md (docs de instalação/build; nada de documentação fica no PC da loja).
const VAZA_LOGICA = /\.map$|\.d\.ts$|\.md$/i;
// Chaves PRIVADAS nunca vão para a loja (só a pública update-pub.pem vai, p/ o
// verify-update.mjs conferir a assinatura). Barra update-priv.pem e qualquer .pfx.
const SEGREDO = /(^|[\\/])update-priv\.pem$|\.pfx$/i;
const semBundle = (s) =>
  !/[\\/](bundle|node_modules|Output)([\\/]|$)/.test(s) && !VAZA_LOGICA.test(s) && !SEGREDO.test(s);

const copiar = (rel) => {
  const src = join(raiz, rel);
  if (!existsSync(src)) { console.warn(`  (pulando, não existe) ${rel}`); return; }
  cpSync(src, join(out, rel), { recursive: true, filter: semBundle });
  console.log(`  + ${rel}`);
};

// Fase 2 — manifesto de integridade: sha256 de cada .js do dist copiado. O app
// confere no boot (src/integridade.ts) e detecta adulteração do código no PC da loja.
function gerarManifesto() {
  const distOut = join(out, 'dist');
  const man = {};
  const walk = (dir) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.js$/i.test(nome)) {
        const rel = relative(out, p).replace(/\\/g, '/'); // ex.: dist/main.js
        man[rel] = createHash('sha256').update(readFileSync(p)).digest('hex');
      }
    }
  };
  if (existsSync(distOut)) walk(distOut);
  writeFileSync(join(out, 'dist-manifest.json'), JSON.stringify(man));
  console.log(`  + dist-manifest.json (${Object.keys(man).length} arquivos)`);
}

console.log('Montando regem-edge-dist/…');
copiar('dist');                 // backend compilado (rode `npm run build` antes)
gerarManifesto();               // manifesto de integridade do dist recém-copiado
copiar('package.json');
copiar('package-lock.json');
copiar('edge');                 // daemon, gen-cert, scripts de serviço, .env.example
copiar('scripts');              // apply-all-local.mjs, etc.
copiar('drizzle.config.ts');
// migrations ficam em database/migrations (fora de backend/) → copiamos também
cpSync(join(raiz, '..', 'database', 'migrations'), join(out, 'database', 'migrations'), { recursive: true });
console.log('  + database/migrations');

// Versão do pacote → version.txt: o instalador (instalar-tudo.ps1) lê e carimba
// APP_VERSION no .env.local. Antes o instalador tinha 1.6.0 hardcoded (toda
// instalação reportava 1.6.0). publicar.ps1 define EDGE_VERSAO=<versão>.
const versaoPkg = (process.env.EDGE_VERSAO || '').trim();
if (versaoPkg) {
  writeFileSync(join(out, 'version.txt'), versaoPkg);
  console.log(`  + version.txt (${versaoPkg})`);
} else {
  console.warn('  (AVISO) EDGE_VERSAO não definido — version.txt não escrito (instalador usará 0).');
}

// App (frontend) em modo edge -> web/ (Next standalone autossuficiente). O
// edge-web.mjs sobe esse Next em HTTP no localhost e serve por HTTPS na LAN.
if (!process.env.SKIP_WEB_BUILD) {
  console.log('  + web (build do app em modo edge)…');
  execSync('node edge/build-web.mjs', { cwd: raiz, stdio: 'inherit' });
}
const saDir = join(raiz, '..', 'frontend', '.next', 'standalone');
if (existsSync(join(saDir, 'server.js'))) {
  // web/ vai como TAR (1 arquivo) e é extraído com `tar` no install. Motivo: o
  // node_modules do next tem caminhos > 260 chars; a cópia arquivo-a-arquivo do Inno
  // Setup (no .exe) e do Expand-Archive (no .zip) DROPA esses arquivos em silêncio
  // (MAX_PATH) → "Cannot find module 'next'" e o RegemEdgeWeb cai em loop. O tar
  // (bsdtar do Windows 10+) preserva caminhos longos. Limpa .md do standalone antes.
  limparMd(saDir);
  execSync(`tar -cf "${join(out, 'web.tar')}" -C "${saDir}" .`, { stdio: 'inherit' });
  console.log('  + web.tar (standalone empacotado; extraído no install)');
} else {
  console.warn('  (AVISO) web nao encontrado — rode sem SKIP_WEB_BUILD para gerar o app.');
}

// Dependências de produção EMBUTIDAS → instalação 100% offline (sem npm ci na loja).
// bcryptjs e pg são JS puro (sem binários nativos), então o node_modules é portável
// entre máquinas Windows x64 e casa com o Node embutido no instalador.
console.log('  + node_modules (npm ci --omit=dev — baixa as deps uma vez, aqui)…');
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
console.log('  + node_modules (embutido)');

// O public/ do app pode trazer .md de documentação (ex.: integracoes/README) que
// o build-web copia sem o filtro. Docs não vão para a loja — remove do bundle web
// (fora de node_modules) antes do guard, para não falhar por um README inofensivo.
function limparMd(dir) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules') continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) limparMd(p);
    else if (/\.md$/i.test(nome)) rmSync(p, { force: true });
  }
}
// (web/ agora vai como web.tar já limpo de .md antes do tar — nada a limpar aqui)

// GUARD (Fase 1): falha o build se algum arquivo que VAZA LÓGICA escapou para o
// pacote — nossos .md/.map/.d.ts, docs/, mockups/ ou CLAUDE.md. node_modules é
// ignorado (READMEs de libs públicas). Impede regressão em updates futuros.
function varrer(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules') continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) varrer(p, achados);
    else if (/\.map$|\.d\.ts$|\.md$/i.test(nome) || /^CLAUDE\.md$/i.test(nome) || /^update-priv\.pem$/i.test(nome) || /\.pfx$/i.test(nome)) achados.push(p);
  }
  return achados;
}
const vazou = varrer(out);
if (vazou.length) {
  console.error('\n✗ PROTEÇÃO: arquivos que vazam lógica entraram no pacote:');
  for (const f of vazou) console.error('   ' + f.replace(out, '.'));
  console.error('Ajuste o filtro em package.mjs (VAZA_LOGICA) antes de publicar.');
  process.exit(1);
}

console.log(`\nPronto: ${out}`);
console.log('Dependências já embutidas — a loja NÃO precisa de internet para as deps.');
console.log('Proteção: nenhum .md/.map/.d.ts nosso no pacote (sourcemaps/docs não vão para a loja).');
