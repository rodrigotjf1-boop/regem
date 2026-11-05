'use strict';

// O LEITOR DO CHAT: liga o depurador do Chromium na página do Gestor do iFood (o mesmo jeito da janela de teste da
// descoberta, 04/11/2026) e lê os quadros do WebSocket do CHAT (Sendbird) — também os de iframes e workers (auto-attach).
// Só LÊ: não envia nada, não clica em nada. Cada mensagem nova (o msg_id; a mesma chega por mais de uma conexão) vai para
// `aoChegar`; o diagnóstico recebe a forma (sem texto) e os corpos das chamadas do chat do pedido.

const { lerQuadro, mensagemDoQuadro, Vistos } = require('./sendbird');
const { interessa } = require('./diagnostico');

/** O WebSocket do chat (`REGEM_PONTE_CHAT_WS` troca no teste com o chat de mentira). */
function filtroDoChat(env = process.env) {
  try {
    return new RegExp(env.REGEM_PONTE_CHAT_WS || 'sendbird\\.com', 'i');
  } catch {
    return /sendbird\.com/i;
  }
}

/**
 * @param {Electron.WebContents} wc
 * @param {{ aoChegar: (m: object) => void, aoMudarChat?: () => void, diagnostico?: import('./diagnostico').Diagnostico, registrarErro?: (s: string) => void }} o
 */
function ligarLeitor(wc, { aoChegar, aoMudarChat, diagnostico, registrarErro }) {
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (e) {
    if (registrarErro) registrarErro(`não deu para ler a página do Gestor: ${e && e.message}`);
    return null;
  }
  const filtro = filtroDoChat();
  const sockets = new Map(); // `${sessão}|${requestId}` → endereço (só os do chat)
  const corpos = new Map();
  const vistos = new Vistos();
  let ultimoLogi = 0;
  const avisar = () => {
    if (aoMudarChat) aoMudarChat();
  };
  const preparar = (sid) => {
    dbg.sendCommand('Network.enable', {}, sid).catch(() => {});
    dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {});
  };
  preparar(undefined);
  dbg.on('detach', (_e, motivo) => {
    sockets.clear();
    avisar();
    if (registrarErro) registrarErro(`a leitura do Gestor parou (${motivo})`);
  });
  dbg.on('message', (_e, metodo, p, sid) => {
    try {
      const chave = (id) => `${sid || ''}|${id}`;
      if (metodo === 'Target.attachedToTarget') {
        preparar(p.sessionId);
        return;
      }
      if (metodo === 'Network.webSocketCreated') {
        if (filtro.test(p.url || '')) {
          sockets.set(chave(p.requestId), p.url);
          avisar();
        }
        return;
      }
      if (metodo === 'Network.webSocketClosed') {
        if (sockets.delete(chave(p.requestId))) avisar();
        return;
      }
      if (metodo === 'Network.webSocketFrameReceived') {
        if (!sockets.has(chave(p.requestId))) return;
        const q = lerQuadro(p.response && p.response.payloadData);
        if (!q) return;
        if (q.cmd === 'LOGI') {
          if (q.corpo && !q.corpo.error) {
            ultimoLogi = Date.now();
            avisar();
          }
          return;
        }
        if (q.cmd !== 'MESG') return;
        const m = mensagemDoQuadro(q);
        if (!m || !vistos.novo(m.id)) return;
        if (diagnostico) diagnostico.mesg(q.corpo);
        aoChegar(m);
        return;
      }
      if (!diagnostico) return;
      if (metodo === 'Network.responseReceived') {
        const r = p.response || {};
        if ((p.type === 'XHR' || p.type === 'Fetch') && /json/i.test(r.mimeType || '') && interessa(r.url || '')) corpos.set(chave(p.requestId), { url: r.url, sid });
        return;
      }
      if (metodo === 'Network.loadingFinished' && corpos.has(chave(p.requestId))) {
        const { url, sid: s } = corpos.get(chave(p.requestId));
        corpos.delete(chave(p.requestId));
        dbg
          .sendCommand('Network.getResponseBody', { requestId: p.requestId }, s)
          .then((b) => {
            const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            if (!txt || txt.length > 2000000) return;
            let j;
            try {
              j = JSON.parse(txt);
            } catch {
              return;
            }
            diagnostico.resposta(url, j);
          })
          .catch(() => {});
      }
    } catch (e) {
      if (registrarErro) registrarErro(String((e && e.message) || e));
    }
  });
  return {
    chatAberto: () => sockets.size > 0,
    ultimoLogi: () => ultimoLogi,
  };
}

module.exports = { ligarLeitor, filtroDoChat };
