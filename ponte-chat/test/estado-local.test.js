'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const local = require('../src/estado-local');

const base = (e = {}, o = {}) =>
  local.resumo(
    { ligada: true, papel: 'responde', nuvem: 'ok', logadoNoIfood: true, enviadas: 3, ultimoErro: null, ...e },
    { versao: '0.5.0', maquina: 'CX-DELIVERY', pareada: true, nome: 'Ponte do delivery', saida: { situacao: 'livre', enviadas: 2 }, agora: new Date('2026-11-05T17:40:00Z'), ...o },
  );
const botoes = (v) => v.botoes.map((b) => b.texto);
const par = (v, k) => (v.pares.find((p) => p[0] === k) || [])[1];

test('os comandos da linha de comando: o 1º que valer; nada conhecido = null', () => {
  assert.equal(local.comandoDe(['electron.exe', '.', '--pausar']), 'pausar');
  assert.equal(local.comandoDe(['x', '--retomar', '--pausar']), 'retomar');
  assert.equal(local.comandoDe(['x', '--abrir']), 'estado');
  assert.equal(local.comandoDe(['x', '--abrir-ifood']), 'abrir-ifood');
  assert.equal(local.comandoDe(['x', '--so-observar']), null);
  assert.equal(local.comandoDe(undefined), null);
});

test('respondendo: selo "responde o chat", sem faixa, botão de pausar; o resumo não leva segredo nem conversa', () => {
  const r = base();
  const v = local.paraAJanela(r);
  assert.deepEqual(v.selo, { tom: 'ok', texto: 'responde o chat' });
  assert.equal(v.faixa, null);
  assert.equal(v.sub, 'CX-DELIVERY · Ponte do delivery');
  assert.equal(par(v, 'iFood'), 'logado · este PC responde o chat');
  assert.equal(par(v, 'Mensagens'), '3 levadas ao Regem desde que o programa abriu');
  assert.equal(par(v, 'Fila de saída'), 'livre · 2 enviadas por este PC');
  assert.deepEqual(botoes(v), ['Abrir o iFood', 'Abrir a 99', 'Pausar a ponte neste PC', 'Abrir o Atendimento']);
  assert.deepEqual(Object.keys(r).sort(), ['abrir', 'atualizadoEm', 'ifood', 'lidas', 'ligada', 'maquina', 'n99', 'nome', 'nuvem', 'papel', 'pareada', 'pausadaEm', 'saida', 'saida99', 'soObservar', 'ultimoAviso', 'versao'].sort());
  assert.equal(r.atualizadoEm, '2026-11-05T17:40:00.000Z');
});

test('pausada: o selo e a faixa dizem desde quando; o botão vira "Retomar" (o nome que as telas do Regem citam — V65)', () => {
  const pausadaEm = new Date(2026, 10, 5, 14, 32).toISOString(); // 14:32 no relógio deste PC
  const v = local.paraAJanela(base({}, { pausadaEm }));
  assert.deepEqual(v.selo, { tom: 'aviso', texto: 'pausada neste PC' });
  assert.equal(v.faixa.texto, 'A ponte está pausada neste PC desde 14:32: não lê nem responde o chat. A reserva, se houver, assume.');
  assert.equal(v.faixa.acao, 'retomar');
  // pausada, o papel não aparece (ela não responde nem é reserva)
  assert.equal(par(v, 'iFood'), 'logado');
  assert.deepEqual(botoes(v), ['Abrir o iFood', 'Abrir a 99', 'Retomar a ponte neste PC', 'Abrir o Atendimento']);
  // o texto das telas do Regem tem de citar este mesmo item
  const tela = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'ponte-do-chat.ts'), 'utf8');
  assert.ok(tela.includes('Retomar a ponte neste PC'));
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(main.includes("label: 'Retomar a ponte neste PC'") && main.includes("label: 'Pausar a ponte neste PC'"));
});

test('cada situação dá a faixa com o que fazer agora', () => {
  assert.deepEqual(local.paraAJanela(base({}, { pareada: false })).faixa, { tom: 'aviso', texto: 'Falta parear este PC com o Regem.', acao: 'parear' });
  assert.deepEqual(botoes(local.paraAJanela(base({}, { pareada: false }))), ['Abrir o iFood', 'Abrir a 99', 'Parear este PC', 'Abrir o Atendimento']);
  assert.equal(local.paraAJanela(base({ ligada: false })).selo.texto, 'desligada nos ajustes');
  assert.match(local.paraAJanela(base({ ligada: false })).faixa.texto, /Delivery › Configurações › Atendimento/);
  const semLogin = local.paraAJanela(base({ logadoNoIfood: false }));
  assert.deepEqual([semLogin.selo.texto, semLogin.faixa.acao, par(semLogin, 'iFood')], ['iFood sem login', 'abrir-ifood', 'sem login']);
  const rede = local.paraAJanela(base({ nuvem: 'rede' }));
  assert.deepEqual([rede.selo.texto, rede.faixa, par(rede, 'Regem')], ['sem a nuvem', null, 'sem conexão com a nuvem — tentando de novo']);
  assert.equal(local.paraAJanela(base({ nuvem: 'revogado' })).faixa.acao, 'parear');
  assert.equal(par(local.paraAJanela(base({ papel: 'reserva' })), 'iFood'), 'logado · reserva (assume se a outra parar)');
  const obs = local.paraAJanela(base({}, { soObservar: true }));
  assert.deepEqual([obs.selo.texto, botoes(obs)], ['só observando', ['Abrir o iFood', 'Abrir o Atendimento']]);
  // 1 mensagem: singular; o último aviso aparece
  const um = local.paraAJanela(base({ enviadas: 1, ultimoErro: '14:00 ponte pausada neste PC' }, { saida: { situacao: 'livre', enviadas: 1 } }));
  assert.equal(par(um, 'Mensagens'), '1 levada ao Regem desde que o programa abriu');
  assert.equal(par(um, 'Fila de saída'), 'livre · 1 enviada por este PC');
  assert.equal(par(um, 'Último aviso'), '14:00 ponte pausada neste PC');
});

