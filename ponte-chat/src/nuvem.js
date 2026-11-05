'use strict';

// A PONTE FALA COM A NUVEM DO REGEM (`backend/src/modules/ponte-chat/`): sem login de pessoa — quem prova é o PC pareado
// (`x-terminal-id` + `x-terminal-secret`). As recusas do aparelho vêm com `code` (V70):
//  • TERMINAL_REVOGADO        → o PC ESQUECE o pareamento (só esta faz isso) e pede um código novo;
//  • TERMINAL_NAO_RECONHECIDO → suspende e tenta de novo depois (o cadastro pode estar voltando) — guarda o que tem;
//  • 429 (limite por aparelho), sem rede, 5xx → tenta de novo na próxima volta.

const NUVEM_PADRAO = 'https://api.dmsregem.com/api/v1';
const TEMPO_MS = 20000;

/** A base da API: a nuvem do Regem; `REGEM_PONTE_NUVEM` troca (teste com o servidor local). Sem a barra do fim. */
function baseDaNuvem(env = process.env) {
  const b = String(env.REGEM_PONTE_NUVEM || '').trim() || NUVEM_PADRAO;
  return b.replace(/\/+$/, '');
}

/** O que fazer com uma resposta: ok | revogado | nao_reconhecido | limite | rede | servidor | recusado. */
function classificar(r) {
  if (r.ok) return 'ok';
  if (r.status === 403 && r.code === 'TERMINAL_REVOGADO') return 'revogado';
  if (r.status === 403 && r.code === 'TERMINAL_NAO_RECONHECIDO') return 'nao_reconhecido';
  if (r.status === 429) return 'limite';
  if (!r.status) return 'rede';
  if (r.status >= 500) return 'servidor';
  return 'recusado';
}

async function chamar(caminho, corpo, cred, { base = baseDaNuvem(), tempoMs = TEMPO_MS, fetchImpl = fetch } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), tempoMs);
  try {
    const cab = { 'Content-Type': 'application/json' };
    if (cred) {
      cab['x-terminal-id'] = cred.terminalId;
      cab['x-terminal-secret'] = cred.segredo;
    }
    const res = await fetchImpl(base + caminho, { method: 'POST', headers: cab, body: JSON.stringify(corpo || {}), signal: ctl.signal });
    const txt = await res.text();
    let j = null;
    try {
      j = txt ? JSON.parse(txt) : null;
    } catch {
      j = null;
    }
    if (res.ok) return { ok: true, status: res.status, dados: j };
    const msg = j && (typeof j.message === 'string' ? j.message : Array.isArray(j.message) ? j.message.join(' ') : null);
    return { ok: false, status: res.status, code: j && typeof j.code === 'string' ? j.code : null, mensagem: msg };
  } catch (e) {
    const tempo = e && e.name === 'AbortError';
    return { ok: false, status: 0, code: null, mensagem: tempo ? 'A nuvem do Regem não respondeu a tempo.' : 'Sem conexão com a nuvem do Regem.' };
  } finally {
    clearTimeout(t);
  }
}

/** Troca o código de 6 números (Configurações › Equipamentos) pelo id e pelo segredo deste PC. */
function parear(codigo, fingerprint, opcoes) {
  return chamar('/publico/terminal/parear', { codigo, fingerprint, tipo: 'ponte_chat' }, null, opcoes);
}

/** O sinal de vida: em quais plataformas a ponte está logada. A resposta diz se a ponte está ligada e o papel dela. */
function estado(cred, corpo, opcoes) {
  return chamar('/ponte-chat/estado', corpo, cred, opcoes);
}

/** O que chegou no chat (até 50 por vez). */
function mensagens(cred, lista, opcoes) {
  return chamar('/ponte-chat/mensagens', { mensagens: lista }, cred, opcoes);
}

/**
 * A vez na fila de SAÍDA (v0.4): até 10 mensagens para mandar pelo chat do canal, cada uma "pega" por 90 s (e com uma
 * tentativa gasta — por isso o programa só pede com a tela do Gestor livre). Resposta: `{ papel, itens }` — papel
 * `responde` (com os itens), `reserva`, `fora` ou `desligada` (sem itens).
 */
function pegar(cred, canal, opcoes) {
  return chamar('/ponte-chat/saida/pegar', { canal }, cred, opcoes);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O resultado de um envio da fila: `{ ok: true, id }` (o id da mensagem no chat) ou `{ ok: false, erro, definitivo? }`
 * (volta para a fila; definitivo ou na 3ª tentativa, "falhou"). 409 = a mensagem não está mais com esta ponte.
 */
function resultado(cred, id, corpo, opcoes) {
  if (!UUID.test(String(id || ''))) return Promise.resolve({ ok: false, status: 0, code: null, mensagem: 'id de mensagem inválido' });
  return chamar(`/ponte-chat/saida/${String(id).toLowerCase()}/resultado`, corpo, cred, opcoes);
}

module.exports = { baseDaNuvem, classificar, chamar, parear, estado, mensagens, pegar, resultado, NUVEM_PADRAO };
