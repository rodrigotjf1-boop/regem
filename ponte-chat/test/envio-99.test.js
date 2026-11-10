'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { enviar, voltar, avaliarTela, ROTEIROS: R } = require('../src/envio-99');

const NUM = '900003';
const EXT = '9100000000000003441';
const RAPIDO = { buscaMs: 300, gavetaMs: 300, cliqueMs: 200, campoMs: 400, ecoMs: 300 };

/** O texto que um roteiro carrega (o JSON entre aspas depois de `antes`). */
const textoDoRoteiro = (s, antes) => {
  const i = s.indexOf(antes);
  if (i < 0) return undefined;
  const m = /^("(?:[^"\\]|\\.)*")/.exec(s.slice(i + antes.length));
  return m ? JSON.parse(m[1]) : undefined;
};

/**
 * A 99 de mentira: responde aos roteiros como o portal de 06/11. `achaPedido` (a busca acha), `numeroDaConversa` (o
 * número que a gaveta mostra), `cliquesPerdidos`, `campoDepois` (leituras até o campo aparecer), `rascunho` (texto de
 * alguém no campo), `enviarLiga` (o "Enviar" liga com texto), `eco` (a confirmação chega).
 */
function noventaDeMentira({ achaPedido = true, numeroDaConversa = `#${NUM}`, cliquesPerdidos = 0, campoDepois = 0, rascunho = '', enviarLiga = true, eco = true, busca = '', aba = 'Preparando', balaoTapado = 0, resumoDeOutro = false } = {}) {
  const rodados = [];
  const cdp = [];
  const s = { busca, aba, gaveta: false, campo: rascunho, voltasCampo: campoDepois, cliques: 0, enviou: [], balaoTapado };
  const pagina = {
    executeJavaScript: async (js) => {
      if (js === R.ESTADO_DA_TELA) return { vigia: true, acaoEm: 0, vigiaDesde: 0, portal: true, gaveta: s.gaveta, gavetaNumero: s.gaveta ? numeroDaConversa : '', campoComTexto: s.campo !== '', busca: s.busca, aba: s.aba, painel: null };
      if (js === R.BUSCAR(NUM)) return (rodados.push('BUSCAR'), (s.busca = NUM), { ok: true });
      if (js === R.PEDIDO_NA_BUSCA(NUM)) return (rodados.push('NA_BUSCA'), achaPedido ? { achou: true, vazio: false, painel: `#${NUM}` } : { achou: false, vazio: true, painel: null });
      if (js === R.BALAO(NUM)) {
        rodados.push('BALAO');
        // 07/11: o painel ainda entrando logo depois da busca — "há algo na frente" nas primeiras conferências
        if (resumoDeOutro) return { ok: false, motivo: 'o resumo aberto não é deste pedido' };
        if (s.balaoTapado > 0) return (s.balaoTapado--, { ok: false, motivo: 'há algo na frente do botão do chat' });
        return { ok: true, x: 1152, y: 316 };
      }
      if (js === R.GAVETA_ABERTA) {
        rodados.push('GAVETA');
        if (!s.gaveta) return { aberta: false };
        let campo = true;
        if (s.voltasCampo > 0) {
          s.voltasCampo--;
          campo = false;
        }
        return { aberta: true, numero: numeroDaConversa, campo, valor: s.campo, enviar: true, enviarLigado: enviarLiga && s.campo !== '' };
      }
      const escrito = textoDoRoteiro(js, 'definir.call(c, ');
      if (js.includes('ocupado: true') && escrito !== undefined) {
        rodados.push('ESCREVER');
        if (s.campo !== '') return { ok: false, ocupado: true, motivo: 'há um texto no campo da conversa (de alguém da loja)' };
        s.campo = escrito;
        return { ok: true };
      }
      if (js.includes('apagou: true')) {
        rodados.push('APAGAR');
        const t = textoDoRoteiro(js, 'c.value !== ');
        if (s.campo !== t) return { ok: s.campo === '', apagou: false };
        s.campo = '';
        return { ok: true, apagou: true };
      }
      if (js === R.APERTAR_ENVIAR) {
        rodados.push('ENVIAR');
        if (!enviarLiga || s.campo === '') return false;
        s.enviou.push(s.campo);
        s.campo = '';
        return true;
      }
      if (js === R.VOLTAR) return (rodados.push('VOLTAR'), s.gaveta ? { x: 660, y: 32 } : null);
      if (js === R.LIMPAR_BUSCA) return (rodados.push('LIMPAR_BUSCA'), s.busca ? ((s.busca = ''), { ok: true, limpou: true }) : { ok: true, limpou: false });
      if (js === R.ABA('Entregando')) return (rodados.push('ABA'), { x: 260, y: 93 });
      if (js === R.CLIQUE_DO_PROGRAMA) return (cdp.push(['AVISO_AO_VIGIA']), true);
      throw new Error(`roteiro desconhecido: ${js.slice(0, 80)}`);
    },
  };
  const cdpFn = async (metodo, p) => {
    cdp.push([metodo, p && p.type, p && p.x, p && p.y]);
    if (metodo === 'Input.dispatchMouseEvent' && p.type === 'mouseReleased') {
      if (p.x === 1152) {
        s.cliques++;
        if (s.cliques > cliquesPerdidos) s.gaveta = true;
      }
      if (p.x === 660) s.gaveta = false;
      if (p.x === 260) s.aba = 'Entregando';
    }
    return {};
  };
  const leitor = { esperarEco: async () => (eco ? { id: '920000000000000034' } : null) };
  return { ctx: { pagina, cdp: cdpFn, leitor }, rodados, cdp, s };
}

