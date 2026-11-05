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
    const marcar = (e) => { if (e.isTrusted) window.__ponteAcaoEm = Date.now(); };
    for (const t of ['keydown', 'mousedown', 'pointerdown', 'wheel', 'touchstart']) window.addEventListener(t, marcar, true);
  }
  return true;
})()`;

const ESTADO_DA_TELA = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const cartoes = [...document.querySelectorAll('.kanban-column button')].filter(vis).length;
  const campoComTexto = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].some((c) => c.value !== '');
  return { vigia: !!window.__ponteVigia, acaoEm: window.__ponteAcaoEm || 0, vigiaDesde: window.__ponteVigiaDesde || 0, cartoes, campoComTexto };
})()`;

/**
 * A regra (pura, testável): { ok } ou { ok: false, motivo } em português.
 * @param {{ vigia: boolean, acaoEm: number, vigiaDesde: number, cartoes: number, campoComTexto: boolean } | null} e
 */
function avaliarTela(e, { agora = Date.now(), ultimaTeclaEm = 0, paradaMs = 10000 } = {}) {
  if (!e) return { ok: false, motivo: 'a página do Gestor não respondeu' };
  if (!e.vigia) return { ok: false, motivo: 'o vigia da tela ainda não está na página do Gestor' };
  if (!e.cartoes) return { ok: false, motivo: 'o Gestor não está no quadro "Pedidos"' };
  if (e.campoComTexto) return { ok: false, motivo: 'há um texto no campo de mensagem (de alguém da loja)' };
  const ultima = Math.max(Number(e.acaoEm) || 0, Number(e.vigiaDesde) || 0, Number(ultimaTeclaEm) || 0);
  if (agora - ultima < paradaMs) return { ok: false, motivo: 'alguém está usando o Gestor agora' };
  return { ok: true };
}

/** Alguém mexeu na tela de `desde` em diante? (a última conferência antes de apertar "Enviar") */
function mexeuDesde(e, desde, ultimaTeclaEm = 0) {
  if (!e) return true; // sem saber, não aperta
  return Math.max(Number(e.acaoEm) || 0, Number(ultimaTeclaEm) || 0) >= desde;
}

module.exports = { INSTALAR_VIGIA, ESTADO_DA_TELA, avaliarTela, mexeuDesde };
