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
  const ouvintes = new Set(); // quem espera mensagens (o envio espera o eco do que mandou)
  let ultimoLogi = 0;
  let ultimoCanal = null; // o último canal de conversa que o Gestor carregou: { canal, em }
  const avisar = () => {
    if (aoMudarChat) aoMudarChat();
  };
  const preparar = (sid) =>
    Promise.all([
      dbg.sendCommand('Network.enable', {}, sid).catch(() => {}),
      dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {}),
    ]);
  // A página só carrega depois disto (`pronto`): conexão do chat aberta antes da escuta passaria sem ser lida (ERR-376).
  const pronto = preparar(undefined);
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
        const q = lerQuadro(p.response && p.response.payloadData);
        if (!q) return;
        if (!sockets.has(chave(p.requestId))) {
          // conexão que a escuta não viu abrir (aberta antes dela, ERR-376): vale se o quadro é do chat — uma mensagem
          // de um canal de conversa (`sendbird_…`); a conexão passa a contar como do chat
          const doChat = q.cmd === 'MESG' && q.corpo && typeof q.corpo.channel_url === 'string' && q.corpo.channel_url.startsWith('sendbird_');
          if (!doChat) return;
          sockets.set(chave(p.requestId), '(aberta antes da escuta)');
          avisar();
        }
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
        for (const f of ouvintes) {
          try {
            f(m);
          } catch {
            /* quem ouve não derruba a leitura */
          }
        }
        return;
      }
      if (metodo === 'Network.requestWillBeSent') {
        const rq = p.request || {};
        // abrir uma conversa = o Gestor carrega o canal dela (`…/group_channels/sendbird_gc_cm_<pedido>_<loja>`)
        const canal = /\/v3\/(?:sdk\/)?group_channels\/(sendbird_gc_cm_[0-9a-f-]+_[0-9a-f-]+)(?:[/?]|$)/i.exec(rq.url || '');
        if (canal && rq.method === 'GET') ultimoCanal = { canal: canal[1], em: Date.now() };
        if (diagnostico && interessa(rq.url || '')) diagnostico.chamada(rq.method, rq.url);
        return;
      }
      if (!diagnostico) return;
      if (metodo === 'Network.responseReceived') {
        const r = p.response || {};
        if (!interessa(r.url || '')) return;
        if ((p.type === 'XHR' || p.type === 'Fetch') && /json/i.test(r.mimeType || '')) corpos.set(chave(p.requestId), { url: r.url, sid });
        else diagnostico.anotar({ ev: 'resposta_sem_corpo', url: diagnostico.endereco(r.url), tipo: p.type, mime: r.mimeType, status: r.status });
        return;
      }
      if (metodo === 'Network.loadingFinished' && corpos.has(chave(p.requestId))) {
        const { url, sid: s } = corpos.get(chave(p.requestId));
        corpos.delete(chave(p.requestId));
        // a página principal chega com a sessão "" — o Electron recusa sessão vazia: aí vai sem sessão
        dbg
          .sendCommand('Network.getResponseBody', { requestId: p.requestId }, s || undefined)
          .then((b) => {
            const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            if (!txt || txt.length > 2000000) return diagnostico.anotar({ ev: 'corpo_fora', url: diagnostico.endereco(url), tamanho: txt ? txt.length : 0 });
            let j;
            try {
              j = JSON.parse(txt);
            } catch {
              return diagnostico.anotar({ ev: 'corpo_nao_json', url: diagnostico.endereco(url), tamanho: txt.length });
            }
            diagnostico.resposta(url, j);
          })
          .catch((e) => diagnostico.anotar({ ev: 'corpo_falhou', url: diagnostico.endereco(url), sessao: Boolean(s), erro: String((e && e.message) || e).slice(0, 160) }));
      }
    } catch (e) {
      if (registrarErro) registrarErro(String((e && e.message) || e));
    }
  });
  return {
    pronto,
    chatAberto: () => sockets.size > 0,
    ultimoLogi: () => ultimoLogi,
    ultimoCanal: () => ultimoCanal,
    /**
     * Espera a mensagem da LOJA com este texto chegar depois de `desde` — na conversa `canal` (quando se sabe) e do pedido
     * `pedidoExterno` (quando se sabe) — ou null no prazo.
     */
    esperarEco: ({ canal, pedidoExterno, texto, desde, prazoMs = 20000 }) =>
      new Promise((resolver) => {
        const fim = setTimeout(() => {
          ouvintes.delete(ouvir);
          resolver(null);
        }, prazoMs);
        const ouvir = (m) => {
          if (m.autor !== 'loja' || m.texto.trim() !== String(texto).trim() || Date.now() < desde) return;
          if (canal && m.canalDoChat !== canal) return;
          if (pedidoExterno && String(m.pedidoExterno || '').toLowerCase() !== String(pedidoExterno).toLowerCase()) return;
          clearTimeout(fim);
          ouvintes.delete(ouvir);
          resolver(m);
        };
        ouvintes.add(ouvir);
      }),
  };
}

module.exports = { ligarLeitor, filtroDoChat };