test('envia: busca, confere o resumo e a conversa, clica de MOUSE no balão, escreve, aperta "Enviar" e a 99 confirma', async () => {
  const f = noventaDeMentira();
  const apertou = [];
  const r = await enviar(f.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Seu pedido saiu!' }, { ...RAPIDO, aoApertar: async () => apertou.push(Date.now()) });
  assert.equal(r.ok, true, JSON.stringify(r.etapas));
  assert.equal(r.id, '920000000000000034');
  assert.deepEqual(f.s.enviou, ['Seu pedido saiu!']);
  assert.equal(apertou.length, 1);
  // o balão foi pelo MOUSE do depurador (o `click()` não abre a conversa da 99)
  assert.deepEqual(f.cdp.filter((c) => c[2] === 1152).map((c) => c[1]), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  // e o vigia da tela foi avisado ANTES do clique (senão o programa se acharia uma pessoa mexendo)
  const i = f.cdp.findIndex((c) => c[2] === 1152);
  assert.deepEqual(f.cdp[i - 1], ['AVISO_AO_VIGIA']);
  assert.deepEqual(f.rodados.slice(0, 4), ['GAVETA', 'BUSCAR', 'NA_BUSCA', 'BALAO']);
});

test('o vigia da tela não conta o clique do programa (avisado antes), mas conta o da pessoa', () => {
  const { INSTALAR_VIGIA } = require('../src/tela-livre');
  const ouvintes = {};
  const window = { addEventListener: (t, f) => (ouvintes[t] = f) };
  new Function('window', `return ${INSTALAR_VIGIA}`)(window);
  window.__ponteVigiaDesde = 0;
  window.__ponteCliqueAte = Date.now() + 800; // o programa avisou (CLIQUE_DO_PROGRAMA)
  ouvintes.mousedown({ isTrusted: true });
  assert.equal(window.__ponteAcaoEm, 0);
  window.__ponteCliqueAte = Date.now() - 1; // passou a janela do aviso: é gente
  ouvintes.mousedown({ isTrusted: true });
  assert.ok(window.__ponteAcaoEm > 0);
  assert.equal(new Function('window', `${R.CLIQUE_DO_PROGRAMA.replace('window.', 'return window.').replace('; true', '')}`)({}) > Date.now(), true);
});

test('a busca não acha o pedido (já saiu da lista de em andamento): definitivo, nada escrito', async () => {
  const f = noventaDeMentira({ achaPedido: false });
  const r = await enviar(f.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r.ok, r.codigo, r.definitivo], [false, 'sem_pedido', true]);
  assert.ok(!f.rodados.includes('ESCREVER') && !f.rodados.includes('BALAO'));
});

test('a conversa aberta é de OUTRO pedido: para NA HORA (sem esperar ela carregar), não escreve, e pede para fechar a gaveta', async () => {
  // a conversa nunca termina de carregar: se o programa esperasse o campo antes de conferir o número, levaria o prazo inteiro
  const f = noventaDeMentira({ numeroDaConversa: '#900009', campoDepois: 1000 });
  const inicio = Date.now();
  const r = await enviar(f.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, campoMs: 3000 });
  assert.deepEqual([r.ok, r.codigo, r.fecharGaveta], [false, 'numero_errado', true]);
  assert.ok(Date.now() - inicio < 1500, `parou em ${Date.now() - inicio} ms`);
  assert.ok(!f.rodados.includes('ESCREVER'));
});

