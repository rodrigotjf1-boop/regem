// Monta a pasta distribuível do Regem Edge (para copiar ao PC da loja).
// Uso (na pasta backend/): npm run build && node edge/package.mjs
// Saída: ../regem-edge-dist/  → copie para o PC da loja e siga edge/INSTALL-WINDOWS.md
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

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
const semBundle = (s) =>
  !/[\\/](bundle|node_modules|Output)([\\/]|$)/.test(s) && !VAZA_LOGICA.test(s);

const copiar = (rel) => {
  const src = join(raiz, rel);
  if (!existsSync(src)) { console.warn(`  (pulando, não existe) ${rel}`); return; }
  cpSync(src, join(out, rel), { recursive: true, filter: semBundle });
  console.log(`  + ${rel}`);
};

console.log('Montando regem-edge-dist/…');
copiar('dist');                 // backend compilado (rode `npm run build` antes)
copiar('package.json');
copiar('package-lock.json');
copiar('edge');                 // daemon, gen-cert, scripts de serviço, .env.example
copiar('scripts');              // apply-all-local.mjs, etc.
copiar('drizzle.config.ts');
// migrations ficam em database/migrations (fora de backend/) → copiamos também
cpSync(join(raiz, '..', 'database', 'migrations'), join(out, 'database', 'migrations'), { recursive: true });
console.log('  + database/migrations');

// App (frontend) em modo edge -> web/ (Next standalone autossuficiente). O
// edge-web.mjs sobe esse Next em HTTP no localhost e serve por HTTPS na LAN.
if (!process.env.SKIP_WEB_BUILD) {
  console.log('  + web (build do app em modo edge)…');
  execSync('node edge/build-web.mjs', { cwd: raiz, stdio: 'inherit' });
}
const saDir = join(raiz, '..', 'frontend', '.next', 'standalone');
if (existsSync(join(saDir, 'server.js'))) {
  cpSync(saDir, join(out, 'web'), { recursive: true }); // inclui .next (oculto) e node_modules
  console.log('  + web');
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
const webDir = join(out, 'web');
if (existsSync(webDir)) limparMd(webDir);

// GUARD (Fase 1): falha o build se algum arquivo que VAZA LÓGICA escapou para o
// pacote — nossos .md/.map/.d.ts, docs/, mockups/ ou CLAUDE.md. node_modules é
// ignorado (READMEs de libs públicas). Impede regressão em updates futuros.
function varrer(dir, achados = []) {
  for (const nome of readdirSync(dir)) {
    if (nome === 'node_modules') continue;
    const p = join(dir, nome);
    const st = statSync(p);
    if (st.isDirectory()) varrer(p, achados);
    else if (/\.map$|\.d\.ts$|\.md$/i.test(nome) || /^CLAUDE\.md$/i.test(nome)) achados.push(p);
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
