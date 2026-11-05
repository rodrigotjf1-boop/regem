'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ensaiar, enviar, abrirConversa, voltarAoQuadro, ROTEIROS: R } = require('../src/envio-ifood');

const PEDIDO = 'aaaaaaaa-1111-2222-3333-444444444444';
const OUTRO = 'cccccccc-1111-2222-3333-444444444444';
const CANAL = (p) => `sendbird_gc_cm_${p}_bbbbbbbb-5555-6666-7777-888888888888`;

/** O texto que um roteiro com texto embutido carrega (o JSON entre aspas). */
const textoDoRoteiro = (s, antes) => {
  const i = s.indexOf(antes);
  if (i < 0) return undefined;
  const resto = s.slice(i + antes.length);
  const m = /^("(?:[^"\\]|\\.)*")/.exec(resto);
  return m ? JSON.parse(m[1]) : undefined;
};
const ehApagarSeIgual = (s) => s.includes('apagou: true') && s.includes('c[0].value !== ');
const ehEscreverNoCampo = (s) => s.includes('ocupado: true') && s.includes('definir.call(c[0], ') && !s.includes('apagou');

/**
 * O Gestor de mentira: responde a cada roteiro como a tela de verdade responderia. `topo` é o número que o h1 mostra;
 * `canal` é o que o Gestor "carrega" ao abrir a conversa; o campo guarda o que foi digitado (`rascunho` = texto de alguém
 * que já estava no campo).
 */
