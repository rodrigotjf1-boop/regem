'use strict';

// A TELA DO CHAT NO GESTOR — só a ESTRUTURA, para construir o envio (o ensaio: abrir a conversa do pedido certo, escrever
// e conferir) sem chute. Roda DENTRO da página (executeJavaScript), só lê: o campo de digitar (o placeholder, o tipo), os
// botões perto dele (o rótulo de acessibilidade, o título, o texto curto de botão) e o topo da conversa com as LETRAS
// trocadas por "x" (o "#9902 Xxxxx Xxxxx" mostra a forma — número do pedido e nome — sem o nome). Nada de texto de mensagem.

/** O código que roda na página: devolve o resumo da conversa aberta (ou null, sem campo de digitar visível). */
const LER_A_TELA = `(() => {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const mascara = (t) => String(t || '').replace(/[A-Za-zÀ-ÿ]/g, 'x').replace(/\\s+/g, ' ').trim().slice(0, 80);
  const classes = (el) => String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(/\\s+/).filter(Boolean).slice(0, 4);
  const caminho = (el) => {
    const p = [];
    for (let x = el, i = 0; x && x !== document.body && i < 6; x = x.parentElement, i++) p.push(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (classes(x).length ? '.' + classes(x).join('.') : ''));
    return p.reverse().join(' > ');
  };
  const campos = [...document.querySelectorAll('textarea, input[type=text], input:not([type]), [contenteditable="true"]')].filter(visivel);
  const doChat = campos.filter((c) => /mensagem|message|digite/i.test((c.getAttribute('placeholder') || '') + (c.getAttribute('aria-label') || '') + (c.getAttribute('data-placeholder') || '')));
  if (!doChat.length) return null;
  const campo = doChat[0];
  // o painel da conversa: o ancestral que tem o campo e algum cabeçalho
  let painel = campo;
  for (let i = 0; i < 10 && painel.parentElement; i++) { painel = painel.parentElement; if (painel.querySelector('h1, h2, h3, h4, header')) break; }
  const botoes = [...painel.querySelectorAll('button, [role=button]')].filter(visivel).slice(0, 30).map((b) => ({
    rotulo: b.getAttribute('aria-label') || null,
    titulo: b.getAttribute('title') || null,
    texto: mascara(b.innerText), // a forma só (um botão pode trazer o nome do cliente)
    testid: b.getAttribute('data-testid') || null,
    temIcone: !!b.querySelector('svg, img'),
    desligado: b.disabled === true || b.getAttribute('aria-disabled') === 'true',
    perto: (() => { const a = b.getBoundingClientRect(), c = campo.getBoundingClientRect(); return Math.abs(a.top - c.top) < 80; })(),
  }));
  const topo = [...painel.querySelectorAll('h1, h2, h3, h4, header')].filter(visivel).slice(0, 4).map((h) => ({ tag: h.tagName.toLowerCase(), forma: mascara(h.innerText) }));
  // onde aparece "#<número do pedido>" (o topo da conversa): o elemento com texto PRÓPRIO assim (letras mascaradas)
  const comNumero = [...document.querySelectorAll('body *')].filter((el) => visivel(el) && [...el.childNodes].some((n) => n.nodeType === 3 && /#\\s?\\d{3,6}/.test(n.textContent))).slice(0, 6).map((el) => ({ tag: el.tagName.toLowerCase(), forma: mascara(el.innerText), caminho: caminho(el), noPainel: painel.contains(el) }));
  return {
    url: location.pathname,
    campo: { tag: campo.tagName.toLowerCase(), tipo: campo.getAttribute('type'), placeholder: campo.getAttribute('placeholder'), rotulo: campo.getAttribute('aria-label'), editavel: campo.isContentEditable, testid: campo.getAttribute('data-testid'), caminho: caminho(campo) },
    botoes,
    topo,
    comNumero,
    painel: caminho(painel),
  };
})()`;

/**
 * O QUADRO DE PEDIDOS: como achar o cartão de um pedido pelo número (o texto próprio de 4 dígitos) e o que se clica nele, e
 * os botões que abrem o chat (rótulo com chat/conversa/mensagem). Só a forma: letras mascaradas, números ficam.
 */
