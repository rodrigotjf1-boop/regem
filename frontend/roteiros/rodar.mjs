// Roda os roteiros de tela (ver README.md). Dentro de frontend/:
//   npm run build                                   (depois de mexer na tela: os roteiros usam o app BUILDADO)
//   npm run roteiros                                → todos
//   npm run roteiros -- kds tv                      → só esses
//   npm run roteiros -- --rapido                    → 5 larguras em vez de 16
//   npm run roteiros -- --tudo                      → mostra também cada conferência que passou
//   npm run roteiros -- --base=http://localhost:3000  → contra um app que já está no ar (não sobe outro)
// Sobe o `next start` numa porta livre, roda, para o servidor e diz o resultado; código 1 se algo falhou.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LARGURAS, LARGURAS_RAPIDO, abrirNavegador, criarConferencia } from './comum.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const front = join(aqui, '..');
const ROTEIROS = ['kds', 'tv', 'alertas', 'rota-cozinha', 'caixa-turno', 'mister', 'mister-console'];

const args = process.argv.slice(2);
const opcao = (n) => args.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const tem = (n) => args.includes(`--${n}`);
const pedidos = args.filter((a) => !a.startsWith('--'));
const desconhecidos = pedidos.filter((n) => !ROTEIROS.includes(n));
if (desconhecidos.length) {
  console.error(`Roteiro desconhecido: ${desconhecidos.join(', ')}. Existem: ${ROTEIROS.join(', ')}.`);
  process.exit(2);
}
const escolhidos = pedidos.length ? pedidos : ROTEIROS;
const rapido = tem('rapido');

const linhas = [];
const escrever = (linha, falhou) => {
  linhas.push(linha);
  if (falhou || tem('tudo')) console.log(linha);
};

function portaLivre() {
  return new Promise((ok, erro) => {
    const s = createServer();
    s.once('error', erro);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => ok(port));
    });
  });
}

async function esperarNoAr(base, ms) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    try {
      const r = await fetch(base + '/kds', { redirect: 'manual' });
      if (r.status < 500) return true;
    } catch {
      /* ainda subindo */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function pararServidor(filho) {
  if (!filho || filho.exitCode !== null) return;
  // No Windows o `next start` pode abrir processos filhos: derruba a árvore inteira.
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
  else filho.kill('SIGTERM');
}

let base = opcao('base');
let servidor = null;
let saidaDoServidor = '';
if (!base) {
  if (!existsSync(join(front, '.next', 'BUILD_ID'))) {
    console.error('Falta o build do app: rode "npm run build" em frontend/ antes (os roteiros usam o app buildado).');
    process.exit(2);
  }
  const porta = Number(opcao('porta')) || (await portaLivre());
  const next = createRequire(join(front, 'package.json')).resolve('next/dist/bin/next');
  servidor = spawn(process.execPath, [next, 'start', '-p', String(porta)], {
    cwd: front,
    env: { ...process.env, PORT: String(porta) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout.on('data', (d) => (saidaDoServidor += d));
  servidor.stderr.on('data', (d) => (saidaDoServidor += d));
  base = `http://localhost:${porta}`;
  if (!(await esperarNoAr(base, 90_000))) {
    pararServidor(servidor);
    console.error(`O app não subiu em 90 s.\n${saidaDoServidor.slice(-2000)}`);
    process.exit(2);
  }
}

const fotos = join(aqui, 'fotos');
mkdirSync(fotos, { recursive: true });
const resultado = [];
let nav = null;
try {
  nav = await abrirNavegador();
  for (const nome of escolhidos) {
    const conf = criarConferencia(nome, escrever);
    const inicio = Date.now();
    let parou = null;
    try {
      const { default: roteiro } = await import(`./${nome}.mjs`);
      await roteiro({
        nav,
        base,
        ok: conf.ok,
        foto: (arquivo) => join(fotos, `${nome}-${arquivo}`),
        larguras: rapido ? LARGURAS_RAPIDO : LARGURAS,
        rapido,
        escrever,
      });
    } catch (e) {
      // Um seletor que sumiu ou um tempo de espera estourado: o roteiro para aqui e diz onde.
      parou = String(e?.stack ?? e).split('\n').slice(0, 4).join('\n');
      escrever(`FALHA [${nome}] o roteiro parou: ${parou}`, true);
    }
    resultado.push({ nome, conferencias: conf.total, falhas: conf.falhas.length + (parou ? 1 : 0), segundos: Math.round((Date.now() - inicio) / 1000) });
  }
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exitCode = 2;
} finally {
  await nav?.close().catch(() => {});
  pararServidor(servidor);
}

writeFileSync(join(aqui, 'ultimo-resultado.txt'), linhas.join('\n') + '\n');
if (resultado.length) {
  console.log('\nRoteiro         Conferências  Falhas  Tempo');
  for (const r of resultado)
    console.log(`${r.nome.padEnd(16)}${String(r.conferencias).padStart(12)}${String(r.falhas).padStart(8)}${String(r.segundos).padStart(6)} s`);
  const falhas = resultado.reduce((s, r) => s + r.falhas, 0);
  console.log(
    `\n${falhas ? `FALHAS: ${falhas} (tudo em roteiros/ultimo-resultado.txt; fotos em roteiros/fotos)` : 'TUDO CERTO'}${rapido ? ' — modo rápido (5 larguras)' : ''}`,
  );
  if (falhas) process.exitCode = 1;
}
