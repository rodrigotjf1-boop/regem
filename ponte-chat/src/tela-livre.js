'use strict';

// A TELA DO GESTOR ESTÁ LIVRE? (v0.4) — o programa digita na MESMA tela que a pessoa da loja usa: só mexe com ela parada.
// Um vigia na página anota a hora da última ação DE GENTE (tecla, clique, rolagem, toque — `isTrusted`; o clique e o
// texto que o programa põe não contam: `element.click()` não é "de gente" e o texto do programa não gera tecla). Livre =
// o Gestor está no quadro "Pedidos" (há cartões), nenhum "Campo de mensagem" tem texto (o rascunho de alguém) e ninguém
// mexeu há `paradaMs` (pela página e pelo teclado da janela, que o Electron conta à parte).

const INSTALAR_VIGIA = `(() => {
  if (!window.__ponteVigia) {
    window.__ponteVigia = true;
    window.__ponteAcaoEm = 0;
    window.__ponteVigiaDesde = Date.now(); // o que houve antes do vigia ninguém viu: conta como "mexeram agora"
    // o clique de MOUSE do próprio programa (a 99 só abre o chat com clique de verdade — 4b) avisa antes: não é gente
    const marcar = (e) => { if (e.isTrusted && !(window.__ponteCliqueAte > Date.now())) window.__ponteAcaoEm = Date.now(); };
    for (const t of ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(t, marcar, true);
  }
  return true;
})()`;

// O item "Pedidos" do menu lateral do Gestor: o botão cujo rótulo (o balão ligado por `aria-labelledby`) é "Pedidos". Com
// ele marcado como a página atual (`aria-current="page"`), o Gestor está em "Pedidos" (com ou sem cartões).
const ITEM_PEDIDOS = `[...document.querySelectorAll('[data-testid="action-button"][aria-labelledby]')].find((b) => {
    const r = document.getElementById(b.getAttribute('aria-labelledby'));
    return !!r && String(r.textContent || '').trim() === 'Pedidos';
  })`;

const ESTADO_DA_TELA = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cartoes = [...document.querySelectorAll('.kanban-column button')].filter(vis).length;
  const campoComTexto = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].some((c) => c.value !== '');
  const item = ${ITEM_PEDIDOS};
  // a página, só o começo do endereço ("#/home/merchant-dashboard") — sequência longa de dígitos/hex (um id) vira "…"
  const pagina = String(location.hash || '').split('?')[0].split('/').slice(0, 3).join('/').replace(/[0-9a-f-]{8,}/gi, '…').slice(0, 40);
  return { vigia: !!window.__ponteVigia, acaoEm: window.__ponteAcaoEm || 0, vigiaDesde: window.__ponteVigiaDesde || 0, cartoes, campoComTexto,
    itemPedidos: !!item, noPedidos: !!item && item.getAttribute('aria-current') === 'page', pagina };
})()`;

// Clica no item "Pedidos" do menu (`element.click()`: não conta como gente no vigia). Só navegação — não aceita pedido nem
// mexe na abertura da loja. Já em "Pedidos" ou sem o item: não clica.
const ABRIR_PEDIDOS = `(() => {
  const item = ${ITEM_PEDIDOS};
  if (!item || item.getAttribute('aria-current') === 'page') return false;
  item.click();
  return true;
})()`;

/**
 * A regra (pura, testável): { ok } ou { ok: false, motivo } em português.
 * @param {{ vigia: boolean, acaoEm: number, vigiaDesde: number, cartoes: number, campoComTexto: boolean } | null} e
 */
function avaliarTela(e, { agora = Date.now(), ultimaTeclaEm = 0, paradaMs = 10000 } = {}) {
  if (!e) return { ok: false, motivo: 'a página do Gestor não respondeu' };
  if (!e.vigia) return { ok: false, motivo: 'o vigia da tela ainda não está na página do Gestor' };
  if (!e.cartoes) return { ok: false, motivo: e.noPedidos ? 'o quadro "Pedidos" está sem cartões' : 'o Gestor não está no quadro "Pedidos"' };
  if (e.campoComTexto) return { ok: false, motivo: 'há um texto no campo de mensagem (de alguém da loja)' };
  const ultima = Math.max(Number(e.acaoEm) || 0, Number(e.vigiaDesde) || 0, Number(ultimaTeclaEm) || 0);
  if (agora - ultima < paradaMs) return { ok: false, motivo: 'alguém está usando o Gestor agora' };
  return { ok: true };
}

/**
 * Voltar o Gestor ao quadro "Pedidos"? (v0.7.5 — ERR-418) Ao reiniciar, o Gestor abre em "Início" e a fila de saída ficava
 * esperando alguém clicar em "Pedidos" (09/11: 5 min parada até o clique). Volta sozinho só quando: o vigia está na página,
 * o item "Pedidos" existe e não é a página atual, não há rascunho no campo, ninguém mexe há `voltarMs` (bem mais que a
 * parada do envio: quem olha outra página do Gestor tem tempo) e a última volta foi há `voltarMs` ou mais (se o clique não
 * levou, não insiste a cada volta da fila).
 */
function deveVoltarAoQuadro(e, { agora = Date.now(), ultimaTeclaEm = 0, ultimaVoltaEm = 0, voltarMs = 60000 } = {}) {
  if (!e || !e.vigia || !e.itemPedidos || e.noPedidos || e.campoComTexto) return false;
  const ultima = Math.max(Number(e.acaoEm) || 0, Number(e.vigiaDesde) || 0, Number(ultimaTeclaEm) || 0);
  return agora - ultima >= voltarMs && agora - (Number(ultimaVoltaEm) || 0) >= voltarMs;
}

/** Alguém mexeu na tela de `desde` em diante? (a última conferência antes de apertar "Enviar") */
function mexeuDesde(e, desde, ultimaTeclaEm = 0) {
  if (!e) return true; // sem saber, não aperta
  return Math.max(Number(e.acaoEm) || 0, Number(ultimaTeclaEm) || 0) >= desde;
}

module.exports = { INSTALAR_VIGIA, ESTADO_DA_TELA, ABRIR_PEDIDOS, avaliarTela, deveVoltarAoQuadro, mexeuDesde };
