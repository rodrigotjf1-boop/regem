// Monta a pasta distribuível do Regem Edge (para copiar ao PC da loja).
// Uso (na pasta backend/): npm run build && node edge/package.mjs
// Saída: ../regem-edge-dist/  → copie para o PC da loja e siga edge/INSTALL-WINDOWS.md
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
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
const semBundle = (s) => !/[\\/](bundle|node_modules|Output)([\\/]|$)/.test(s);

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

// Dependências de produção EMBUTIDAS → instalação 100% offline (sem npm ci na loja).
// bcryptjs e pg são JS puro (sem binários nativos), então o node_modules é portável
// entre máquinas Windows x64 e casa com o Node embutido no instalador.
console.log('  + node_modules (npm ci --omit=dev — baixa as deps uma vez, aqui)…');
execSync('npm ci --omit=dev --no-audit --no-fund', { cwd: out, stdio: 'inherit' });
console.log('  + node_modules (embutido)');

console.log(`\nPronto: ${out}`);
console.log('Dependências já embutidas — a loja NÃO precisa de internet para as deps.');
console.log('No PC da loja: siga edge/INSTALL-WINDOWS.md (o .exe faz tudo).');
