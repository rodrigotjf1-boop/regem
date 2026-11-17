'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIRMAR_MS, REPETIR_MS, motivoParaChamar, textosDaChamada, haQuanto } = require('../src/login-do-ifood');

const MIN = 60 * 1000;
const T0 = 1_800_000_000_000;
// a ponte em uso normal, sem login desde T0
const base = { agora: T0, logado: false, semLoginDesde: T0, chamouEm: 0, jaEsteveLogado: true, pareada: true, pausada: false, ligada: true, soObservar: false };
const em = (min, mais = {}) => motivoParaChamar({ ...base, agora: T0 + min * MIN, ...mais });

test('o caso de 16/11: o login cai e a ponte chama depois de 1 min — não antes (queda curta de rede volta sozinha)', () => {
  assert.equal(CONFIRMAR_MS, MIN);
  assert.equal(em(0), null);
  assert.equal(motivoParaChamar({ ...base, agora: T0 + MIN - 1 }), null);
  assert.equal(em(1), 'caiu');
});

test('logado (ou sem "desde"), nunca chama', () => {
  assert.equal(em(30, { logado: true }), null);
  assert.equal(em(30, { semLoginDesde: 0 }), null);
  assert.equal(motivoParaChamar(null), null);
});

test('o programa abre sem login (a sessão venceu com o PC desligado): chama com o motivo da partida', () => {
  assert.equal(em(1, { jaEsteveLogado: false }), 'abriu_sem_login');
});

test('insiste a cada 10 min enquanto seguir sem login — e só então', () => {
  assert.equal(REPETIR_MS, 10 * MIN);
  const chamouEm = T0 + 1 * MIN;
  assert.equal(em(5, { chamouEm }), null);
  assert.equal(motivoParaChamar({ ...base, agora: chamouEm + REPETIR_MS - 1, chamouEm }), null);
  assert.equal(motivoParaChamar({ ...base, agora: chamouEm + REPETIR_MS, chamouEm }), 'continua_sem_login');
});

test('a chamada de uma queda ANTERIOR não vale para a queda nova: logou, caiu de novo, chama como queda', () => {
  const quedaNova = T0 + 60 * MIN;
  const chamouNaPrimeira = T0 + 1 * MIN;
  assert.equal(motivoParaChamar({ ...base, semLoginDesde: quedaNova, chamouEm: chamouNaPrimeira, agora: quedaNova + 30 * 1000 }), null);
  assert.equal(motivoParaChamar({ ...base, semLoginDesde: quedaNova, chamouEm: chamouNaPrimeira, agora: quedaNova + MIN }), 'caiu');
});

test('não incomoda quando o login não faz falta: só observar, sem pareamento, pausada neste PC, ponte desligada nos ajustes', () => {
  assert.equal(em(30, { soObservar: true }), null);
  assert.equal(em(30, { pareada: false }), null);
  assert.equal(em(30, { pausada: true }), null);
  assert.equal(em(30, { ligada: false }), null);
  // voltou a valer (retomou a ponte, ligou nos ajustes): chama na conferência seguinte
  assert.equal(em(30), 'caiu');
});

test('os prazos são trocáveis (a prova de tela encurta)', () => {
  assert.equal(motivoParaChamar({ ...base, agora: T0 + 2000 }, { confirmarMs: 1000 }), 'caiu');
  assert.equal(motivoParaChamar({ ...base, agora: T0 + 9000, chamouEm: T0 + 2000 }, { confirmarMs: 1000, repetirMs: 5000 }), 'continua_sem_login');
});

test('os textos: dizem o que aconteceu e o que fazer, com o nome da janela; o que insiste diz há quanto tempo', () => {
  const caiu = textosDaChamada('caiu', 2 * MIN);
  assert.equal(caiu.aviso, 'O iFood saiu do login neste PC. Entre com o login da loja na janela "Regem · Ponte do chat" para o chat do iFood voltar a ser respondido.');
  assert.equal(caiu.registro, 'o iFood saiu do login: a janela foi mostrada');
  assert.match(textosDaChamada('abriu_sem_login', MIN).aviso, /^O iFood está sem login neste PC\. Entre com o login da loja/);
  const segue = textosDaChamada('continua_sem_login', 125 * MIN);
  assert.match(segue.aviso, /^O iFood segue sem login neste PC há 2 h 05 min\. Entre com o login da loja/);
  assert.equal(segue.registro, 'o iFood segue sem login há 2 h 05 min: a janela foi mostrada de novo');
  assert.equal(haQuanto(30 * 1000), 'há 1 min');
  assert.equal(haQuanto(59 * MIN), 'há 59 min');
  assert.equal(haQuanto(60 * MIN), 'há 1 h 00 min');
});

test('o nome da janela que o aviso cita é o título que o programa dá à janela do iFood (V65)', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(main.includes("title: 'Regem · Ponte do chat',"), 'a janela do Gestor nasce com o título "Regem · Ponte do chat"');
  assert.ok(main.includes('gestor.setTitle(`Regem · Ponte do chat — ${sit}`)'), 'e segue com ele, mais a situação');
});
