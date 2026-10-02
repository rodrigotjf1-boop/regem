// Confere as regras puras da fila do KDS (`src/lib/kds-fila.ts`): cor do tempo, etapas, soma por
// item e a decisão do teclado (forma de uso toque × teclado). O frontend não tem runner de testes:
// este script transpila os arquivos com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:kds
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-kds-'));
for (const nome of ['senha', 'kds-fila']) {
  const js = ts.transpileModule(readFileSync(join(raiz, `${nome}.ts`), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText.replace("'./senha'", "'./senha.mjs'");
  writeFileSync(join(tmp, `${nome}.mjs`), js);
}
const k = await import(pathToFileURL(join(tmp, 'kds-fila.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const AGORA = new Date('2026-10-02T12:00:00-03:00').getTime();
const ha = (min) => new Date(AGORA - min * 60000).toISOString();
const LIM = { verdeAteMin: 5, amareloAteMin: 10 };
const ped = (id, status, min, itens, extra = {}) => ({ id, status, criadoEm: ha(min), itens, ...extra });
const it = (quantidade, descricao, extra = {}) => ({ quantidade, descricao, ...extra });

// Luminância relativa e contraste (WCAG) — para garantir que o texto de cada cor se lê.
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

try {
  caso('cor do tempo: verde até o 1º limite, amarelo até o 2º, vermelho depois', () => {
    assert.equal(k.faixaTempo(0, LIM), 'ok');
    assert.equal(k.faixaTempo(5, LIM), 'ok');
    assert.equal(k.faixaTempo(6, LIM), 'atencao');
    assert.equal(k.faixaTempo(10, LIM), 'atencao');
    assert.equal(k.faixaTempo(11, LIM), 'atrasado');
  });

  caso('só três cores de status (mais o cinza do cancelado), todas com texto legível', () => {
    assert.deepEqual(Object.keys(k.COR_STATUS).sort(), ['atencao', 'atrasado', 'cancelado', 'ok']);
    for (const [nome, c] of Object.entries(k.COR_STATUS)) {
      assert.match(c.fundo, /^#[0-9A-F]{6}$/, `${nome}: fundo`);
      assert.ok(contraste(c.fundo, c.texto) >= 4.5, `${nome}: contraste ${contraste(c.fundo, c.texto).toFixed(2)} abaixo de 4,5`);
    }
    assert.equal(k.corDoPedido({ status: 'cancelado' }, 30, LIM), k.COR_STATUS.cancelado, 'cancelado é cinza mesmo velho');
    assert.equal(k.corDoPedido({ status: 'preparo' }, 30, LIM), k.COR_STATUS.atrasado);
  });

  caso('atrasado: passou do preparo do pedido OU entrou no vermelho; cancelado nunca', () => {
    assert.equal(k.estaAtrasado({ status: 'preparo', tempoPreparoMin: 8 }, 9, LIM), true, 'passou do preparo, ainda no amarelo');
    assert.equal(k.estaAtrasado({ status: 'preparo', tempoPreparoMin: 20 }, 9, LIM), false);
    assert.equal(k.estaAtrasado({ status: 'preparo' }, 11, LIM), true, 'sem tempo de preparo: vale o vermelho');
    assert.equal(k.estaAtrasado({ status: 'cancelado', tempoPreparoMin: 1 }, 60, LIM), false);
  });

  caso('minutos nunca ficam negativos (relógio do aparelho atrasado)', () => {
    assert.equal(k.minutosDesde(new Date(AGORA + 90000).toISOString(), AGORA), 0);
    assert.equal(k.minutosDesde(ha(7), AGORA), 7);
  });

  const FILA = [
    ped('a', 'preparo', 12, [it(2, 'X-Burger', { complementosTexto: 'sem cebola' }), it(1, 'Batata')], { senha: 41 }),
    ped('b', 'preparo', 7, [it(3, 'X-Burger'), it(2, 'Batata')], { senha: 12, senhaPrefixo: 'D' }),
    ped('c', 'recebido', 2, [it(1, 'X-Burger'), it(1, 'X-Burger')], { mesa: '7' }),
    ped('d', 'pronto', 14, [it(5, 'X-Burger')], { numero: 99 }),
    ped('e', 'cancelado', 5, [it(9, 'Batata')]),
  ];

  caso('contadores das etapas batem com o filtro', () => {
    const n2 = k.contarEtapas(FILA, AGORA, LIM);
    assert.deepEqual(n2, { todos: 5, recebido: 1, preparo: 2, pronto: 1, atrasados: 2 });
    for (const f of k.FILTROS_ETAPA) assert.equal(k.filtrarEtapa(FILA, f.key, AGORA, LIM).length, n2[f.key], f.key);
    assert.ok(!k.filtrarEtapa(FILA, 'preparo', AGORA, LIM).some((p) => p.status === 'cancelado'));
  });

  caso('rótulos em português', () => {
    assert.equal(k.rotuloEtapa('recebido'), 'A iniciar');
    assert.equal(k.rotuloEtapa('preparo'), 'Em preparo');
    assert.equal(k.proximaAcao('recebido'), 'Iniciar');
    assert.equal(k.proximaAcao('preparo'), 'Pronto');
    assert.equal(k.proximaAcao('pronto'), 'Entregar');
    assert.equal(k.identPedido(FILA[0]), 'Senha 41');
    assert.equal(k.identPedido(FILA[1]), 'Senha D-12');
    assert.equal(k.identPedido(FILA[2]), 'Mesa 7');
    assert.equal(k.identPedido(FILA[3]), '#99');
    assert.equal(k.identPedido({}), 'Balcão');
  });

  caso('por item: soma o que falta produzir, fora cancelado e pronto', () => {
    const g = k.agruparPorItem(FILA, AGORA);
    assert.deepEqual(g.map((x) => [x.descricao, x.quantidade]), [['X-Burger', 7], ['Batata', 3]]);
    assert.equal(g[0].minMaisAntigo, 12, 'a cor do item é a do pedido mais antigo');
    assert.deepEqual(g[0].linhas.map((l) => [l.pedido.id, l.item.quantidade, l.min]), [['a', 2, 12], ['b', 3, 7], ['c', 2, 2]], 'pedidos do mais antigo para o mais novo; iguais dentro do pedido somam');
    assert.equal(g[0].linhas[0].item.complementosTexto, 'sem cebola', 'o complemento fica na linha do pedido');
  });

  caso('por item: o mais antigo vem primeiro; empate decide a quantidade', () => {
    const g = k.agruparPorItem([ped('n', 'recebido', 1, [it(9, 'Suco')]), ped('v', 'preparo', 20, [it(1, 'Pudim')]), ped('w', 'preparo', 20, [it(4, 'Filé')])], AGORA);
    assert.deepEqual(g.map((x) => x.descricao), ['Filé', 'Pudim', 'Suco']);
  });

  caso('resumo: mesma soma, da maior quantidade para a menor, contando pedidos', () => {
    assert.deepEqual(k.somarItens(FILA), [
      { descricao: 'X-Burger', quantidade: 7, pedidos: 3 },
      { descricao: 'Batata', quantidade: 3, pedidos: 2 },
    ]);
    assert.deepEqual(k.somarItens([]), []);
    assert.equal(k.pedidoTemItem(FILA[0], 'Batata'), true);
    assert.equal(k.pedidoTemItem(FILA[3], 'X-Burger'), false, 'pedido pronto não se destaca');
    assert.equal(k.pedidoTemItem(FILA[4], 'Batata'), false, 'cancelado não se destaca');
  });

  caso('agregar itens iguais dentro do pedido', () => {
    const r = k.agregarItens([it('1', 'A'), it(2, 'A'), it(1, 'A', { observacao: 'sem sal' })]);
    assert.deepEqual(r.map((x) => [x.descricao, x.quantidade, x.observacao ?? '']), [['A', 3, ''], ['A', 1, 'sem sal']]);
  });

  const fora = { tag: 'BODY', ehCampoSenha: false };
  const botao = { tag: 'BUTTON', ehCampoSenha: false };
  const select = { tag: 'SELECT', ehCampoSenha: false };
  const campo = { tag: 'INPUT', ehCampoSenha: true };
  const outroCampo = { tag: 'INPUT', ehCampoSenha: false };

  caso('teclado: número e Enter fora do campo são sempre da senha (e a tecla é tomada)', () => {
    for (const alvo of [fora, botao, select]) {
      assert.deepEqual(k.decidirTecla('teclado', '7', alvo), { acao: 'digito', tomar: true }, alvo.tag);
      assert.deepEqual(k.decidirTecla('teclado', 'Enter', alvo), { acao: 'enter', tomar: true }, `${alvo.tag}: Enter não aciona o botão`);
      assert.deepEqual(k.decidirTecla('teclado', 'Backspace', alvo), { acao: 'apagar', tomar: true }, alvo.tag);
    }
    assert.equal(k.decidirTecla('teclado', 'Tab', botao).acao, 'ignorar', 'Tab continua navegando');
    assert.equal(k.decidirTecla('teclado', ' ', botao).acao, 'ignorar', 'Espaço continua acionando o botão');
    assert.equal(k.decidirTecla('teclado', 'ArrowDown', select).acao, 'ignorar', 'setas do seletor continuam');
  });

  caso('toque: nada depende do foco — Enter num botão é do botão', () => {
    assert.equal(k.decidirTecla('toque', 'Enter', botao).acao, 'ignorar');
    assert.equal(k.decidirTecla('toque', '7', select).acao, 'ignorar');
    assert.deepEqual(k.decidirTecla('toque', '7', fora), { acao: 'digito', tomar: false }, 'número solto ainda cai na senha, como sempre foi');
    assert.deepEqual(k.decidirTecla('toque', 'Enter', fora), { acao: 'enter', tomar: false });
  });

  caso('nos dois modos: o campo da senha e os outros campos tratam a própria tecla', () => {
    for (const uso of ['toque', 'teclado']) {
      assert.equal(k.decidirTecla(uso, '7', campo).acao, 'ignorar');
      assert.equal(k.decidirTecla(uso, 'Enter', campo).acao, 'ignorar');
      assert.equal(k.decidirTecla(uso, '7', outroCampo).acao, 'ignorar');
    }
  });

  caso('forma de uso: a escolha vale; sem escolha, adivinha pelo aparelho', () => {
    assert.equal(k.formaDeUso('toque', false), 'toque');
    assert.equal(k.formaDeUso('teclado', true), 'teclado');
    assert.equal(k.formaDeUso('', true), 'toque');
    assert.equal(k.formaDeUso(null, false), 'teclado');
    assert.equal(k.formaDeUso('qualquer', false), 'teclado');
  });

  console.log(`\ncheck:kds — ${n} casos, tudo certo`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
