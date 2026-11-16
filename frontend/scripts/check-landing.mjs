// A landing pública (`src/app/page.tsx`) só promete o que o produto faz (decisões do dono de 12/11/2026 para a landing):
//  1. os planos são os do catálogo do servidor — `backend/src/modules/licenca/planos.ts`, o da página de assinatura —,
//     copiados em `src/lib/planos-da-landing.ts` porque a rota `/planos` pede login: nome, descrição, módulos, preço
//     mensal e destaque têm de ser os mesmos dos dois lados;
//  2. nenhuma das promessas que a página fazia sem o produto ter: número de lojas e de resultados que nunca medimos,
//     o Metas L.T.D.A, white-label, relatório por e-mail, vistoria assinada, o ranking do colaborador e os preços
//     antigos; o TEF só com "em breve";
//  3. a página não escreve preço à mão (lê a lista).
// Uso: npm run check:landing
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-landing-'));
const carregar = async (origem, nome) => {
  writeFileSync(
    join(tmp, nome),
    ts.transpileModule(readFileSync(origem, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  );
  return import(pathToFileURL(join(tmp, nome)).href);
};

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  const { PLANOS } = await carregar(join(aqui, '..', '..', 'backend', 'src', 'modules', 'licenca', 'planos.ts'), 'planos-servidor.mjs');
  const { PLANOS_DA_LANDING } = await carregar(join(aqui, '..', 'src', 'lib', 'planos-da-landing.ts'), 'planos-landing.mjs');
  const doServidor = PLANOS.map((p) => ({ chave: p.chave, nome: p.nome, desc: p.desc, modulos: p.modulos, mensal: p.mensal, destaque: !!p.destaque }));
  const daLanding = PLANOS_DA_LANDING.map((p) => ({ chave: p.chave, nome: p.nome, desc: p.desc, modulos: p.modulos, mensal: p.mensal, destaque: !!p.destaque }));

  caso('os planos da landing são os do catálogo do servidor (nome, descrição, módulos, preço mensal, destaque)', () => {
    assert.deepEqual(daLanding, doServidor);
  });

  const pagina = readFileSync(join(aqui, '..', 'src', 'app', 'page.tsx'), 'utf8');
  // Só o que a pessoa lê: tira os comentários (que explicam o que saiu e por quê).
  const texto = pagina.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

  const PROIBIDAS = [
    [/lojas operando/i, 'número de lojas'],
    [/120\+/, '"120+"'],
    [/desperdício evitado/i, 'resultado que não medimos'],
    [/tarefas concluídas \/ mês/i, 'número de tarefas'],
    [/4,8★|avaliação dos gerentes/i, 'avaliação que não existe'],
    [/Metas L\.T\.D\.A/i, 'Metas L.T.D.A'],
    [/white-label/i, 'white-label'],
    [/agendados por e-mail/i, 'relatório por e-mail'],
    [/vistorias assinadas/i, 'vistoria assinada'],
    [/meu ranking/i, 'ranking do colaborador'],
    // O destaque do plano é uma recomendação nossa: "mais escolhido" e "mais popular" são números que não temos.
    [/mais escolhido|mais popular/i, 'plano "mais escolhido" (não medimos; é "recomendado")'],
    // Preço de plano escrito à mão (a página lê `PLANOS_DA_LANDING`). O "R$ 142" do painel de demonstração do topo é
    // tela simulada, não preço: a regra pega só o valor dentro do cartão do plano ou seguido de "/mês".
    [/className="price">\s*R\$|R\$\s*\d+\s*<small>\/mês|Sob consulta/, 'preço de plano escrito à mão'],
  ];
  caso('a página não traz nenhuma das promessas que o produto não cumpre', () => {
    const achadas = PROIBIDAS.filter(([re]) => re.test(texto)).map(([, o]) => o);
    assert.deepEqual(achadas, []);
  });

  caso('o TEF aparece só com "em breve"', () => {
    const cartao = texto.match(/<h3>TEF[^]*?<\/h3>/)?.[0] ?? '';
    assert.ok(cartao, 'cartão do TEF não encontrado');
    assert.match(cartao, /em breve/i);
  });

  caso('os preços da página saem da lista (PLANOS_DA_LANDING)', () => {
    assert.match(pagina, /import \{ PLANOS_DA_LANDING \} from '@\/lib\/planos-da-landing'/);
    assert.match(texto, /PLANOS_DA_LANDING\.map\(/);
  });

  console.log(`check:landing — ${n} casos ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
