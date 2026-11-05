'use strict';

// O ENVIO PELO GESTOR DO iFood (parte B, v0.3) — o programa digita na tela do Gestor como a pessoa faria (a tela foi
// mapeada em 04/11/2026 com o dono abrindo uma conversa: só a estrutura, sem texto). O caminho:
//   cartão do pedido no quadro (`.kanban-column button` com o número) → resumo (`.OrderDetails__content`) → o botão de chat
//   do cabeçalho do resumo (`[role=button]` num tooltip, sem rótulo) → a conversa: `h1` "#<número> <nome>",
//   `textarea[aria-label="Campo de mensagem"]`, `button[aria-label="Enviar mensagem"]`.
// ANTES DE ESCREVER, três conferências — qualquer uma falhou, não escreve: (1) o topo da conversa diz "#<número>", (2) o
// Gestor carregou o canal desse pedido depois do clique (`…/group_channels/sendbird_gc_cm_<id do pedido>_…`; com o id do
// pedido conhecido, tem de ser ele), (3) há UM "Campo de mensagem" na tela.
// O ENSAIO escreve, segura uns segundos para a pessoa ver e APAGA — nunca aperta "Enviar". O ENVIO aperta "Enviar
// mensagem" e só dá por enviado quando a mensagem volta pelo chat (da loja, na conversa desse pedido, com o mesmo texto).

