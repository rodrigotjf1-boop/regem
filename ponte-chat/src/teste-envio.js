'use strict';
// A janela "Teste de envio": o ensaio (não envia) e, depois de um ensaio certo do MESMO pedido, o envio de verdade com
// confirmação. O programa confere tudo de novo do lado dele (esta tela só pede).
const $ = (id) => document.getElementById(id);
const TEXTO_DE_TESTE = /teste do regem|não será enviada/i;
let ensaioCertoDe = null; // o número do pedido do último ensaio certo

function mostrarEtapas(etapas) {
  $('etapas').innerHTML = '';
  for (const e of etapas || []) {
    const li = document.createElement('li');
    li.textContent = e;
    li.className = e.startsWith('✗') ? 'erro' : e.startsWith('✓') ? 'ok' : '';
    $('etapas').appendChild(li);
  }
}
const situacao = (t) => ($('situacao').textContent = t || '');
const numero = () => $('numero').value.replace(/\D/g, '');
const ocupar = (sim) => {
  $('ensaiar').disabled = sim;
  $('enviar').disabled = sim || ensaioCertoDe !== numero();
};

$('numero').addEventListener('input', () => {
  $('numero').value = numero();
  $('enviar').disabled = ensaioCertoDe !== numero();
  $('confirmar').style.display = 'none';
});

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('confirmar').style.display = 'none';
  ocupar(true);
  situacao('Ensaiando… (o Gestor vai abrir a conversa; não mexa nele até terminar)');
  mostrarEtapas([]);
  try {
    const r = await window.ponte.ensaiar({ numero: numero(), texto: $('texto').value });
    mostrarEtapas(r.etapas);
    ensaioCertoDe = r.ok ? numero() : null;
    situacao(r.ok ? 'Ensaio certo: nada foi enviado. Se quiser, troque o texto por uma mensagem de verdade e envie.' : 'O ensaio parou — veja o que falhou acima. Nada foi enviado.');
    if (r.ok && TEXTO_DE_TESTE.test($('texto').value)) $('texto').value = 'Seu pedido saiu para entrega!';
  } catch {
    situacao('O ensaio não rodou. Nada foi enviado.');
  } finally {
    ocupar(false);
  }
});

$('enviar').addEventListener('click', () => {
  if (TEXTO_DE_TESTE.test($('texto').value)) {
    situacao('Troque o texto: o texto de teste não vai para cliente.');
    return;
  }
  $('confirmar-texto').textContent = `Vai ENVIAR ao cliente do pedido #${numero()}: “${$('texto').value.trim()}”. Confirmar?`;
  $('confirmar').style.display = 'block';
  $('nao').focus();
});

$('nao').addEventListener('click', () => {
  $('confirmar').style.display = 'none';
  situacao('Envio cancelado. Nada foi enviado.');
});

$('sim').addEventListener('click', async () => {
  $('confirmar').style.display = 'none';
  ocupar(true);
  situacao('Enviando… (não mexa no Gestor até terminar)');
  mostrarEtapas([]);
  try {
    const r = await window.ponte.enviar({ numero: numero(), texto: $('texto').value });
    mostrarEtapas(r.etapas);
    situacao(r.ok ? 'Enviado e conferido pelo chat do iFood.' : r.incerto ? 'Não deu para confirmar o envio — confira no Gestor antes de tentar de novo.' : 'O envio parou — veja o que falhou acima.');
    ensaioCertoDe = null; // um envio por ensaio
  } catch {
    situacao('O envio não rodou.');
  } finally {
    ocupar(false);
  }
});

$('numero').focus();
