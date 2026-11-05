'use strict';
// A tela de pareamento: só números, 6 deles; o programa (pela ponte segura do preload) troca o código pelo segredo.
const form = document.getElementById('form');
const campo = document.getElementById('codigo');
const botao = document.getElementById('parear');
const msg = document.getElementById('msg');

function mostrar(texto, tipo) {
  msg.textContent = texto || '';
  msg.className = tipo || '';
}

campo.addEventListener('input', () => {
  campo.value = campo.value.replace(/\D/g, '').slice(0, 6);
  if (msg.className === 'erro') mostrar('');
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const codigo = campo.value.replace(/\D/g, '');
  if (codigo.length !== 6) {
    mostrar('Digite os 6 números do código.', 'erro');
    campo.focus();
    return;
  }
  botao.disabled = true;
  mostrar('Pareando…');
  try {
    const r = await window.ponte.parear(codigo);
    if (r && r.ok) mostrar(`Pareado: ${r.nome || 'este PC'}. Abrindo o Gestor do iFood…`, 'ok');
    else {
      mostrar((r && r.mensagem) || 'Não deu para parear agora. Tente de novo.', 'erro');
      campo.select();
    }
  } catch {
    mostrar('Não deu para parear agora. Tente de novo.', 'erro');
  } finally {
    botao.disabled = false;
  }
});

campo.focus();
