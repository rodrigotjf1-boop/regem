// Confere o catálogo dos eventos sazonais do cardápio (`components/loja/eventos/catalogo.ts`): os
// textos padrão, a contagem da faixa e as frases — tudo puro, sem React. O frontend não tem runner
// de testes: este script transpila o arquivo com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:eventos
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const origem = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'components', 'loja', 'eventos', 'catalogo.ts');
const tmp = mkdtempSync(join(tmpdir(), 'check-eventos-'));
writeFileSync(
  join(tmp, 'catalogo.mjs'),
  ts.transpileModule(readFileSync(origem, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText,
);
const { EVENTOS, contagemAoVivo, contagemDoEvento, contagemDoJogo, hojeEmBrasilia, textosDaFaixa } = await import(pathToFileURL(join(tmp, 'catalogo.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
// Meio-dia de Brasília do dia pedido.
const em = (dia, hora = '12:00') => new Date(`${dia}T${hora}:00-03:00`);
const ev = (chave, p = {}) => ({ chave, inicio: '2026-12-01', fim: '2026-12-25', dia: '2026-12-25', titulo: null, texto: null, colecao: [], cores: true, animacoes: true, partida: null, cupomJogo: null, previa: false, ...p });
const CHAVES = ['reveillon', 'carnaval', 'pascoa', 'maes', 'hamburguer', 'namorados', 'junina', 'pais', 'criancas', 'halloween', 'blackfriday', 'natal', 'jogo'];

try {
  caso('os 13 eventos têm tudo o que a tela usa', () => {
    assert.deepEqual(Object.keys(EVENTOS).sort(), [...CHAVES].sort());
    for (const k of CHAVES) {
      const e = EVENTOS[k];
      assert.match(e.acc, /^#[0-9A-F]{6}$/i, `${k}: cor`);
      assert.ok(e.nome && e.faixa.t && e.faixa.s && e.colecao, `${k}: textos`);
      assert.equal(e.ok.length, 2, `${k}: confirmação`);
      assert.ok(e.particulas.length && e.estouro.length && e.paleta.length, `${k}: partículas`);
      assert.ok(e.particulas.reduce((s, [, q]) => s + q, 0) <= 50, `${k}: no máximo 50 partículas de fundo`);
      assert.ok(['canto', 'topo', 'bigode'].includes(e.posicao) && e.acessorio && e.corredor && e.topo, `${k}: peças`);
      assert.match(e.naSacola('TRIO 07'), /TRIO 07/, `${k}: o aviso cita o item`);
    }
  });

  caso('textos padrão servem para qualquer loja e para entrega, retirada e mesa', () => {
    for (const k of CHAVES) {
      const e = EVENTOS[k];
      const tudo = [e.faixa.t, e.faixa.s, e.faixaComJogo?.t, e.faixaComJogo?.s, e.colecao, e.naSacola('X'), ...e.ok].filter(Boolean).join(' | ');
      assert.doesNotMatch(tudo, /mister/i, `${k}: nome de loja no texto padrão`);
      assert.doesNotMatch(tudo, /chega já|a caminho|receba|na sua casa|entrega/i, `${k}: promessa de entrega no texto padrão`);
      assert.doesNotMatch(tudo, /\d{1,2}\/12|\bàs \d/i, `${k}: data ou horário prometido no texto padrão`);
    }
  });

  caso('só Páscoa e Halloween têm mini-jogo, com o convite só quando há cupom', () => {
    assert.deepEqual(CHAVES.filter((k) => EVENTOS[k].jogo), ['pascoa', 'halloween']);
    assert.equal(textosDaFaixa(ev('halloween'), 0).texto, 'As gostosuras da casa estão te esperando.');
    assert.equal(textosDaFaixa(ev('halloween', { cupomJogo: 'DOCES10' }), 0).texto, 'Toque na abóbora e descubra o que te espera.');
    assert.equal(textosDaFaixa(ev('pascoa'), 0).titulo, 'Páscoa na mesa');
    assert.equal(textosDaFaixa(ev('pascoa', { cupomJogo: 'PASCOA10' }), 0).titulo, 'Caça aos ovos');
  });

  caso('o que o presidente escreveu substitui o padrão', () => {
    const t = textosDaFaixa(ev('natal', { titulo: 'Natal do Mister', texto: 'Encomende até 23/12.' }), 0);
    assert.deepEqual(t, { rotulo: 'Natal', titulo: 'Natal do Mister', texto: 'Encomende até 23/12.' });
    assert.equal(textosDaFaixa(ev('natal'), 0).titulo, 'Natal é aqui');
  });

  caso('Black Friday: cita o maior desconto real e o último dia', () => {
    const bf = ev('blackfriday', { inicio: '2026-11-23', fim: '2026-11-29', dia: '2026-11-27' }); // termina no domingo
    assert.equal(textosDaFaixa(bf, 20).texto, 'Ofertas com até 20% off. Só até domingo.');
    assert.equal(textosDaFaixa(bf, 0).texto, 'As ofertas da semana estão aqui. Só até domingo.');
    assert.equal(textosDaFaixa({ ...bf, fim: '2026-11-30' }, 20).texto, 'Ofertas com até 20% off. Só até 30/11.');
  });

  caso('contagem: dias até o dia do evento, pelo dia de Brasília', () => {
    assert.equal(hojeEmBrasilia(new Date('2026-12-01T02:30:00Z')), '2026-11-30');
    assert.equal(contagemDoEvento(ev('natal'), em('2026-12-10')), 'Faltam 15 dias para o Natal');
    assert.equal(contagemDoEvento(ev('natal'), em('2026-12-24')), 'Falta 1 dia para o Natal');
    assert.equal(contagemDoEvento(ev('natal'), em('2026-12-25')), 'Feliz Natal!');
    assert.equal(contagemDoEvento(ev('reveillon', { inicio: '2026-12-26', fim: '2027-01-01', dia: '2027-01-01' }), em('2026-12-30')), 'Faltam 2 dias para 2027');
    assert.equal(contagemDoEvento(ev('reveillon', { inicio: '2026-12-26', fim: '2027-01-01', dia: '2027-01-01' }), em('2027-01-01')), 'Feliz 2027!');
    const maes = ev('maes', { inicio: '2026-05-03', fim: '2026-05-10', dia: '2026-05-10' });
    assert.equal(contagemDoEvento(maes, em('2026-05-05')), 'Faltam 5 dias');
    assert.equal(contagemDoEvento(maes, em('2026-05-09')), 'É amanhã!');
    assert.equal(contagemDoEvento(maes, em('2026-05-10')), 'É hoje!');
    assert.equal(contagemDoEvento(ev('junina', { inicio: '2026-06-01', fim: '2026-06-30', dia: '2026-06-24' }), em('2026-06-10')), 'Arraiá até 30/06');
  });

  caso('Black Friday: antes do período diz quando começa; no período, conta ao vivo até o fim', () => {
    const bf = ev('blackfriday', { inicio: '2026-11-23', fim: '2026-11-29', dia: '2026-11-27' });
    assert.equal(contagemDoEvento(bf, em('2026-11-20')), 'Começa 23/11');
    assert.equal(contagemDoEvento(bf, em('2026-11-29', '23:59')), 'Termina em 00:00:59');
    assert.equal(contagemDoEvento(bf, em('2026-11-28', '21:59')), 'Termina em 1d 02:00:59');
    assert.ok(contagemAoVivo('blackfriday') && contagemAoVivo('jogo') && !contagemAoVivo('natal'));
  });

  caso('Dia de jogo: antes, durante e depois — e a chamada da loja como rótulo', () => {
    const partida = { inicio: '2026-10-01T21:30:00-03:00', fim: '2026-10-02T03:00:00.000Z', chamada: 'Final do campeonato' };
    assert.equal(contagemDoJogo(partida, em('2026-10-01', '19:25')), 'Bola rola às 21:30 · faltam 2h05');
    assert.equal(contagemDoJogo(partida, em('2026-10-01', '21:00')), 'Bola rola às 21:30 · faltam 30 min');
    assert.equal(contagemDoJogo(partida, em('2026-10-01', '22:00')), 'Bola rolando: peça sem sair do sofá');
    assert.equal(contagemDoJogo(partida, em('2026-10-01', '23:45')), 'Fim de jogo: pede a saideira');
    assert.equal(textosDaFaixa(ev('jogo', { partida }), 0).rotulo, 'Final do campeonato');
    assert.equal(textosDaFaixa(ev('jogo', { partida: { ...partida, chamada: null } }), 0).rotulo, 'Dia de jogo');
    assert.equal(contagemDoEvento(ev('jogo', { partida }), em('2026-10-01', '21:00')), 'Bola rola às 21:30 · faltam 30 min');
  });

  console.log(`\n${n} grupos de casos: tudo certo.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