test('a 99 (4a): não lida, sem login (faixa com o usuário EXTRA) e lendo; o botão de parar só com ela escolhida', () => {
  const nao = local.paraAJanela(base());
  assert.match(par(nao, '99Food'), /^não é lida neste PC/);
  assert.ok(!botoes(nao).includes('Parar de ler a 99 neste PC'));
  const semLogin = local.paraAJanela(base({}, { usar99: true }));
  assert.equal(semLogin.faixa.acao, 'abrir-99');
  assert.match(semLogin.faixa.texto, /USUÁRIO EXTRA da loja/);
  assert.equal(par(semLogin, '99Food'), 'sem login — entre com o usuário extra da loja');
  assert.deepEqual(botoes(semLogin), ['Abrir o iFood', 'Abrir a 99', 'Responder pela 99 neste PC', 'Parar de ler a 99 neste PC', 'Pausar a ponte neste PC', 'Abrir o Atendimento']);
  const lendo = local.paraAJanela(base({ logadoNa99: true }, { usar99: true }));
  assert.equal(lendo.faixa, null);
  assert.match(par(lendo, '99Food'), /só LÊ o chat .*responda pelo portal da 99/);
  // o iFood sem login vem antes (é o que a ponte faz sozinha); um resumo antigo (sem `n99`) não quebra a janela
  assert.equal(local.paraAJanela(base({ logadoNoIfood: false }, { usar99: true })).faixa.acao, 'abrir-ifood');
  const antigo = base();
  delete antigo.n99;
  assert.match(par(local.paraAJanela(antigo), '99Food'), /^não é lida/);
  // o modo só observar não oferece a 99
  assert.ok(!botoes(local.paraAJanela(base({}, { soObservar: true }))).includes('Abrir a 99'));
});

test('a 99 respondendo (4b): a linha diz que lê e responde (com o papel), a fila da 99 aparece e o botão vira "Só ler"', () => {
  const r = local.paraAJanela(base({ logadoNa99: true, papel99: 'responde' }, { usar99: true, responder99: true, saida99: { situacao: 'em dia', enviadas: 2 } }));
  assert.equal(par(r, '99Food'), 'logada · lê e RESPONDE o chat · este PC responde o chat');
  assert.equal(par(r, 'Fila de saída da 99'), 'em dia · 2 enviadas por este PC');
  assert.ok(botoes(r).includes('Só ler a 99 (parar de responder)') && !botoes(r).includes('Responder pela 99 neste PC'));
  // pausada: sem o papel; não pareada: sem o botão de responder
  assert.equal(par(local.paraAJanela(base({ logadoNa99: true, papel99: 'responde' }, { usar99: true, responder99: true, pausadaEm: new Date().toISOString() })), '99Food'), 'logada · lê e RESPONDE o chat');
  assert.ok(!botoes(local.paraAJanela(base({}, { usar99: true, pareada: false }))).includes('Responder pela 99 neste PC'));
  // os nomes que a janela mostra são os do menu do ícone
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  assert.ok(main.includes("label: 'Responder pela 99 neste PC'"));
});

test('o arquivo do ícone do Regem: gravado de uma vez, no nome combinado; o endereço do Atendimento', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-local-'));
  const arq = local.gravar(dir, base({}, { abrir: { exe: 'C:\\x\\ponte.exe', args: [] } }));
  assert.equal(path.basename(arq), 'estado-da-ponte.json');
  const lido = JSON.parse(fs.readFileSync(arq, 'utf8'));
  assert.deepEqual(lido.abrir, { exe: 'C:\\x\\ponte.exe', args: [] });
  assert.equal(fs.existsSync(`${arq}.tmp`), false);
  assert.equal(local.enderecoDoAtendimento({}), 'https://app.dmsregem.com/atendimento');
  assert.equal(local.enderecoDoAtendimento({ REGEM_PONTE_APP: 'http://localhost:4310/' }), 'http://localhost:4310/atendimento');
});
