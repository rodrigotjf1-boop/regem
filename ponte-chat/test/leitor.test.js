'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ligarLeitor } = require('../src/leitor');
const { Diagnostico } = require('../src/diagnostico');

// O leitor do Gestor com um depurador de mentira (o mesmo jeito do teste do leitor da 99): o que ele ANOTA das chamadas.
function depuradorFalso() {
  const ouvintes = {};
  const corpos = new Map();
  return {
    corpos,
    isAttached: () => true,
    attach() {},
    on(ev, f) {
      (ouvintes[ev] = ouvintes[ev] || []).push(f);
    },
    async sendCommand(metodo, p) {
      if (metodo !== 'Network.getResponseBody') return {};
      if (!corpos.has(p.requestId)) throw new Error('No resource with given identifier found');
      return { body: corpos.get(p.requestId), base64Encoded: false };
    },
    emitir(metodo, p, sid) {
      for (const f of ouvintes.message || []) f({}, metodo, p, sid);
    },
  };
}
const montar = () => {
  const dbg = depuradorFalso();
  const d = new Diagnostico(null, 'sal', { gravar: false });
  const erros = [];
  const leitor = ligarLeitor({ debugger: dbg }, { aoChegar() {}, diagnostico: d, registrarErro: (s) => erros.push(s) });
  return { dbg, d, erros, leitor };
};
const umInstante = () => new Promise((r) => setImmediate(r));
const RENOVAR = 'https://order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh';
const RENOVAR_ANOTADO = 'order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh';

test('o caso de 16/11: a renovação do acesso do iFood que fica SEM resposta vira "chamada_falhou", com o erro da rede', () => {
  const { dbg, d, erros } = montar();
  dbg.emitir('Network.requestWillBeSent', { requestId: 'r1', request: { url: RENOVAR, method: 'POST' } });
  dbg.emitir('Network.requestWillBeSent', { requestId: 'p1', request: { url: RENOVAR, method: 'OPTIONS' } });
  dbg.emitir('Network.loadingFailed', { requestId: 'p1', errorText: 'net::ERR_TIMED_OUT', canceled: false });
  dbg.emitir('Network.loadingFailed', { requestId: 'r1', errorText: 'net::ERR_FAILED', canceled: false });
  assert.deepEqual(
    d.ultimos.map((l) => [l.ev, l.metodo, l.erro ?? null]),
    [
      ['chamada', 'POST', null],
      ['chamada', 'OPTIONS', null],
      ['chamada_falhou', 'OPTIONS', 'net::ERR_TIMED_OUT'],
      ['chamada_falhou', 'POST', 'net::ERR_FAILED'],
    ],
  );
  assert.equal(d.ultimos.at(-1).url, RENOVAR_ANOTADO);
  assert.equal('cancelada' in d.ultimos.at(-1), false);
  assert.deepEqual(erros, []);
});

test('a recusa do iFood aparece como resposta COM o status; a resposta boa segue sem ele; chamada respondida nunca vira falha', async () => {
  const { dbg, d } = montar();
  // 401: o iFood RESPONDEU "não" — é outra história que a rede caída
  dbg.emitir('Network.requestWillBeSent', { requestId: 'r2', request: { url: RENOVAR, method: 'POST' } });
  dbg.corpos.set('r2', '{"code":"Unauthorized","message":"token expirado"}');
  dbg.emitir('Network.responseReceived', { requestId: 'r2', type: 'XHR', response: { url: RENOVAR, mimeType: 'application/json', status: 401 } });
  dbg.emitir('Network.loadingFinished', { requestId: 'r2' });
  await umInstante();
  const recusa = d.ultimos.at(-1);
  assert.equal(recusa.ev, 'resposta');
  assert.equal(recusa.status, 401);
  assert.deepEqual(recusa.chaves, ['code', 'message']);
  assert.ok(!JSON.stringify(recusa).includes('token expirado'), 'o texto da resposta não vai para o arquivo');
  // um `loadingFailed` tardio da mesma chamada (a página trocou de tela) não a transforma em falha de rede
  dbg.emitir('Network.loadingFailed', { requestId: 'r2', errorText: 'net::ERR_ABORTED', canceled: true });
  assert.equal(d.ultimos.filter((l) => l.ev === 'chamada_falhou').length, 0);
  // 200: sem o campo status
  dbg.emitir('Network.requestWillBeSent', { requestId: 'r3', request: { url: RENOVAR, method: 'POST' } });
  dbg.corpos.set('r3', '{"accessToken":"segredo-que-nao-pode-ir-ao-arquivo","expiresIn":3600}');
  dbg.emitir('Network.responseReceived', { requestId: 'r3', type: 'Fetch', response: { url: RENOVAR, mimeType: 'application/json', status: 200 } });
  dbg.emitir('Network.loadingFinished', { requestId: 'r3' });
  await umInstante();
  const boa = d.ultimos.at(-1);
  assert.equal(boa.ev, 'resposta');
  assert.equal('status' in boa, false);
  assert.ok(!JSON.stringify(d.ultimos).includes('segredo-que-nao-pode-ir-ao-arquivo'), 'o token nunca vai para o arquivo');
});

test('a página que troca de tela cancela a chamada: fica anotada como cancelada; o que não interessa ao diagnóstico não é anotado', () => {
  const { dbg, d } = montar();
  dbg.emitir('Network.requestWillBeSent', { requestId: 'r4', request: { url: 'https://api-x.sendbird.com/v3/users/123456/my_group_channels', method: 'GET' } });
  dbg.emitir('Network.loadingFailed', { requestId: 'r4', errorText: 'net::ERR_ABORTED', canceled: true });
  assert.deepEqual([d.ultimos.at(-1).ev, d.ultimos.at(-1).erro, d.ultimos.at(-1).cancelada], ['chamada_falhou', 'net::ERR_ABORTED', true]);
  const antes = d.ultimos.length;
  dbg.emitir('Network.requestWillBeSent', { requestId: 'r5', request: { url: 'https://api.amplitude.com/2/httpapi', method: 'POST' } });
  dbg.emitir('Network.loadingFailed', { requestId: 'r5', errorText: 'net::ERR_BLOCKED_BY_CLIENT', canceled: false, blockedReason: 'inspector' });
  dbg.emitir('Network.loadingFailed', { requestId: 'nunca-pedida', errorText: 'net::ERR_FAILED' });
  assert.equal(d.ultimos.length, antes);
});