test('o painel ainda entrando (algo na frente do balão, 07/11): confere de novo e clica; tapado até o prazo, para sem clicar', async () => {
  // o que acontecia na 99 de verdade: "há algo na frente" logo depois da busca, livre 2,5 s depois — a ponte desistia
  const passa = noventaDeMentira({ balaoTapado: 3 });
  const r = await enviar(passa.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, balaoMs: 3000 });
  assert.equal(r.ok, true);
  assert.equal(passa.rodados.filter((x) => x === 'BALAO').length, 4);
  assert.equal(passa.s.cliques, 1);
  const tapado = noventaDeMentira({ balaoTapado: 1000 });
  const r2 = await enviar(tapado.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, balaoMs: 700 });
  assert.deepEqual([r2.ok, r2.codigo, tapado.s.cliques], [false, 'balao', 0]);
  assert.ok(!tapado.rodados.includes('ESCREVER'));
  // o resumo de OUTRO pedido não é passageiro: para na hora, sem esperar o prazo
  const outro = noventaDeMentira({ resumoDeOutro: true });
  const inicio = Date.now();
  const r3 = await enviar(outro.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, balaoMs: 3000 });
  assert.deepEqual([r3.ok, r3.codigo, outro.s.cliques], [false, 'balao', 0]);
  assert.ok(Date.now() - inicio < 1000, `parou em ${Date.now() - inicio} ms`);
});

test('o 1º clique no balão se perde: clica de novo UMA vez; perdido duas vezes, para', async () => {
  const uma = noventaDeMentira({ cliquesPerdidos: 1 });
  assert.equal((await enviar(uma.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO)).ok, true);
  assert.equal(uma.s.cliques, 2);
  const duas = noventaDeMentira({ cliquesPerdidos: 2 });
  const r = await enviar(duas.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r.ok, r.codigo, duas.s.cliques], [false, 'gaveta', 2]);
});

test('o campo demora a aparecer (a conversa carregando): espera; sem ele no prazo, não escreve', async () => {
  const lenta = noventaDeMentira({ campoDepois: 1 });
  assert.equal((await enviar(lenta.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO)).ok, true);
  const nunca = noventaDeMentira({ campoDepois: 1000 });
  const r = await enviar(nunca.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r.ok, r.codigo], [false, 'sem_campo']);
  assert.ok(!nunca.rodados.includes('ESCREVER'));
});

test('texto de alguém no campo: não mexe (adia); o "Enviar" não liga: apaga o texto do programa', async () => {
  const ocupado = noventaDeMentira({ rascunho: 'resposta da Ana' });
  const r = await enviar(ocupado.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r.ok, r.adiar, r.codigo, ocupado.s.campo], [false, true, 'campo_com_texto', 'resposta da Ana']);
  const semBotao = noventaDeMentira({ enviarLiga: false });
  const r2 = await enviar(semBotao.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r2.ok, r2.codigo, semBotao.s.campo], [false, 'escrever', '']);
});

test('alguém mexeu antes de apertar: apaga e adia; já estava na conversa: não escreve; sem confirmação: incerto', async () => {
  const pessoa = noventaDeMentira();
  const r = await enviar(pessoa.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, podeApertar: async () => false });
  assert.deepEqual([r.ok, r.adiar, r.codigo, pessoa.s.campo, pessoa.s.enviou.length], [false, true, 'pessoa', '', 0]);
  const ja = noventaDeMentira();
  const r2 = await enviar(ja.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, { ...RAPIDO, jaEstaNoChat: async () => ({ id: 'x1' }) });
  assert.deepEqual([r2.ok, r2.jaEstava, r2.id, ja.rodados.includes('ESCREVER')], [true, true, 'x1', false]);
  const semEco = noventaDeMentira({ eco: false });
  const r3 = await enviar(semEco.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  assert.deepEqual([r3.ok, r3.incerto, r3.apertou], [false, true, true]);
});

test('voltar: fecha a conversa pelo voltar, limpa a busca do programa e volta à aba que estava', async () => {
  const f = noventaDeMentira();
  await enviar(f.ctx, { numero: NUM, pedidoExterno: EXT, texto: 'Oi' }, RAPIDO);
  f.s.aba = 'Preparando';
  const v = await voltar(f.ctx, { busca: '', aba: 'Entregando' });
  assert.deepEqual(v, { gaveta: true, busca: true, aba: true });
  assert.deepEqual([f.s.gaveta, f.s.busca, f.s.aba], [false, '', 'Entregando']);
  // a busca que já estava (de alguém): não limpa
  const g = noventaDeMentira({ busca: '123' });
  assert.equal((await voltar(g.ctx, { busca: '123', aba: 'Preparando' })).busca, false);
});

