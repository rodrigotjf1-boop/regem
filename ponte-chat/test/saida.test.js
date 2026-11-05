'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Saida } = require('../src/saida');
const { Jornal } = require('../src/jornal');
const { classificar } = require('../src/nuvem');

const P = 'aaaaaaaa-1111-2222-3333-444444444444';
const ID = (n) => `0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const aviso = (n, o = {}) => ({ id: ID(n), canal: 'ifood', pedidoExterno: P, pedidoNumero: '3118', cliente: 'Carine S.', texto: 'Seu pedido saiu para entrega!', motivo: 'saiu', criadoEm: new Date(1_000_000).toISOString(), ...o });
const novoJornal = () => new Jornal(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-saida-')), 'envios.jsonl'));

/**
 * A ponte de mentira em volta do trabalhador: a nuvem (a fila e os resultados), a tela, o envio e a memória do chat.
 * `envio(item, opcoes, n)` decide o que o Gestor "fez" na n-ésima chamada.
 */
function montar({ pode = { ok: true }, telas = null, papel = 'responde', itens = [aviso(1)], envio, memoria = () => null, jornal = novoJornal(), pegarResposta, resultadoResposta } = {}) {
  const pegou = [];
  const resultados = [];
  const enviados = [];
  const abertos = [];
  const classes = [];
  let iTela = 0;
  const s = new Saida({
    podeTrabalhar: () => pode,
    telaLivre: async () => {
      const t = telas ? telas[Math.min(iTela, telas.length - 1)] : { ok: true };
      iTela += 1;
      return t;
    },
    pessoaMexeuDesde: async () => false,
    enviarItem: async (item, opcoes) => {
      enviados.push(item.id);
      return envio ? envio(item, opcoes, enviados.length) : (await opcoes.aoApertar(), { ok: true, apertou: true, id: `eco-${enviados.length}` });
    },
    abrirSemEnviar: async (item) => (abertos.push(item.id), { ok: true }),
    jaEnviada: (q) => memoria(q),
    jornal,
    nuvem: {
      classificar,
      pegar: async (_cred, canal) => (pegou.push(canal), pegarResposta || { ok: true, status: 200, dados: { papel, itens } }),
      resultado: async (_cred, id, corpo) => (resultados.push({ alvo: id, ...corpo }), resultadoResposta || { ok: true, status: 200, dados: { ok: true } }),
    },
    credencial: () => ({ terminalId: 't', segredo: 's' }),
    tratarClassificacao: (c) => classes.push(c),
    esperaTelaMs: 60,
    passoTelaMs: 10,
  });
  return { s, pegou, resultados, enviados, abertos, classes, jornal };
}

test('não pede a fila sem poder trabalhar (desligada, reserva, sem login, só observando)', async () => {
  const m = montar({ pode: { ok: false, motivo: 'ponte desligada nos ajustes' } });
  const r = await m.s.volta();
  assert.equal(r.situacao, 'ponte desligada nos ajustes');
  assert.equal(m.pegou.length, 0);
});

test('tela do Gestor ocupada: NÃO pede a fila (pedir gastaria uma das 3 tentativas à toa)', async () => {
  const m = montar({ telas: [{ ok: false, motivo: 'alguém está usando o Gestor agora' }] });
  const r = await m.s.volta();
  assert.match(r.situacao, /esperando a tela do Gestor \(alguém está usando/);
  assert.equal(m.pegou.length, 0);
});

test('o caminho normal: pega, envia uma vez, devolve ENVIADA com o id do eco; o diário tem apertou → eco → fim', async () => {
  const m = montar();
  await m.s.volta();
  assert.deepEqual(m.pegou, ['ifood']);
  assert.deepEqual(m.enviados, [ID(1)]);
  assert.deepEqual(m.resultados, [{ alvo: ID(1), ok: true, id: 'eco-1' }]);
  const j = m.jornal.de(ID(1));
  assert.ok(j.apertouEm && j.ecoId === 'eco-1' && j.fimEm);
  assert.equal(m.s.enviadas, 1);
  assert.equal(m.s.situacao, 'em dia');
});

test('o resultado leva o id da mensagem no chat (o eco), no corpo { ok: true, id }', async () => {
  const resultados = [];
  const m = montar();
  m.s.nuvem.resultado = async (_c, id, corpo) => (resultados.push({ alvo: id, corpo }), { ok: true, status: 200 });
  await m.s.volta();
  assert.deepEqual(resultados, [{ alvo: ID(1), corpo: { ok: true, id: 'eco-1' } }]);
});

test('JÁ ESTÁ NO CHAT (a ponte mandou e caiu antes de avisar; ou alguém da loja mandou o mesmo): não digita de novo', async () => {
  const m = montar({ memoria: (q) => (q.pedidoExterno === P && q.texto === 'Seu pedido saiu para entrega!' && q.desde === 1_000_000 ? { id: '9001' } : null) });
  await m.s.volta();
  assert.deepEqual(m.enviados, []);
  assert.deepEqual(m.resultados, [{ alvo: ID(1), ok: true, id: '9001' }]);
  assert.equal(m.jornal.de(ID(1)).ecoId, '9001');
});

test('texto proibido no chat (telefone, link…) e mensagem sem o número do pedido: falha DEFINITIVA, sem abrir o Gestor', async () => {
  const m = montar({ itens: [aviso(1, { texto: 'Chama no zap 21 99999-8888' }), aviso(2, { pedidoNumero: null })] });
  await m.s.volta();
  assert.deepEqual(m.enviados, []);
  assert.equal(m.resultados.length, 2);
  for (const x of m.resultados) assert.equal(x.definitivo, true);
  assert.match(m.resultados[0].erro, /proíbem telefone/);
  assert.match(m.resultados[1].erro, /sem o número do pedido/);
});

test('pedido FORA do quadro do Gestor: falha definitiva com o motivo (não tenta para sempre)', async () => {
  const m = montar({ envio: () => ({ ok: false, codigo: 'fora_do_quadro', etapas: ['✗ o pedido não está no quadro do Gestor (confira se ele aparece em alguma coluna)'] }) });
  await m.s.volta();
  assert.equal(m.resultados[0].ok, false);
  assert.equal(m.resultados[0].definitivo, true);
  assert.match(m.resultados[0].erro, /não está no quadro/);
});

test('rascunho no campo / a pessoa voltou a mexer / conferência que falhou: volta para a fila (NÃO definitivo)', async () => {
  for (const r of [
    { ok: false, adiar: true, codigo: 'campo_com_texto', etapas: ['✗ o campo de mensagem já tem um texto (de alguém da loja) — não mexi nele'] },
    { ok: false, adiar: true, codigo: 'pessoa', etapas: ['✗ alguém voltou a mexer no Gestor — não apertei'] },
    { ok: false, codigo: 'topo', etapas: ['✗ o topo da conversa não mostra #3118'] },
  ]) {
    const m = montar({ envio: () => r });
    await m.s.volta();
    assert.equal(m.resultados[0].ok, false);
    assert.equal(m.resultados[0].definitivo, undefined, r.codigo);
    assert.ok(!m.jornal.de(ID(1)) || !m.jornal.de(ID(1)).apertouEm, 'não apertou');
  }
});

test('a tela ficou ocupada DEPOIS de pegar: espera (dentro do prazo) e envia quando libera; se não libera, devolve sem ser definitivo', async () => {
  const m = montar({ telas: [{ ok: true }, { ok: false, motivo: 'alguém está usando o Gestor agora' }, { ok: false, motivo: 'x' }, { ok: true }] });
  await m.s.volta();
  assert.deepEqual(m.enviados, [ID(1)]);
  const n = montar({ telas: [{ ok: true }, { ok: false, motivo: 'há um texto no campo de mensagem (de alguém da loja)' }] });
  await n.s.volta();
  assert.deepEqual(n.enviados, []);
  assert.equal(n.resultados[0].ok, false);
  assert.equal(n.resultados[0].definitivo, undefined);
  assert.match(n.resultados[0].erro, /esperando a tela do Gestor: há um texto no campo/);
});

test('sem o diário (programa reaberto, arquivo perdido): a conversa aberta mostra a mensagem no HISTÓRICO — não digita de novo', async () => {
  let historico = 0;
  const m = montar({
    envio: async (_item, opcoes) => {
      const ja = await opcoes.jaEstaNoChat(); // o envio confere logo depois de abrir a conversa
      return ja ? { ok: true, jaEstava: true, id: ja.id } : { ok: false, codigo: 'x', etapas: ['✗ não devia chegar aqui'] };
    },
    memoria: () => (historico ? { id: 'h-1' } : null),
  });
  m.s.esperarHistorico = async () => {
    historico = Date.now(); // o Gestor carregou o histórico ao abrir
  };
  await m.s.volta();
  assert.deepEqual(m.resultados, [{ alvo: ID(1), ok: true, id: 'h-1' }]);
  assert.equal(m.s.enviadas, 0, 'não conta como enviada por este PC');
  assert.ok(!m.jornal.de(ID(1)).apertouEm, 'não apertou');
});

test('o diário do "apertei" é gravado ANTES do clique (o envio chama `aoApertar` antes de apertar)', async () => {
  let antes = null;
  const m = montar({
    envio: async (item, opcoes) => {
      await opcoes.aoApertar();
      antes = m.jornal.de(item.id) && m.jornal.de(item.id).apertouEm; // aqui o clique ainda não aconteceu
      return { ok: true, apertou: true, id: 'eco-x' };
    },
  });
  await m.s.volta();
  assert.ok(antes, 'o apertou já estava no diário na hora do clique');
});

test('SEM ENVIO EM DOBRO: apertou e o eco não voltou → "incerto" definitivo; o mesmo aviso de volta NÃO é digitado de novo', async () => {
  const jornal = novoJornal();
  const incerto = async (_item, opcoes) => (await opcoes.aoApertar(), { ok: false, incerto: true, apertou: true, codigo: 'sem_eco', etapas: ['✗ a mensagem não voltou pelo chat a tempo'] });
  const m = montar({ envio: incerto, jornal });
  await m.s.volta();
  assert.equal(m.resultados[0].ok, false);
  assert.equal(m.resultados[0].definitivo, true);
  assert.match(m.resultados[0].erro, /envio incerto/);
  // a nuvem devolveu o mesmo aviso (ex.: o resultado não chegou): o diário diz "apertei" — abre a conversa, confere, e NÃO digita
  const de = montar({ envio: incerto, jornal, resultadoResposta: { ok: true, status: 200 } });
  jornal.envios.get(ID(1)).fimEm = undefined; // como se o resultado não tivesse chegado à nuvem
  await de.s.volta();
  assert.deepEqual(de.enviados, [], 'não digitou de novo');
  assert.deepEqual(de.abertos, [ID(1)], 'abriu a conversa para o Gestor carregar o histórico');
  assert.equal(de.resultados[0].definitivo, true);
  assert.match(de.resultados[0].erro, /já tinha apertado/);
});

test('apertou, caiu, e o histórico mostrou que SAIU: dá por enviada com o id que achou (sem digitar)', async () => {
  const jornal = novoJornal();
  jornal.apertou(ID(1));
  let carregou = false;
  const m = montar({ jornal, memoria: () => (carregou ? { id: '7777' } : null) });
  m.s.abrirSemEnviar = async () => {
    carregou = true; // o Gestor abriu a conversa e o histórico trouxe a mensagem
    return { ok: true };
  };
  await m.s.volta();
  assert.deepEqual(m.enviados, []);
  assert.deepEqual(m.resultados, [{ alvo: ID(1), ok: true, id: '7777' }]);
  assert.equal(jornal.de(ID(1)).ecoId, '7777');
});

test('o programa caiu DEPOIS do eco e antes de avisar a nuvem: reaberto (o diário do arquivo), devolve enviada sem digitar', async () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-saida-')), 'envios.jsonl');
  const antes = new Jornal(arq);
  antes.apertou(ID(1));
  antes.eco(ID(1), '5555');
  const m = montar({ jornal: new Jornal(arq) });
  await m.s.volta();
  assert.deepEqual(m.enviados, []);
  assert.deepEqual(m.resultados, [{ alvo: ID(1), ok: true, id: '5555' }]);
});

test('o eco chegou TARDE (depois do prazo do envio): a memória confere de novo e dá por enviada', async () => {
  let tarde = false;
  const m = montar({
    envio: async (_item, opcoes) => {
      await opcoes.aoApertar();
      tarde = true;
      return { ok: false, incerto: true, apertou: true, codigo: 'sem_eco', etapas: ['✗ não voltou a tempo'] };
    },
    memoria: () => (tarde ? { id: 'tarde-1' } : null),
  });
  await m.s.volta();
  assert.equal(m.resultados[0].ok, true);
  assert.equal(m.s.enviadas, 1);
});

test('reserva / desligada pela nuvem: nada é tratado; ponte REVOGADA na hora de pegar: avisa (o PC esquece o pareamento)', async () => {
  for (const papel of ['reserva', 'desligada', 'fora']) {
    const m = montar({ papel });
    await m.s.volta();
    assert.deepEqual(m.enviados, []);
    assert.deepEqual(m.resultados, []);
  }
  const r = montar({ pegarResposta: { ok: false, status: 403, code: 'TERMINAL_REVOGADO' } });
  await r.s.volta();
  assert.deepEqual(r.classes, ['revogado']);
  assert.deepEqual(r.enviados, []);
});

test('409 no resultado (a mensagem não é mais desta ponte): o diário fecha — não tenta de novo', async () => {
  const m = montar({ resultadoResposta: { ok: false, status: 409 } });
  await m.s.volta();
  assert.ok(m.jornal.de(ID(1)).fimEm);
});

test('uma volta por vez (a volta seguinte, durante uma em andamento, não faz nada)', async () => {
  let solta;
  const m = montar({ envio: () => new Promise((r) => (solta = () => r({ ok: true, apertou: true, id: 'e' }))) });
  const primeira = m.s.volta();
  await new Promise((r) => setTimeout(r, 20));
  const segunda = await m.s.volta();
  assert.equal(segunda.pulou, true);
  solta();
  await primeira;
  assert.equal(m.pegou.length, 1);
});