const LER_O_QUADRO = `(() => {
  const visivel = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const mascara = (t) => String(t || '').replace(/[A-Za-zÀ-ÿ]/g, 'x').replace(/\\s+/g, ' ').trim().slice(0, 60);
  const classes = (el) => String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').split(/\\s+/).filter(Boolean).slice(0, 4);
  const caminho = (el) => {
    const p = [];
    for (let x = el, i = 0; x && x !== document.body && i < 6; x = x.parentElement, i++) p.push(x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + (classes(x).length ? '.' + classes(x).join('.') : ''));
    return p.reverse().join(' > ');
  };
  const clicavel = (el) => { for (let x = el, i = 0; x && i < 8; x = x.parentElement, i++) { if (x.matches('button, a, [role=button], [tabindex]') || getComputedStyle(x).cursor === 'pointer') return x; } return null; };
  const numeros = [...document.querySelectorAll('body *')].filter((el) => visivel(el) && [...el.childNodes].some((n) => n.nodeType === 3 && /^\\s*\\d{4}\\s*$/.test(n.textContent))).slice(0, 3).map((el) => {
    const c = clicavel(el);
    return { tag: el.tagName.toLowerCase(), caminho: caminho(el), clicavel: c ? { tag: c.tagName.toLowerCase(), papel: c.getAttribute('role'), caminho: caminho(c) } : null };
  });
  const doChat = [...document.querySelectorAll('button, a, [role=button]')].filter((b) => visivel(b) && /chat|convers|mensag/i.test((b.getAttribute('aria-label') || '') + ' ' + (b.getAttribute('title') || '') + ' ' + (b.getAttribute('data-testid') || ''))).slice(0, 8).map((b) => ({ tag: b.tagName.toLowerCase(), rotulo: b.getAttribute('aria-label'), titulo: b.getAttribute('title'), testid: b.getAttribute('data-testid'), forma: mascara(b.innerText), caminho: caminho(b) }));
  // O ÚLTIMO BOTÃO CLICADO pela pessoa (só observa o clique — não muda nada): o rótulo, o identificador de teste, se tem
  // ícone e o caminho; o texto, mascarado. É assim que se descobre o botão de chat do resumo do pedido, que não tem rótulo.
  if (!window.__ponteObservaClique) {
    window.__ponteObservaClique = true;
    document.addEventListener('click', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('button, a, [role=button]') : null;
      if (!b) return;
      window.__ponteUltimoClique = { em: Date.now(), tag: b.tagName.toLowerCase(), rotulo: b.getAttribute('aria-label'), titulo: b.getAttribute('title'), testid: b.getAttribute('data-testid'), temIcone: !!b.querySelector('svg, img'), forma: mascara(b.innerText), caminho: caminho(b) };
    }, true);
  }
  return { url: location.pathname, cartoes: numeros, botoesDeChat: doChat, ultimoClique: window.__ponteUltimoClique || null };
})()`;

/**
 * Lê a tela de TODOS os quadros da janela (o chat pode estar num iframe) e devolve o primeiro resumo achado — ou null.
 * @param {Electron.WebContents} wc
 */
async function lerATelaDoChat(wc) {
  const quadros = [wc.mainFrame, ...wc.mainFrame.framesInSubtree.filter((f) => f !== wc.mainFrame)];
  for (const q of quadros) {
    try {
      const r = await q.executeJavaScript(LER_A_TELA);
      if (r) return { quadro: q === wc.mainFrame ? 'principal' : 'iframe', ...r };
    } catch {
      /* quadro fechando ou de outra origem: segue */
    }
  }
  return null;
}

/** O quadro de pedidos (da janela principal): os cartões pelo número e os botões que abrem o chat. */
async function lerOQuadro(wc) {
  try {
    return await wc.mainFrame.executeJavaScript(LER_O_QUADRO);
  } catch {
    return null;
  }
}

module.exports = { lerATelaDoChat, lerOQuadro, LER_A_TELA, LER_O_QUADRO };