function gestorDeMentira({ topo = '3118', canal = CANAL(PEDIDO), cartoes = 1, botaoLiga = true, recarrega = true, rascunho = '' } = {}) {
  const rodados = [];
  let campo = rascunho;
  let canalCarregado = null;
  const pagina = {
    executeJavaScript: async (s) => {
      if (s === R.ABRIR_CARTAO('3118')) return (rodados.push('ABRIR_CARTAO'), cartoes === 1 ? { ok: true } : { ok: false, codigo: 'fora_do_quadro', motivo: 'o pedido não está no quadro do Gestor' });
      if (s === R.ABRIR_CHAT_DO_RESUMO('3118')) {
        rodados.push('ABRIR_CHAT');
        if (recarrega) canalCarregado = { canal, em: Date.now() };
        return { ok: true };
      }
      if (s === R.CONVERSA_ABERTA('3118')) return (rodados.push('CONVERSA'), { campos: 1, topo: topo === '3118' });
      if (s === R.FOCAR_CAMPO) return (rodados.push('FOCAR'), true);
      if (s === R.LER_CAMPO) return (rodados.push('LER'), { campos: 1, valor: campo, botaoLigado: botaoLiga && campo !== '' });
      if (s === R.APAGAR_CAMPO) return (rodados.push('APAGAR'), (campo = ''), true);
      if (ehApagarSeIgual(s)) {
        const t = textoDoRoteiro(s, 'c[0].value !== ');
        rodados.push('APAGAR_SE_IGUAL');
        if (campo !== t) return { ok: campo === '', apagou: false };
        campo = '';
        return { ok: true, apagou: true };
      }
      if (ehEscreverNoCampo(s)) {
        const t = textoDoRoteiro(s, 'definir.call(c[0], ');
        rodados.push('ESCREVER_NO_CAMPO');
        if (campo !== '') return { ok: false, ocupado: true };
        campo = t;
        return { ok: true };
      }
      if (s === R.APERTAR_ENVIAR) return (rodados.push('ENVIAR'), true);
      if (s === R.FECHAR_CONVERSA('3118')) return (rodados.push('FECHAR_CONVERSA'), { ok: true });
      if (s === R.FECHAR_RESUMO) return (rodados.push('FECHAR_RESUMO'), { ok: true });
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
  return { ctx: { pagina, leitor, digitar }, rodados, digitados, eco, campo: () => campo, porNoCampo: (t) => (campo = t) };
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
  assert.equal(r.codigo, 'topo');
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

test('o pedido não está no quadro → para no começo, com o código; número inválido nem tenta', async () => {
  const g = gestorDeMentira({ cartoes: 0 });
  const r = await ensaiar(g.ctx, { numero: '3118', texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.codigo, 'fora_do_quadro');
  assert.match(r.etapas.at(-1), /não está no quadro/);
  const n = await ensaiar(gestorDeMentira().ctx, { numero: '31a8', texto: 'oi' }, { segurarMs: 1 });
  assert.match(n.etapas.at(-1), /algarismos/);
});

test('o botão "Enviar mensagem" não ligou → apaga o texto do programa e para', async () => {
  const g = gestorDeMentira({ botaoLiga: false });
  const r = await ensaiar(g.ctx, { numero: '3118', texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.ok(g.rodados.includes('APAGAR_SE_IGUAL'));
  assert.equal(g.campo(), '');
});

test('v0.4: campo com o RASCUNHO de alguém → o ensaio e o envio não escrevem, não apagam e não apertam (adiar)', async () => {
  for (const fazer of [(c) => ensaiar(c, { numero: '3118', pedidoExterno: PEDIDO, texto: 'oi' }, { segurarMs: 1 }), (c) => enviar(c, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' })]) {
    const g = gestorDeMentira({ rascunho: 'Oi Carine, já' });
    const r = await fazer(g.ctx);
    assert.equal(r.ok, false);
    assert.equal(r.adiar, true);
    assert.equal(r.codigo, 'campo_com_texto');
    assert.equal(g.campo(), 'Oi Carine, já', 'o rascunho ficou intacto');
    assert.deepEqual(g.digitados, []);
    assert.ok(!g.rodados.includes('ENVIAR') && !g.rodados.includes('APAGAR') && !g.rodados.includes('APAGAR_SE_IGUAL'));
  }
});

test('v0.4: apagar só apaga o texto do PROGRAMA — com outro texto no campo (a pessoa digitou junto), não apaga', async () => {
  const g = gestorDeMentira({ botaoLiga: false });
  // a pessoa digita no meio: o campo fica com outra coisa
  g.ctx.digitar = async (t) => g.porNoCampo(`${t} e mais algo`);
  const r = await ensaiar(g.ctx, { numero: '3118', texto: 'oi' }, { segurarMs: 1 });
  assert.equal(r.ok, false);
  assert.equal(g.campo(), 'oi e mais algo', 'o texto misturado com o da pessoa não foi apagado');
});

test('ENVIO: aperta "Enviar" uma vez e só dá por enviado com o eco do chat; sem eco, "incerto"', async () => {
  const g = gestorDeMentira();
  g.eco.m = { id: '777', autor: 'loja' };
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.equal(r.id, '777');
  assert.equal(r.apertou, true);
  assert.equal(g.rodados.filter((x) => x === 'ENVIAR').length, 1);
  const sem = gestorDeMentira();
  const r2 = await enviar(sem.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { ecoMs: 10 });
  assert.equal(r2.ok, false);
  assert.equal(r2.incerto, true);
  assert.equal(r2.apertou, true);
});

test('v0.4: `aoApertar` roda ANTES do clique (o diário do "apertei" nunca chega depois do envio)', async () => {
  const g = gestorDeMentira();
  g.eco.m = { id: '1', autor: 'loja' };
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, {
    aoApertar: async () => {
      g.rodados.push('DIARIO');
    },
  });
  assert.equal(r.ok, true);
  assert.ok(g.rodados.indexOf('DIARIO') >= 0 && g.rodados.indexOf('DIARIO') < g.rodados.indexOf('ENVIAR'), g.rodados.join(','));
});

test('v0.4: a pessoa voltou a mexer (`podeApertar` = não) → não aperta, apaga o texto do programa e devolve adiar', async () => {
  const g = gestorDeMentira();
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { podeApertar: async () => false, aoApertar: async () => g.rodados.push('DIARIO') });
  assert.equal(r.ok, false);
  assert.equal(r.adiar, true);
  assert.equal(r.codigo, 'pessoa');
  assert.ok(!g.rodados.includes('ENVIAR') && !g.rodados.includes('DIARIO'));
  assert.equal(g.campo(), '');
});

test('v0.4: com a conversa aberta, a mensagem já está no HISTÓRICO → não escreve nem aperta; devolve o id achado', async () => {
  const g = gestorDeMentira();
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { jaEstaNoChat: async () => ({ id: '4242' }), aoApertar: async () => g.rodados.push('DIARIO') });
  assert.equal(r.ok, true);
  assert.equal(r.jaEstava, true);
  assert.equal(r.id, '4242');
  assert.deepEqual(g.digitados, []);
  assert.ok(!g.rodados.includes('ENVIAR') && !g.rodados.includes('DIARIO'));
  // não estava: segue o envio normal
  const h = gestorDeMentira();
  h.eco.m = { id: '5', autor: 'loja' };
  const r2 = await enviar(h.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu pedido saiu para entrega!' }, { jaEstaNoChat: async () => null });
  assert.equal(r2.ok, true);
  assert.equal(r2.jaEstava, undefined);
});

test('v0.4: escrever SEM o teclado (o "setter" do envio automático) chega ao mesmo campo e é conferido', async () => {
  const g = gestorDeMentira();
  g.eco.m = { id: '9', autor: 'loja' };
  g.ctx.digitar = (t) => g.ctx.pagina.executeJavaScript(R.ESCREVER_NO_CAMPO(t));
  const r = await enviar(g.ctx, { numero: '3118', pedidoExterno: PEDIDO, texto: 'Seu "pedido" saiu para entrega!' });
  assert.equal(r.ok, true, r.etapas.join(' | '));
  assert.ok(g.rodados.includes('ESCREVER_NO_CAMPO'));
});

test('v0.4: voltar ao quadro fecha a conversa e o resumo pelos roteiros de "Fechar"', async () => {
  const g = gestorDeMentira();
  const v = await voltarAoQuadro(g.ctx.pagina, '3118');
  assert.deepEqual(v, { conversa: { ok: true }, resumo: { ok: true } });
  assert.deepEqual(g.rodados.filter((x) => x.startsWith('FECHAR')), ['FECHAR_CONVERSA', 'FECHAR_RESUMO']);
  const semNumero = gestorDeMentira();
  await voltarAoQuadro(semNumero.ctx.pagina, '31a8');
  assert.ok(!semNumero.rodados.includes('FECHAR_CONVERSA'), 'número inválido não entra no roteiro');
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

test('os roteiros da página compilam — também com aspas, barra e quebra de linha no texto', () => {
  const textoDificil = 'Seu "pedido" saiu \\ agora\n</script> ${x} `crase`';
  for (const [nome, r] of Object.entries(R)) {
    const s = typeof r === 'function' ? r(/APAGAR_SE_IGUAL|ESCREVER/.test(nome) ? textoDificil : '3118') : r;
    assert.doesNotThrow(() => new Function(`return ${s};`), nome);
  }
  assert.equal(textoDoRoteiro(R.ESCREVER_NO_CAMPO(textoDificil), 'definir.call(c[0], '), textoDificil);
});
