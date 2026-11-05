'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensaiar, enviar, abrirConversa, ROTEIROS: R } = require('../src/envio-ifood');

const PEDIDO = 'aaaaaaaa-1111-2222-3333-444444444444';
const OUTRO = 'cccccccc-1111-2222-3333-444444444444';
const CANAL = (p) => `sendbird_gc_cm_${p}_bbbbbbbb-5555-6666-7777-888888888888`;

/**
 * O Gestor de mentira: responde a cada roteiro como a tela de verdade responderia. `topo` é o número que o h1 mostra;
 * `canal` é o que o Gestor "carrega" ao abrir a conversa; o campo guarda o que foi digitado.
 */
function gestorDeMentira({ topo = '3118', canal = CANAL(PEDIDO), cartoes = 1, botaoLiga = true, recarrega = true } = {}) {
  const rodados = [];
  let campo = '';
  let canalCarregado = null;
  const pagina = {
    executeJavaScript: async (s) => {
      if (s === R.ABRIR_CARTAO('3118')) return (rodados.push('ABRIR_CARTAO'), cartoes === 1 ? { ok: true } : { ok: false, motivo: 'o pedido não está no quadro do Gestor' });
      if (s === R.ABRIR_CHAT_DO_RESUMO('3118')) {
        rodados.push('ABRIR_CHAT');
        if (recarrega) canalCarregado = { canal, em: Date.now() };
        return { ok: true };
      }
      if (s === R.CONVERSA_ABERTA('3118')) return (rodados.push('CONVERSA'), { campos: 1, topo: topo === '3118' });
      if (s === R.FOCAR_CAMPO) return (rodados.push('FOCAR'), true);
      if (s === R.LER_CAMPO) return (rodados.push('LER'), { campos: 1, valor: campo, botaoLigado: botaoLiga && campo !== '' });
      if (s === R.APAGAR_CAMPO) return (rodados.push('APAGAR'), (campo = ''), true);
      if (s === R.APERTAR_ENVIAR) return (rodados.push('ENVIAR'), true);
      throw new Error('roteiro desconhecido');
    },
  };
  const eco = { m: null };
  const leitor = {
    ultimoCanal: () => canalCarregado,
    esperarEco: async () => eco.m,
  };
  const digitados = [];
  const digitar = async (t) => {
    digitados.push(t);
    campo += t;
  };
  return { ctx: { pagina, leitor, digitar }, rodados, digitados, eco, campo: () => campo };
}

test('ENSAIO: abre, confere, escreve e APAGA — nunca aperta "Enviar"', async () => {
  const g = gestorDeMentira();
  const r = await ensaiar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Teste do Regem' }, { segurarMs: 10 });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.ok(!g.rodados.includes('ENVIAR'), 'o ensaio apertou Enviar');
  assert.deepEqual(g.digitados, ['Teste do Regem']);
  assert.equal(g.campo(), '');
  assert.ok(r.etapas.some((e) => /NÃO apertei/.test(e)));
});

test('conferência 1: o topo da conversa é de outro pedido → não escreve', async () => {
  const g = gestorDeMentira({ topo: '9999' });
  const r = await abrirConversa(g.ctx.pagina, g.ctx.leitor, { numero: '3118', pedidoExterno: PEDIDO }, { prazoMs: 300 });
  assert.equal(r.ok, false);
  assert.match(r.etapas.at(-1), /topo da conversa não mostra #3118/);
  const e = await ensaiar(gestorDeMentira({ topo: '9999' }).ctx, { numero: '3118', texto: 'x' }, { segurarMs: 1 }).catch((x) => x);
  assert.equal(e.ok, false);
});

test('conferência 2: o canal carregado é de OUTRO pedido → não escreve', async () => {
  const g = gestorDeMentira({ canal: CANAL(OUTRO) });
  const r = await ensaiar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.etapas.at(-1), /OUTRO pedido/);
  assert.deepEqual(g.digitados, []);
});

test('conversa que o Gestor já tinha aberta (não recarrega o canal): vale o topo; o ensaio segue com o aviso', async () => {
  const g = gestorDeMentira({ recarrega: false });
  const r = await ensaiar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Teste do Regem' }, { segurarMs: 1 });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.ok(r.etapas.some((e) => /já tinha esta conversa aberta/.test(e)));
  assert.ok(!g.rodados.includes('ENVIAR'));
});

test('o pedido não está no quadro → para no começo; número inválido nem tenta', async () => {
  const g = gestorDeMentira({ cartoes: 0 });
  const r = await ensaiar(g.ctx, { numero: '3118', texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.etapas.at(-1), /não está no quadro/);
  const n = await ensaiar(gestorDeMentira().ctx, { numero: '31a8', texto: 'oi' }, { segurarMs: 1 });
  assert.match(n.etapas.at(-1), /algarismos/);
});

test('o botão "Enviar mensagem" não ligou → apaga o campo e para', async () => {
  const g = gestorDeMentira({ botaoLiga: false });
  const r = await ensaiar(g.ctx, { numero: '3118', texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.ok(g.rodados.includes('APAGAR'));
  assert.equal(g.campo(), '');
});

test('ENVIO: aperta "Enviar" uma vez e só dá por enviado com o eco do chat; sem eco, "incerto"', async () => {
  const g = gestorDeMentira();
  g.eco.m = { id: '777', autor: 'loja' };
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.equal(r.id, '777');
  assert.equal(g.rodados.filter((x) => x === 'ENVIAR').length, 1);
  const sem = gestorDeMentira();
  const r2 = await enviar(sem.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { ecoMs: 10 });
  assert.equal(r2.ok, false);
  assert.equal(r2.incerto, true);
});

test('ERR-375: o eco chega NO MOMENTO do clique — quem escuta só depois perde; o envio escuta antes', async () => {
  const g = gestorDeMentira();
  // um leitor com ouvintes de verdade: o eco vai só para quem já está ouvindo quando ele chega
  const ouvintes = new Set();
  g.ctx.leitor.esperarEco = ({ prazoMs = 200 }) =>
    new Promise((resolver) => {
      const t = setTimeout(() => (ouvintes.delete(f), resolver(null)), prazoMs);
      const f = (m) => (clearTimeout(t), ouvintes.delete(f), resolver(m));
      ouvintes.add(f);
    });
  const original = g.ctx.pagina.executeJavaScript;
  g.ctx.pagina.executeJavaScript = async (s) => {
    const r = await original(s);
    if (s === R.APERTAR_ENVIAR) for (const f of [...ouvintes]) f({ id: '888', autor: 'loja' }); // o eco, já no clique
    return r;
  };
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { ecoMs: 200 });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.equal(r.id, '888');
});

test('os roteiros da página compilam', () => {
  for (const [nome, r] of Object.entries(R)) {
    const s = typeof r === 'function' ? r('3118') : r;
    assert.doesNotThrow(() => new Function(`return ${s};`), nome);
  }
});
