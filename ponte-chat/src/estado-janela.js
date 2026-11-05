'use strict';
// A janela "Estado da ponte": desenha o que o programa manda (`paraAJanela` em estado-local.js) e repassa os botões.
// Só textContent (nada de HTML vindo de fora).
const $ = (id) => document.getElementById(id);

function el(tag, attrs, texto) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (texto !== undefined) e.textContent = texto;
  return e;
}

let ocupado = false;

async function agir(acao, botao) {
  if (ocupado) return;
  ocupado = true;
  if (botao) botao.disabled = true;
  $('msg').textContent = '';
  try {
    const r = await window.ponte.acao(acao);
    if (r && r.mensagem) $('msg').textContent = r.mensagem;
    if (r && r.estado) desenhar(r.estado);
  } catch {
    $('msg').textContent = 'Não deu certo agora. Tente de novo.';
  } finally {
    ocupado = false;
    if (botao) botao.disabled = false;
  }
}

function desenhar(v) {
  if (!v) return;
  $('sub').textContent = v.sub || '';
  const s = $('selo');
  s.textContent = v.selo.texto;
  s.className = `selo ${v.selo.tom}`;
  const f = $('faixa');
  f.replaceChildren();
  if (v.faixa) {
    f.hidden = false;
    f.className = `faixa ${v.faixa.tom}`;
    f.append(el('p', {}, v.faixa.texto));
  } else f.hidden = true;
  const dl = $('pares');
  dl.replaceChildren();
  for (const [k, val] of v.pares) dl.append(el('dt', {}, k), el('dd', {}, val));
  const acoes = $('acoes');
  acoes.replaceChildren();
  for (const b of v.botoes) {
    // o botão da ação da faixa vem em destaque (é o que fazer agora)
    const bt = el('button', { type: 'button', 'data-acao': b.acao, class: v.faixa && v.faixa.acao === b.acao ? 'pri' : '' }, b.texto);
    bt.addEventListener('click', () => agir(b.acao, bt));
    acoes.append(bt);
  }
  $('versao').textContent = v.versao ? `versão ${v.versao}` : '';
}

window.ponte.aoMudar(desenhar);
window.ponte.estado().then(desenhar).catch(() => {
  $('msg').textContent = 'Não deu para ler o estado da ponte.';
});
