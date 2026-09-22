// Compila o app (frontend) em modo EDGE e o deixa pronto para empacotar.
// Uso (na pasta backend/):  node edge/build-web.mjs
//
// - Build standalone do Next com env de edge (a API e descoberta pela origem em
//   runtime; ver frontend/src/lib/api.ts). Cada loja tem IP proprio, por isso a
//   URL da API NAO e chumbada.
// - O standalone do Next nao inclui os estaticos nem o public/: copiamos para
//   dentro (.next/standalone/.next/static e .next/standalone/public), deixando a
//   pasta 100% autossuficiente para o package.mjs levar como web/.
import { execSync } from 'child_process';
import { cpSync, existsSync } from 'fs';
import { join } from 'path';

const backend = process.cwd(); // .../backend
const front = join(backend, '..', 'frontend');
if (!existsSync(front)) throw new Error('pasta frontend/ nao encontrada ao lado de backend/');

const env = {
  ...process.env,
  NEXT_PUBLIC_EDGE: '1', // liga a descoberta da API pela origem
  NEXT_PUBLIC_API_URL: '', // sem URL chumbada (edge)
  // Porta da API no edge. ⚠️ Fica CHUMBADA no app: o navegador dos aparelhos vai chamar
  // exatamente esta. Mudar aqui obriga a instalar com o mesmo valor — o instalar-tudo.ps1
  // recusa qualquer -Porta diferente ($PORTA_API_DO_APP) justamente por causa disto.
  NEXT_PUBLIC_EDGE_API_PORT: '3002',
};

if (!existsSync(join(front, 'node_modules', 'next'))) {
  console.log('frontend sem node_modules — rodando npm ci...');
  execSync('npm ci', { cwd: front, stdio: 'inherit' });
}

console.log('Compilando o app (frontend) em modo edge...');
execSync('npm run build', { cwd: front, stdio: 'inherit', env });

const sa = join(front, '.next', 'standalone');
if (!existsSync(join(sa, 'server.js'))) {
  throw new Error('build standalone nao gerou server.js — confira output:"standalone" no next.config.');
}
// estaticos + public para dentro do standalone
cpSync(join(front, '.next', 'static'), join(sa, '.next', 'static'), { recursive: true });
cpSync(join(front, 'public'), join(sa, 'public'), { recursive: true });
console.log('App (edge) pronto em', sa);
