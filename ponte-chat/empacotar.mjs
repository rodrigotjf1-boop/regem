// Empacota a ponte do chat para o INSTALADOR do Regem (15/11/2026, pedido do dono: "quando for escolhida a opção servidor,
// já instalar a ponte"; depois: "perguntar, depois de escolher entre servidor e PDV, se deseja instalar a ponte").
//
// Sem dependência nova: o próprio Electron que a ponte já usa (node_modules/electron/dist) com o programa dentro de
// `resources/app` — o jeito que o Electron procura o app empacotado. O executável vira "Regem Ponte do chat.exe": é o
// nome que o ícone "Regem neste PC" reconhece (`RegemEstacao.cs`, classe Ponte) e o que o `app.isPackaged` trata como
// programa instalado. Saída: <repo>/regem-ponte-dist/ — FORA do regem-edge-dist, que também vira o .zip de atualização
// (a ponte tem ~250 MB e só vai no .exe, e só quando a pessoa escolhe instalá-la).
//
// Uso (na raiz do repositório): node ponte-chat/empacotar.mjs   — antes, `npm ci` em ponte-chat (traz o pacote do
// Electron; o binário, este script baixa se faltar — ERR-478).
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PONTE = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(PONTE, '..', 'regem-ponte-dist');
export const EXE = 'Regem Ponte do chat.exe';

function falhar(m) {
  console.error(`ponte: ${m}`);
  process.exit(1);
}

const electron = join(PONTE, 'node_modules', 'electron', 'dist');
const instalador = join(PONTE, 'node_modules', 'electron', 'install.js');
if (!existsSync(instalador)) falhar(`falta o pacote do Electron — rode "npm ci" dentro de ponte-chat.`);
// ERR-478: o Electron 45 não baixa mais o binário no `npm install` (o pacote não tem `postinstall`; baixa na 1ª vez que
// roda). Num worktree novo, o `npm ci` deixava o pacote sem o `dist` e o build da release parava aqui. Baixa pelo
// instalador do próprio pacote (a versão travada no package-lock, com a conferência de checksums dele; usa o cache).
if (!existsSync(join(electron, 'electron.exe'))) {
  console.log('ponte: baixando o binário do Electron (node_modules/electron/install.js)…');
  const r = spawnSync(process.execPath, [instalador], { cwd: join(PONTE, 'node_modules', 'electron'), stdio: 'inherit' });
  if (r.status !== 0 || !existsSync(join(electron, 'electron.exe'))) falhar(`o download do Electron falhou (saída ${r.status}) — sem internet? Confira e rode de novo.`);
}
const pkg = JSON.parse(readFileSync(join(PONTE, 'package.json'), 'utf8'));

rmSync(SAIDA, { recursive: true, force: true });
mkdirSync(SAIDA, { recursive: true });
// 1) O Electron inteiro (o runtime, as DLLs, os idiomas, as licenças).
cpSync(electron, SAIDA, { recursive: true });
renameSync(join(SAIDA, 'electron.exe'), join(SAIDA, EXE));
// O app de exemplo do Electron sai: com `resources/app` ele nem seria lido, mas não precisa ir junto.
rmSync(join(SAIDA, 'resources', 'default_app.asar'), { force: true });
// Os idiomas do Chromium: só o português do Brasil e o inglês (o reserva quando falta o do Windows) — os outros 53 são
// ~47 MB que a ponte não usa (as telas dela são do próprio programa, em português). É o que o `electronLanguages` do
// electron-builder faz.
const IDIOMAS = new Set(['pt-BR.pak', 'en-US.pak']);
for (const f of readdirSync(join(SAIDA, 'locales'))) if (!IDIOMAS.has(f)) rmSync(join(SAIDA, 'locales', f), { force: true });
// 2) O programa da ponte em resources/app: o package.json (sem os scripts e as dependências de desenvolvimento — a ponte
// não tem dependência de execução), o código e os ícones. Os testes e o node_modules ficam de fora.
const app = join(SAIDA, 'resources', 'app');
mkdirSync(app, { recursive: true });
const { scripts: _s, devDependencies: _d, ...pkgDoApp } = pkg;
writeFileSync(join(app, 'package.json'), JSON.stringify(pkgDoApp, null, 2) + '\n');
cpSync(join(PONTE, 'src'), join(app, 'src'), { recursive: true });
cpSync(join(PONTE, 'assets'), join(app, 'assets'), { recursive: true });
// 3) A versão, para o preflight e para quem abrir a pasta.
writeFileSync(join(SAIDA, 'versao-da-ponte.txt'), `${pkg.version}\n`);

for (const rel of [EXE, join('locales', 'pt-BR.pak'), join('locales', 'en-US.pak'), join('resources', 'app', 'package.json'), join('resources', 'app', 'src', 'main.js'), join('resources', 'app', 'assets', 'regem.ico')])
  if (!existsSync(join(SAIDA, rel))) falhar(`o pacote saiu sem ${rel}.`);
console.log(`ponte ${pkg.version} empacotada em ${SAIDA} (${EXE})`);