test('a tela livre: o portal na lista, nenhuma conversa aberta, campo e busca vazios, ninguém mexendo', () => {
  const base = { vigia: true, acaoEm: 0, vigiaDesde: 0, portal: true, gaveta: false, campoComTexto: false, busca: '' };
  const agora = 100000;
  assert.deepEqual(avaliarTela(base, { agora }), { ok: true });
  assert.match(avaliarTela({ ...base, gaveta: true }, { agora }).motivo, /conversa aberta/);
  assert.match(avaliarTela({ ...base, campoComTexto: true }, { agora }).motivo, /texto no campo/);
  assert.match(avaliarTela({ ...base, busca: '43' }, { agora }).motivo, /buscando/);
  assert.match(avaliarTela({ ...base, portal: false }, { agora }).motivo, /lista de pedidos/);
  assert.match(avaliarTela({ ...base, acaoEm: agora - 2000 }, { agora }).motivo, /usando a 99/);
  assert.match(avaliarTela(base, { agora, ultimaTeclaEm: agora - 1000 }).motivo, /usando a 99/);
  assert.equal(avaliarTela(null).ok, false);
});

test('o "Enviar" é o da GAVETA, pela classe dele e pelo texto exato — nunca o "Cheguei" do resumo', () => {
  assert.ok(R.APERTAR_ENVIAR.includes("button.im-chat-window-edit-btn"));
  assert.ok(R.APERTAR_ENVIAR.includes("=== 'Enviar'"));
  assert.ok(R.APERTAR_ENVIAR.includes('const g = '));
  assert.ok(!/footer-btn|Cheguei/.test(R.APERTAR_ENVIAR));
});

/**
 * O roteiro do balão rodando de verdade num documento de mentira: o botão do chat do resumo, a notificação da 99 na
 * frente dele (a "verifique sua conexão de internet", fixa no canto de cima — 06–09/11) e outra peça qualquer.
 */
function documentoDoBalao({ naFrente }) {
  const caixa = (x, y, w, h) => () => ({ x, y, width: w, height: h });
  const painel = { textContent: `#${NUM}` };
  const botao = { getBoundingClientRect: caixa(100, 100, 20, 20), contains: (el) => el === botao };
  const fecharClicado = { n: 0 };
  const notificacao = { closest: () => notificacao };
  const xis = {};
  notificacao.querySelector = (sel) => (sel === '.pb-notification__closeBtn' ? xis : null);
  const textoDaNotificacao = { tagName: 'SPAN', className: 'pb-notification__content', closest: (sel) => (sel === '.pb-notification' ? notificacao : null) };
  const outraPeca = { tagName: 'DIV', className: 'mascara-de-modal grande extra mais', closest: () => null };
  let topo = naFrente === 'notificacao' ? textoDaNotificacao : naFrente === 'outra' ? outraPeca : botao;
  xis.click = () => {
    fecharClicado.n += 1;
    topo = botao; // fechou: o botão fica livre
  };
  const document = {
    querySelector: (sel) => (sel === 'main.order-container__detail .index-number' ? painel : null),
    querySelectorAll: (sel) => (sel.includes('.receiver-info__chat-action') ? [botao] : []),
    elementFromPoint: () => topo,
  };
  const rodar = () =>
    new Function('document', 'getComputedStyle', 'innerWidth', 'innerHeight', `return ${R.BALAO(NUM)}`)(document, () => ({ visibility: 'visible', display: 'block' }), 1000, 800);
  return { rodar, fecharClicado };
}

test('a notificação da 99 na frente do botão do chat: fecha no X dela e, na conferência seguinte, o botão está livre', () => {
  const d = documentoDoBalao({ naFrente: 'notificacao' });
  const r1 = d.rodar();
  assert.deepEqual([r1.ok, r1.fechouAviso, d.fecharClicado.n], [false, true, 1]);
  assert.match(r1.motivo, /fechei uma notificação da 99/);
  assert.deepEqual(d.rodar(), { ok: true, x: 110, y: 110 });
  assert.equal(d.fecharClicado.n, 1);
});

test('outra peça na frente do botão do chat: não clica nem fecha nada, e o motivo diz QUAL peça (só a tag e as classes)', () => {
  const d = documentoDoBalao({ naFrente: 'outra' });
  const r = d.rodar();
  assert.equal(r.ok, false);
  assert.equal(d.fecharClicado.n, 0);
  assert.equal(r.motivo, 'há algo na frente do botão do chat (div.mascara-de-modal.grande.extra)');
  assert.deepEqual(documentoDoBalao({ naFrente: 'nada' }).rodar(), { ok: true, x: 110, y: 110 });
});
