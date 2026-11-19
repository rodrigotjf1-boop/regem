// Gera docs/verificacao-rapida.md a partir da "Verificação rápida" do registro interno de erros
// (ERROS-CONHECIDOS.md, que fica FORA do git). Só as regras vão para o repositório — os registros completos
// (sintoma, causa, dados do caso) continuam locais. O vigia de código na nuvem lê o arquivo gerado a cada PR.
//
// Uso (da raiz do repositório ou de qualquer worktree):
//   node backend/scripts/exportar-verificacao-rapida.mjs              → regrava docs/verificacao-rapida.md
//   node backend/scripts/exportar-verificacao-rapida.mjs --conferir   → não grava; sai 1 se o arquivo está atrás
//   node backend/scripts/exportar-verificacao-rapida.mjs --origem C:\caminho\ERROS-CONHECIDOS.md
//
// Recusa (sai 2, sem gravar) se a lista tiver algo que não pode ir a repositório: CPF, CNPJ, telefone, e-mail,
// IP que não seja o local, valor em reais, endereço do Supabase, chave/token, caminho de pasta de usuário.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const conferir = args.includes('--conferir');
const iOrigem = args.indexOf('--origem');

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' }).trim();
const raiz = git('rev-parse', '--show-toplevel');
// Numa worktree o registro não está (é ignorado pelo git): a cópia de trabalho principal é a pasta-mãe do
// diretório comum do git.
const principal = path.dirname(path.resolve(raiz, git('rev-parse', '--git-common-dir')));

const candidatos =
  iOrigem >= 0 ? [args[iOrigem + 1]] : [path.join(raiz, 'ERROS-CONHECIDOS.md'), path.join(principal, 'ERROS-CONHECIDOS.md')];
const origem = candidatos.find((c) => c && existsSync(c));
if (!origem) {
  console.error(`registro não encontrado (procurei em: ${candidatos.join(', ')}) — passe --origem <arquivo>`);
  process.exit(1);
}

const linhas = readFileSync(origem, 'utf8').replace(/\r\n/g, '\n').split('\n');
const inicio = linhas.findIndex((l) => /^## Verificação rápida/.test(l));
if (inicio < 0) {
  console.error('a seção "## Verificação rápida" não está no registro');
  process.exit(1);
}
const doRegistro = [];
for (let i = inicio + 1; i < linhas.length; i++) {
  const l = linhas[i];
  if (/^## /.test(l) || l.trim() === '---') break;
  if (l.startsWith('|')) doRegistro.push(l.trimEnd());
}
const numeroDa = (l) => Number(/^\| V(\d+) \|/.exec(l)[1]);
const cabecalho = doRegistro.filter((l) => !/^\| V\d+ \|/.test(l));
// No registro algumas regras foram acrescentadas fora de ordem (V26 antes da V22): o arquivo sai em ordem.
const regras = doRegistro.filter((l) => /^\| V\d+ \|/.test(l)).sort((a, b) => numeroDa(a) - numeroDa(b));
if (cabecalho.length !== 2 || !regras.length) {
  console.error('a tabela da verificação rápida veio sem o cabeçalho (2 linhas) ou sem regras V');
  process.exit(1);
}
// Todas de V1 a VN, sem buraco nem repetição: senão a tabela do registro está quebrada.
const fora = regras.findIndex((l, i) => numeroDa(l) !== i + 1);
if (fora >= 0) {
  console.error(`as regras não fecham de V1 a V${regras.length}: na posição ${fora + 1} veio V${numeroDa(regras[fora])}`);
  process.exit(1);
}
const tabela = [...cabecalho, ...regras];

// O que não pode ir a repositório (regra do dono de 14/10/2026: nada sensível em repositório, privado ou público).
const PROIBIDOS = [
  ['CPF', /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/],
  ['CNPJ', /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/],
  ['número longo (CPF/CNPJ/telefone sem pontuação)', /\b\d{11,14}\b/],
  ['telefone', /\(?\b\d{2}\)?\s?9?\d{4}-\d{4}\b/],
  ['e-mail', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/],
  ['IP', /\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/],
  ['valor em reais', /R\$\s?\d/],
  ['endereço do Supabase', /[a-z0-9]{20}\.supabase\.co/i],
  ['token JWT', /\beyJ[A-Za-z0-9_-]{10,}/],
  ['chave da Anthropic', /sk-ant-[A-Za-z0-9_-]+/],
  ['token do GitHub', /\b(ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{10,}/],
  ['token da Meta', /\bEAA[A-Za-z0-9]{20,}/],
  ['segredo em hexadecimal', /\b[0-9a-f]{32,}\b/i],
  ['pasta de usuário', /[A-Za-z]:\\Users\\/i],
];
const achados = [];
tabela.forEach((l, i) => {
  for (const [tipo, re] of PROIBIDOS) {
    const m = re.exec(l);
    if (m) achados.push(`linha ${i + 1} da tabela (${tipo}): …${l.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30)}…`);
  }
});
if (achados.length) {
  console.error('a lista tem o que não pode ir ao repositório — corrija no registro e rode de novo:');
  for (const a of achados) console.error('  ' + a);
  process.exit(2);
}

const texto = [
  '# Verificação rápida (antes de codar)',
  '',
  '> Regras preventivas do registro interno de erros do Regem. Cada uma nasceu de um erro que já aconteceu',
  '> (reproduzido ou medido); o `ERR-NNN` da última coluna aponta para o registro completo, que fica FORA do',
  '> repositório. Passe só pelas regras que tocam o que você vai mexer.',
  '>',
  '> **Arquivo gerado — não editar à mão.** A fonte é o registro local; para atualizar:',
  '> `node backend/scripts/exportar-verificacao-rapida.mjs` (o script recusa CPF, CNPJ, telefone, e-mail, IP, valor,',
  '> chave e caminho de usuário). Lido pelo vigia de código na nuvem a cada PR que entra na `main`.',
  '',
  `${regras.length} regras (V1–V${regras.length}).`,
  '',
  ...tabela,
  '',
].join('\n');

const destino = path.join(raiz, 'docs', 'verificacao-rapida.md');
const atual = existsSync(destino) ? readFileSync(destino, 'utf8').replace(/\r\n/g, '\n') : null;
if (conferir) {
  if (atual === texto) {
    console.log(`em dia: ${regras.length} regras`);
    process.exit(0);
  }
  console.error(`docs/verificacao-rapida.md está atrás do registro (${regras.length} regras lá) — rode sem --conferir`);
  process.exit(1);
}
if (atual === texto) {
  console.log(`nada mudou: ${regras.length} regras`);
} else {
  writeFileSync(destino, texto, 'utf8');
  console.log(`gravado docs/verificacao-rapida.md: ${regras.length} regras (fonte: ${origem})`);
}