const NUMERO = /^\d{3,6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- os roteiros que rodam DENTRO da página (o número já validado: só dígitos) ----
const VISIVEL = 'const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };';

const ABRIR_CARTAO = (numero) => `(() => {
  ${VISIVEL}
  const todos = [...document.querySelectorAll('.kanban-column button')].filter(vis);
  const cartoes = todos.filter((b) => /(^|\\D)${numero}(\\D|$)/.test(b.innerText || ''));
  // quadro ainda vazio (o Gestor carregando os pedidos): espera e tenta de novo
  if (!todos.length) return { ok: false, espera: true, motivo: 'o Gestor não está na opção "Pedidos" (o quadro) — abra "Pedidos" no menu do Gestor e tente de novo' };
  if (cartoes.length !== 1) return { ok: false, motivo: cartoes.length ? 'há mais de um cartão com esse número no quadro' : 'o pedido não está no quadro do Gestor (confira se ele aparece em alguma coluna)' };
  cartoes[0].click();
  return { ok: true };
})()`;

const ABRIR_CHAT_DO_RESUMO = (numero) => `(() => {
  const resumo = document.querySelector('.OrderDetails__content');
  if (!resumo) return { ok: false, espera: true, motivo: 'o resumo do pedido não abriu' };
  const cab = resumo.querySelector('header');
  if (!cab || !/(^|\\D)${numero}(\\D|$)/.test(cab.innerText || '')) return { ok: false, espera: true, motivo: 'o resumo aberto não é deste pedido' };
  const dica = (x) => ((x.closest('[class*=TooltipWrapper]') || x).textContent || '') + ' ' + (x.getAttribute('aria-label') || '') + ' ' + (x.getAttribute('title') || '');
  // o botão de chat do resumo (mapeado em 04/11): um [role=button] dentro de um tooltip, sem rótulo
  const candidatos = [...cab.querySelectorAll('[role=button]')].filter((x) => x.tagName !== 'BUTTON');
  const porDica = [...cab.querySelectorAll('[role=button], button')].filter((x) => /chat|convers|mensag/i.test(dica(x)));
  const alvo = porDica.length === 1 ? porDica[0] : candidatos.length === 1 ? candidatos[0] : null;
  if (!alvo) {
    // os botões do resumo aparecem um instante depois do número: espera; no fim do prazo, devolve o que havia (diagnóstico)
    const detalhes = [...cab.querySelectorAll('button, [role=button], [tabindex], a')].slice(0, 12).map((x) => ({
      tag: x.tagName.toLowerCase(), papel: x.getAttribute('role'), rotulo: x.getAttribute('aria-label'), titulo: x.getAttribute('title'),
      testid: x.getAttribute('data-testid'), dica: dica(x).replace(/\\d/g, '0').replace(/\\s+/g, ' ').trim().slice(0, 40),
      classes: String(x.className || '').split(/\\s+/).slice(0, 3).join('.'),
    }));
    return { ok: false, espera: true, motivo: 'não achei o botão de chat do resumo (' + candidatos.length + ' possíveis)', detalhes };
  }
  alvo.click();
  return { ok: true };
})()`;

const CONVERSA_ABERTA = (numero) => `(() => {
  ${VISIVEL}
  const campos = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].filter(vis);
  const topo = [...document.querySelectorAll('h1')].filter(vis).some((h) => /#\\s?${numero}(\\D|$)/.test(h.innerText || ''));
  return { campos: campos.length, topo };
})()`;

const FOCAR_CAMPO = `(() => {
  ${VISIVEL}
  const c = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].filter(vis);
  if (c.length !== 1) return false;
  c[0].focus();
  return document.activeElement === c[0];
})()`;

const LER_CAMPO = `(() => {
  ${VISIVEL}
  const c = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].filter(vis);
  const b = document.querySelector('button[aria-label="Enviar mensagem"]');
  return { campos: c.length, valor: c.length === 1 ? c[0].value : null, botaoLigado: !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' };
})()`;

const APAGAR_CAMPO = `(() => {
  ${VISIVEL}
  const c = [...document.querySelectorAll('textarea[aria-label="Campo de mensagem"]')].filter(vis);
  if (c.length !== 1) return false;
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c[0], '');
  c[0].dispatchEvent(new Event('input', { bubbles: true }));
  return c[0].value === '';
})()`;

const APERTAR_ENVIAR = `(() => {
  const b = document.querySelector('button[aria-label="Enviar mensagem"]');
  if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
  b.click();
  return true;
})()`;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/** Repete `fn` até devolver algo "ok" (ou o prazo acabar); devolve o último resultado. */
async function ate(fn, ok, prazoMs, passoMs = 250) {
  const fim = Date.now() + prazoMs;
  let r;
  for (;;) {
    r = await fn();
    if (ok(r) || Date.now() >= fim) return r;
    await esperar(passoMs);
  }
}

/**
 * Abre a conversa do pedido e faz as três conferências. Devolve { ok, etapas, canal } — `etapas` diz o que passou e o que
 * falhou, em português, para mostrar à pessoa.
 * @param {{ executeJavaScript: (s: string) => Promise<any> }} pagina  o quadro principal do Gestor
 * @param {{ ultimoCanal: () => ({ canal: string, em: number } | null) }} leitor
 */
async function abrirConversa(pagina, leitor, { numero, pedidoExterno }, { prazoMs = 8000 } = {}) {
  const etapas = [];
  const falhou = (m) => ({ ok: false, etapas: [...etapas, `✗ ${m}`] });
  if (!NUMERO.test(String(numero || ''))) return falhou('o número do pedido tem de ter de 3 a 6 algarismos');
  if (pedidoExterno && !UUID.test(pedidoExterno)) return falhou('o id do pedido no iFood é inválido');
  const desde = Date.now();
  const cartao = await ate(() => pagina.executeJavaScript(ABRIR_CARTAO(numero)), (r) => r && (r.ok || !r.espera), prazoMs);
  if (!cartao || !cartao.ok) return falhou((cartao && cartao.motivo) || 'não deu para abrir o pedido');
  etapas.push(`✓ abri o pedido #${numero} no quadro`);
  const chat = await ate(() => pagina.executeJavaScript(ABRIR_CHAT_DO_RESUMO(numero)), (r) => r && (r.ok || !r.espera), prazoMs);
  if (!chat || !chat.ok) return { ...falhou((chat && chat.motivo) || 'não deu para abrir o chat do pedido'), detalhes: chat && chat.detalhes };
  etapas.push('✓ abri o chat do resumo');
  const aberta = await ate(() => pagina.executeJavaScript(CONVERSA_ABERTA(numero)), (r) => r && r.campos === 1 && r.topo, prazoMs);
  if (!aberta || !aberta.topo) return falhou(`o topo da conversa não mostra #${numero}`);
  if (aberta.campos !== 1) return falhou(`achei ${aberta ? aberta.campos : 0} campos de mensagem (tem de ser 1)`);
  etapas.push(`✓ conferido: o topo da conversa é o #${numero} e há um "Campo de mensagem"`);
  // O canal: se o Gestor o carregou depois do clique, tem de ser o deste pedido. Conversa que o Gestor já tinha aberto
  // antes ele NÃO recarrega (fica na memória — visto em 04/11 no #2377): aí vale o topo, e no envio o eco confere a conversa.
  const carregado = await ate(async () => leitor.ultimoCanal(), (c) => c && c.em >= desde, Math.min(prazoMs, 4000));
  const novo = !!carregado && carregado.em >= desde;
  const idDoCanal = novo ? (/^sendbird_gc_cm_([0-9a-f-]{36})_/i.exec(carregado.canal) || [])[1] || null : null;
  if (novo && pedidoExterno && (!idDoCanal || idDoCanal.toLowerCase() !== pedidoExterno.toLowerCase())) return falhou('o canal que o Gestor carregou é de OUTRO pedido');
  etapas.push(
    novo
      ? pedidoExterno ? '✓ conferido: o canal carregado é o deste pedido' : '✓ o Gestor carregou o canal da conversa'
      : '• o Gestor já tinha esta conversa aberta (não recarregou o canal): vale o topo; no envio, o eco confere a conversa',
  );
  return { ok: true, etapas, canal: novo ? carregado.canal : null, pedidoDoCanal: idDoCanal };
}

/** Escreve o texto no campo (como digitado) e confere o que ficou. */
async function escrever(pagina, digitar, texto) {
  if (!(await pagina.executeJavaScript(FOCAR_CAMPO))) return { ok: false, motivo: 'não deu para pôr o cursor no campo de mensagem' };
  await digitar(texto);
  const r = await pagina.executeJavaScript(LER_CAMPO);
  if (!r || r.valor !== texto) return { ok: false, motivo: 'o texto no campo não ficou igual ao que escrevi' };
  if (!r.botaoLigado) return { ok: false, motivo: 'o botão "Enviar mensagem" não ligou' };
  return { ok: true };
}

/** Apaga o campo e confere (vazio e o botão desligado). */
async function apagar(pagina) {
  await pagina.executeJavaScript(APAGAR_CAMPO);
  const r = await pagina.executeJavaScript(LER_CAMPO);
  return { ok: !!r && r.valor === '' && !r.botaoLigado };
}

/**
 * O ENSAIO: abre, confere, escreve, segura `segurarMs` para a pessoa ver e APAGA. Nunca aperta "Enviar".
 * @param {{ pagina, leitor, digitar: (t: string) => Promise<void> }} ctx
 */
async function ensaiar(ctx, { numero, pedidoExterno, texto }, { segurarMs = 5000 } = {}) {
  const t = String(texto || '').trim();
  if (!t) return { ok: false, etapas: ['✗ escreva o texto do ensaio'] };
  const a = await abrirConversa(ctx.pagina, ctx.leitor, { numero, pedidoExterno });
  if (!a.ok) return a;
  const etapas = [...a.etapas];
  const e = await escrever(ctx.pagina, ctx.digitar, t);
  if (!e.ok) {
    await apagar(ctx.pagina);
    return { ok: false, etapas: [...etapas, `✗ ${e.motivo} (o campo foi apagado)`] };
  }
  etapas.push(`✓ escrevi o texto e o botão "Enviar mensagem" ligou — NÃO apertei (${Math.round(segurarMs / 1000)} s para você ver)`);
  await esperar(segurarMs);
  const ap = await apagar(ctx.pagina);
  etapas.push(ap.ok ? '✓ apaguei o texto; nada foi enviado' : '✗ não consegui apagar o campo — apague à mão antes de mexer no Gestor');
  return { ok: ap.ok, etapas, canal: a.canal, pedidoDoCanal: a.pedidoDoCanal };
}

/**
 * O ENVIO: abre, confere, escreve, aperta "Enviar mensagem" e espera a mensagem voltar pelo chat (da loja, na conversa
 * desse pedido, com o mesmo texto). Devolve { ok, etapas, id } — `id` é o da mensagem no chat do iFood.
 * @param {{ pagina, leitor, digitar }} ctx  `leitor.esperarEco({ canal, texto, desde, prazoMs })`
 */
async function enviar(ctx, { numero, pedidoExterno, texto }, { ecoMs = 20000 } = {}) {
  const t = String(texto || '').trim();
  if (!t) return { ok: false, etapas: ['✗ escreva o texto'] };
  const a = await abrirConversa(ctx.pagina, ctx.leitor, { numero, pedidoExterno });
  if (!a.ok) return a;
  const etapas = [...a.etapas];
  const e = await escrever(ctx.pagina, ctx.digitar, t);
  if (!e.ok) {
    await apagar(ctx.pagina);
    return { ok: false, etapas: [...etapas, `✗ ${e.motivo} (o campo foi apagado; nada foi enviado)`] };
  }
  const desde = Date.now();
  // Escuta o eco ANTES de apertar: o eco pode chegar antes de o clique "terminar" (ERR-375).
  const esperandoEco = ctx.leitor.esperarEco({ canal: a.canal, pedidoExterno, texto: t, desde, prazoMs: ecoMs });
  if (!(await ctx.pagina.executeJavaScript(APERTAR_ENVIAR))) {
    await apagar(ctx.pagina);
    return { ok: false, etapas: [...etapas, '✗ o botão "Enviar mensagem" não aceitou o clique (nada foi enviado)'] };
  }
  etapas.push('✓ apertei "Enviar mensagem"');
  const eco = await esperandoEco;
  if (!eco) return { ok: false, incerto: true, etapas: [...etapas, '✗ a mensagem não voltou pelo chat a tempo — confira no Gestor se ela saiu antes de tentar de novo'] };
  etapas.push('✓ a mensagem voltou pelo chat do iFood: enviada');
  return { ok: true, etapas, id: eco.id, canal: eco.canalDoChat || a.canal };
}

module.exports = {
  abrirConversa,
  ensaiar,
  enviar,
  escrever,
  apagar,
  ROTEIROS: { ABRIR_CARTAO, ABRIR_CHAT_DO_RESUMO, CONVERSA_ABERTA, FOCAR_CAMPO, LER_CAMPO, APAGAR_CAMPO, APERTAR_ENVIAR },
};
