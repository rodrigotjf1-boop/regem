// Monta a pasta distribuível do Regem Edge (para copiar ao PC da loja).
// Uso (na pasta backend/): npm run build && node edge/package.mjs
// Saída: ../regem-edge-dist/  → copie para o PC da loja e siga edge/INSTALL-WINDOWS.md
import { cpSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';

const raiz = process.cwd(); // backend/
const out = join(raiz, '..', 'regem-edge-dist');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Nunca empacotar os binários portáteis do instalador (edge/bundle) nem node_modules:
// o instalador (.iss) já os inclui à parte; empacotá-los aqui incharia a dist (~250MB).
const semBundle = (s) => !/[\\/](bundle|node_modules)([\\/]|$)/.test(s);

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

console.log(`\nPronto: ${out}`);
console.log('No PC da loja: npm ci --omit=dev  →  configure backend/.env.local  →  siga edge/INSTALL-WINDOWS.md');
