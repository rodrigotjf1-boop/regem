'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { INSTALAR_VIGIA, ESTADO_DA_TELA, ABRIR_PEDIDOS, avaliarTela, deveVoltarAoQuadro, mexeuDesde } = require('../src/tela-livre');

const tela = (o) => ({ vigia: true, acaoEm: 0, vigiaDesde: 0, cartoes: 3, campoComTexto: false, ...o });

test('livre = no quadro, sem rascunho no campo e ninguém mexendo há o tempo da parada', () => {
  const agora = 1_000_000;
  assert.deepEqual(avaliarTela(tela({ acaoEm: agora - 20_000 }), { agora, paradaMs: 10_000 }), { ok: true });
  assert.match(avaliarTela(tela({ acaoEm: agora - 2_000 }), { agora, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  // a tecla pela janela (o Electron conta) também vale
  assert.match(avaliarTela(tela({ acaoEm: 0 }), { agora, ultimaTeclaEm: agora - 1_000, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  // vigia recém-posto (a página recarregou): o que houve antes ninguém viu — espera a parada inteira
  assert.match(avaliarTela(tela({ vigiaDesde: agora - 3_000 }), { agora, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  assert.match(avaliarTela(tela({ cartoes: 0 }), { agora }).motivo, /quadro "Pedidos"/);
  assert.match(avaliarTela(tela({ campoComTexto: true }), { agora }).motivo, /texto no campo/);
  assert.match(avaliarTela(tela({ vigia: false }), { agora }).motivo, /vigia/);
  assert.match(avaliarTela(null, { agora }).motivo, /não respondeu/);
});

test('"mexeu desde": a última conferência antes de apertar; sem resposta da página, conta como mexeu (não aperta)', () => {
  assert.equal(mexeuDesde(tela({ acaoEm: 500 }), 1000, 0), false);
  assert.equal(mexeuDesde(tela({ acaoEm: 1500 }), 1000, 0), true);
  assert.equal(mexeuDesde(tela({ acaoEm: 0 }), 1000, 1200), true);
  assert.equal(mexeuDesde(null, 1000, 0), true);
});

test('os roteiros da página compilam', () => {
  for (const s of [INSTALAR_VIGIA, ESTADO_DA_TELA, ABRIR_PEDIDOS]) assert.doesNotThrow(() => new Function(`return ${s};`));
});

test('quadro "Pedidos" aberto e sem cartões: o motivo diz que está vazio, não que está fora (ERR-418)', () => {
  assert.match(avaliarTela(tela({ cartoes: 0, noPedidos: true }), { agora: 1 }).motivo, /está sem cartões/);
  assert.match(avaliarTela(tela({ cartoes: 0, noPedidos: false }), { agora: 1 }).motivo, /não está no quadro "Pedidos"/);
});

test('voltar ao quadro: só fora de "Pedidos", com o item no menu, sem rascunho, parada longa e sem insistir (ERR-418)', () => {
  const agora = 10_000_000;
  const fora = tela({ cartoes: 0, itemPedidos: true, noPedidos: false, acaoEm: agora - 70_000, vigiaDesde: agora - 80_000 });
  const op = { agora, voltarMs: 60_000 };
  assert.equal(deveVoltarAoQuadro(fora, op), true);
  // já em "Pedidos" (com ou sem cartões), sem o item no menu, sem vigia ou sem resposta: não clica
  assert.equal(deveVoltarAoQuadro({ ...fora, noPedidos: true }, op), false);
  assert.equal(deveVoltarAoQuadro({ ...fora, itemPedidos: false }, op), false);
  assert.equal(deveVoltarAoQuadro({ ...fora, vigia: false }, op), false);
  assert.equal(deveVoltarAoQuadro(null, op), false);
  // o rascunho de alguém no campo: não sai da página
  assert.equal(deveVoltarAoQuadro({ ...fora, campoComTexto: true }, op), false);
  // alguém mexeu há pouco (página, teclado da janela ou vigia recém-posto): espera a parada longa inteira
  assert.equal(deveVoltarAoQuadro({ ...fora, acaoEm: agora - 30_000 }, op), false);
  assert.equal(deveVoltarAoQuadro(fora, { ...op, ultimaTeclaEm: agora - 5_000 }), false);
  assert.equal(deveVoltarAoQuadro({ ...fora, vigiaDesde: agora - 20_000 }, op), false);
  // a parada do envio (10 s) não basta: é a longa
  assert.equal(deveVoltarAoQuadro({ ...fora, acaoEm: agora - 15_000, vigiaDesde: 0 }, op), false);
  // voltou há pouco e o clique não levou: não insiste a cada volta da fila
  assert.equal(deveVoltarAoQuadro(fora, { ...op, ultimaVoltaEm: agora - 10_000 }), false);
  assert.equal(deveVoltarAoQuadro(fora, { ...op, ultimaVoltaEm: agora - 61_000 }), true);
});

/** Um Gestor de mentira: o menu lateral (botões com o rótulo por `aria-labelledby`), o quadro e o endereço. */
function gestorDeMentira({ atual = 'Início', cartoes = 0, hash = '#/home/merchant-dashboard', comItem = true } = {}) {
  const cliques = [];
  const caixa = { getBoundingClientRect: () => ({ width: 10, height: 10 }) };
  const rotulos = {};
  const nomes = comItem ? ['Início', 'Pedidos', 'Cardápio'] : ['Início', 'Cardápio'];
  const itens = nomes.map((nome, i) => {
    const id = `ifds-id-${18 + 2 * i}`;
    rotulos[id] = { textContent: ` ${nome} ` };
    return { ...caixa, getAttribute: (a) => (a === 'aria-labelledby' ? id : a === 'aria-current' && nome === atual ? 'page' : null), click: () => cliques.push(nome) };
  });
  const document = {
    querySelectorAll: (sel) => {
      if (sel === '.kanban-column button') return Array.from({ length: cartoes }, () => caixa);
      if (sel === 'textarea[aria-label="Campo de mensagem"]') return [{ value: '' }];
      if (sel === '[data-testid="action-button"][aria-labelledby]') return itens;
      return [];
    },
    getElementById: (id) => rotulos[id] || null,
  };
  const window = { __ponteVigia: true, __ponteAcaoEm: 5, __ponteVigiaDesde: 3 };
  const rodar = (roteiro) => new Function('window', 'document', 'location', `return ${roteiro}`)(window, document, { hash });
  return { rodar, cliques };
}

test('o roteiro da tela lê o item "Pedidos" do menu e o começo do endereço, sem id (ERR-418)', () => {
  const inicio = gestorDeMentira().rodar(ESTADO_DA_TELA);
  assert.equal(inicio.itemPedidos, true);
  assert.equal(inicio.noPedidos, false);
  assert.equal(inicio.cartoes, 0);
  assert.equal(inicio.pagina, '#/home/merchant-dashboard');
  const quadro = gestorDeMentira({ atual: 'Pedidos', cartoes: 13, hash: '#/home/order-display/kanban' }).rodar(ESTADO_DA_TELA);
  assert.equal(quadro.noPedidos, true);
  assert.equal(quadro.cartoes, 13);
  assert.equal(quadro.pagina, '#/home/order-display');
  // um id no endereço não vai ao diagnóstico
  assert.equal(gestorDeMentira({ hash: '#/home/9f8e7d6c-1234-4abc-8def-0123456789ab?x=1' }).rodar(ESTADO_DA_TELA).pagina, '#/home/…');
  assert.equal(gestorDeMentira({ comItem: false }).rodar(ESTADO_DA_TELA).itemPedidos, false);
});

test('o roteiro de voltar clica em "Pedidos" só fora dele; sem o item, não clica em nada (ERR-418)', () => {
  const fora = gestorDeMentira();
  assert.equal(fora.rodar(ABRIR_PEDIDOS), true);
  assert.deepEqual(fora.cliques, ['Pedidos']);
  const dentro = gestorDeMentira({ atual: 'Pedidos' });
  assert.equal(dentro.rodar(ABRIR_PEDIDOS), false);
  assert.deepEqual(dentro.cliques, []);
  const semItem = gestorDeMentira({ comItem: false });
  assert.equal(semItem.rodar(ABRIR_PEDIDOS), false);
  assert.deepEqual(semItem.cliques, []);
});
