'use strict';

// O ENVIO PELO GESTOR DO iFood — o programa digita na tela do Gestor como a pessoa faria (a tela foi mapeada em
// 04/11/2026 com o dono abrindo uma conversa: só a estrutura, sem texto). O caminho:
//   cartão do pedido no quadro (`.kanban-column button` com o número) → resumo (`.OrderDetails__content`) → o botão de chat
//   do cabeçalho do resumo (`[role=button]` num tooltip, sem rótulo) → a conversa: `h1` "#<número> <nome>",
//   `textarea[aria-label="Campo de mensagem"]`, `button[aria-label="Enviar mensagem"]`.
// ANTES DE ESCREVER, três conferências — qualquer uma falhou, não escreve: (1) o topo da conversa diz "#<número>", (2) o
// Gestor carregou o canal desse pedido depois do clique (`…/group_channels/sendbird_gc_cm_<id do pedido>_…`; com o id do
// pedido conhecido, tem de ser ele), (3) há UM "Campo de mensagem" na tela. E (v0.4) o campo tem de estar VAZIO: texto
// lá é de alguém da loja — o programa não mexe (nem apaga) e devolve "adiar".
// O ENSAIO escreve, segura uns segundos para a pessoa ver e APAGA — nunca aperta "Enviar". O ENVIO aperta "Enviar
// mensagem" e só dá por enviado quando a mensagem volta pelo chat (da loja, na conversa desse pedido, com o mesmo texto).
// Apagar = só se o campo tem EXATAMENTE o texto que o programa escreveu (nunca o rascunho de alguém).

const NUMERO = /^\d{3,6}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- os roteiros que rodam DENTRO da página (o número já validado: só dígitos; texto sempre por JSON.stringify) ----
const VISIVEL = 'const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };';
const CAMPOS = "[...document.querySelectorAll('textarea[aria-label=\"Campo de mensagem\"]')].filter(vis)";

const ABRIR_CARTAO = (numero) => `(() => {
  ${VISIVEL}
  const todos = [...document.querySelectorAll('.kanban-column button')].filter(vis);
  const cartoes = todos.filter((b) => /(^|\\D)${numero}(\\D|$)/.test(b.innerText || ''));
  // quadro ainda vazio (o Gestor carregando os pedidos): espera e tenta de novo
  if (!todos.length) return { ok: false, espera: true, codigo: 'sem_quadro', motivo: 'o Gestor não está na opção "Pedidos" (o quadro) — abra "Pedidos" no menu do Gestor e tente de novo' };
  if (cartoes.length !== 1) return { ok: false, codigo: cartoes.length ? 'cartao_repetido' : 'fora_do_quadro', motivo: cartoes.length ? 'há mais de um cartão com esse número no quadro' : 'o pedido não está no quadro do Gestor (confira se ele aparece em alguma coluna)' };
  cartoes[0].click();
  return { ok: true };
})()`;

const ABRIR_CHAT_DO_RESUMO = (numero) => `(() => {
  const resumo = document.querySelector('.OrderDetails__content');
  if (!resumo) return { ok: false, espera: true, codigo: 'resumo', motivo: 'o resumo do pedido não abriu' };
  const cab = resumo.querySelector('header');
  if (!cab || !/(^|\\D)${numero}(\\D|$)/.test(cab.innerText || '')) return { ok: false, espera: true, codigo: 'resumo', motivo: 'o resumo aberto não é deste pedido' };
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
    return { ok: false, espera: true, codigo: 'botao_chat', motivo: 'não achei o botão de chat do resumo (' + candidatos.length + ' possíveis)', detalhes };
  }
  alvo.click();
  return { ok: true };
})()`;

const CONVERSA_ABERTA = (numero) => `(() => {
  ${VISIVEL}
  const campos = ${CAMPOS};
  const topo = [...document.querySelectorAll('h1')].filter(vis).some((h) => /#\\s?${numero}(\\D|$)/.test(h.innerText || ''));
  return { campos: campos.length, topo };
})()`;

const FOCAR_CAMPO = `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  if (c.length !== 1) return false;
  c[0].focus();
  return document.activeElement === c[0];
})()`;

const LER_CAMPO = `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  const b = document.querySelector('button[aria-label="Enviar mensagem"]');
  return { campos: c.length, valor: c.length === 1 ? c[0].value : null, botaoLigado: !!b && !b.disabled && b.getAttribute('aria-disabled') !== 'true' };
})()`;

const APAGAR_CAMPO = `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  if (c.length !== 1) return false;
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c[0], '');
  c[0].dispatchEvent(new Event('input', { bubbles: true }));
  return c[0].value === '';
})()`;

/** Apaga o campo SÓ se ele tem exatamente o texto que o programa escreveu (o rascunho de alguém nunca é apagado). */
const APAGAR_SE_IGUAL = (texto) => `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  if (c.length !== 1) return { ok: false, apagou: false };
  if (c[0].value !== ${JSON.stringify(String(texto))}) return { ok: c[0].value === '', apagou: false, outro: c[0].value !== '' };
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c[0], '');
  c[0].dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: c[0].value === '', apagou: true };
})()`;

/**
 * Escreve no campo SEM o teclado (v0.4, o envio automático): o valor pelo "setter" nativo + o evento de digitação — o mesmo
 * jeito do apagar, que o Gestor de verdade aceitou no ensaio de 04/11. Não precisa da janela em foco: o programa não rouba
 * o teclado de quem está usando outro programa no PC. Só escreve em campo VAZIO.
 */
const ESCREVER_NO_CAMPO = (texto) => `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  if (c.length !== 1) return { ok: false, motivo: 'campos' };
  if (c[0].value !== '') return { ok: false, ocupado: true };
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c[0], ${JSON.stringify(String(texto))});
  c[0].dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: c[0].value === ${JSON.stringify(String(texto))} };
})()`;

const APERTAR_ENVIAR = `(() => {
  const b = document.querySelector('button[aria-label="Enviar mensagem"]');
  if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return false;
  b.click();
  return true;
})()`;

// Voltar a tela: fecha a conversa e o resumo SÓ por um botão com o rótulo EXATO "Fechar"/"Close" (nunca "fechar" solto —
// no Gestor há "fechar a loja"); a conversa = o ancestral do campo que tem o topo "#<número>"; nunca com texto no campo.
const FECHAR_CONVERSA = (numero) => `(() => {
  ${VISIVEL}
  const c = ${CAMPOS};
  if (!c.length) return { ok: true, nada: true };
  if (c.length !== 1 || c[0].value !== '') return { ok: false, motivo: 'campo com texto' };
  const exato = (b) => /^(fechar|close)$/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || '').trim());
  let painel = c[0];
  for (let i = 0; i < 10 && painel.parentElement; i++) {
    painel = painel.parentElement;
    if ([...painel.querySelectorAll('h1')].some((h) => /#\\s?${numero}(\\D|$)/.test(h.innerText || ''))) break;
  }
  const alvo = [...painel.querySelectorAll('button, [role=button]')].filter(vis).filter(exato);
  if (alvo.length !== 1) return { ok: false, motivo: 'sem um botão "Fechar" na conversa' };
  alvo[0].click();
  return { ok: true };
})()`;

const FECHAR_RESUMO = `(() => {
  ${VISIVEL}
  const resumo = document.querySelector('.OrderDetails__content');
  if (!resumo || !vis(resumo)) return { ok: true, nada: true };
  const exato = (b) => /^(fechar|close)$/i.test((b.getAttribute('aria-label') || b.getAttribute('title') || '').trim());
  const alvo = [...resumo.querySelectorAll('button, [role=button]')].filter(vis).filter(exato);
  if (alvo.length !== 1) return { ok: false, motivo: 'sem um botão "Fechar" no resumo' };
  alvo[0].click();
  return { ok: true };
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
 * Abre a conversa do pedido e faz as três conferências. Devolve { ok, etapas, canal, codigo } — `etapas` diz o que passou
 * e o que falhou, em português, para mostrar à pessoa; `codigo` diz o tipo de falha (ex.: `fora_do_quadro`).
 * @param {{ executeJavaScript: (s: string) => Promise<any> }} pagina  o quadro principal do Gestor
 * @param {{ ultimoCanal: () => ({ canal: string, em: number } | null) }} leitor
 */
async function abrirConversa(pagina, leitor, { numero, pedidoExterno }, { prazoMs = 8000 } = {}) {
  const etapas = [];
  const falhou = (m, codigo) => ({ ok: false, codigo, etapas: [...etapas, `✗ ${m}`] });
  if (!NUMERO.test(String(numero || ''))) return falhou('o número do pedido tem de ter de 3 a 6 algarismos', 'numero');
  if (pedidoExterno && !UUID.test(pedidoExterno)) return falhou('o id do pedido no iFood é inválido', 'numero');
  const desde = Date.now();
  const cartao = await ate(() => pagina.executeJavaScript(ABRIR_CARTAO(numero)), (r) => r && (r.ok || !r.espera), prazoMs);
  if (!cartao || !cartao.ok) return falhou((cartao && cartao.motivo) || 'não deu para abrir o pedido', (cartao && cartao.codigo) || 'cartao');
  etapas.push(`✓ abri o pedido #${numero} no quadro`);
  const chat = await ate(() => pagina.executeJavaScript(ABRIR_CHAT_DO_RESUMO(numero)), (r) => r && (r.ok || !r.espera), prazoMs);
  if (!chat || !chat.ok) return { ...falhou((chat && chat.motivo) || 'não deu para abrir o chat do pedido', (chat && chat.codigo) || 'botao_chat'), detalhes: chat && chat.detalhes };
  etapas.push('✓ abri o chat do resumo');
  const aberta = await ate(() => pagina.executeJavaScript(CONVERSA_ABERTA(numero)), (r) => r && r.campos === 1 && r.topo, prazoMs);
  if (!aberta || !aberta.topo) return falhou(`o topo da conversa não mostra #${numero}`, 'topo');
  if (aberta.campos !== 1) return falhou(`achei ${aberta ? aberta.campos : 0} campos de mensagem (tem de ser 1)`, 'campos');
  etapas.push(`✓ conferido: o topo da conversa é o #${numero} e há um "Campo de mensagem"`);
  // O canal: se o Gestor o carregou depois do clique, tem de ser o deste pedido. Conversa que o Gestor já tinha aberto
  // antes ele NÃO recarrega (fica na memória — visto em 04/11 no #2377): aí vale o topo, e no envio o eco confere a conversa.
  const carregado = await ate(async () => leitor.ultimoCanal(), (c) => c && c.em >= desde, Math.min(prazoMs, 4000));
  const novo = !!carregado && carregado.em >= desde;
  const idDoCanal = novo ? (/^sendbird_gc_cm_([0-9a-f-]{36})_/i.exec(carregado.canal) || [])[1] || null : null;
  if (novo && pedidoExterno && (!idDoCanal || idDoCanal.toLowerCase() !== pedidoExterno.toLowerCase())) return falhou('o canal que o Gestor carregou é de OUTRO pedido', 'canal');
  etapas.push(
    novo
      ? pedidoExterno ? '✓ conferido: o canal carregado é o deste pedido' : '✓ o Gestor carregou o canal da conversa'
      : '• o Gestor já tinha esta conversa aberta (não recarregou o canal): vale o topo; no envio, o eco confere a conversa',
  );
  return { ok: true, etapas, canal: novo ? carregado.canal : null, pedidoDoCanal: idDoCanal };
}

/**
 * Escreve o texto no campo (como digitado) e confere o que ficou. Campo com texto de alguém: não mexe (`ocupado`).
 * @param {(t: string) => Promise<any>} digitar  o teclado (ensaio manual) ou o "setter" (envio automático, sem foco)
 */
async function escrever(pagina, digitar, texto) {
  const antes = await pagina.executeJavaScript(LER_CAMPO);
  if (!antes || antes.campos !== 1) return { ok: false, motivo: 'não achei um "Campo de mensagem" só' };
  if (antes.valor) return { ok: false, ocupado: true, motivo: 'o campo de mensagem já tem um texto (de alguém da loja) — não mexi nele' };
  if (!(await pagina.executeJavaScript(FOCAR_CAMPO))) return { ok: false, motivo: 'não deu para pôr o cursor no campo de mensagem' };
  await digitar(texto);
  const r = await pagina.executeJavaScript(LER_CAMPO);
  if (!r || r.valor !== texto) return { ok: false, motivo: 'o texto no campo não ficou igual ao que escrevi' };
  if (!r.botaoLigado) return { ok: false, motivo: 'o botão "Enviar mensagem" não ligou' };
  return { ok: true };
}

/** Apaga o texto que o PROGRAMA escreveu e confere (vazio e o botão desligado). Texto de outra pessoa fica. */
async function apagar(pagina, texto) {
  if (texto !== undefined) await pagina.executeJavaScript(APAGAR_SE_IGUAL(texto));
  else await pagina.executeJavaScript(APAGAR_CAMPO);
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
  if (e.ocupado) return { ok: false, adiar: true, codigo: 'campo_com_texto', etapas: [...etapas, `✗ ${e.motivo}`] };
  if (!e.ok) {
    await apagar(ctx.pagina, t);
    return { ok: false, etapas: [...etapas, `✗ ${e.motivo} (o texto do programa foi apagado)`] };
  }
  etapas.push(`✓ escrevi o texto e o botão "Enviar mensagem" ligou — NÃO apertei (${Math.round(segurarMs / 1000)} s para você ver)`);
  await esperar(segurarMs);
  const ap = await apagar(ctx.pagina, t);
  etapas.push(ap.ok ? '✓ apaguei o texto; nada foi enviado' : '✗ não consegui apagar o campo — apague à mão antes de mexer no Gestor');
  return { ok: ap.ok, etapas, canal: a.canal, pedidoDoCanal: a.pedidoDoCanal };
}

/**
 * O ENVIO: abre, confere, escreve, aperta "Enviar mensagem" e espera a mensagem voltar pelo chat (da loja, na conversa
 * desse pedido, com o mesmo texto). Devolve { ok, etapas, id, apertou } — `id` é o da mensagem no chat do iFood.
 * Opções do envio automático (v0.4): `aoApertar()` roda (e é esperado) logo ANTES do clique — o diário do "apertei";
 * `podeApertar()` é a última conferência — se a pessoa voltou a mexer no Gestor, não aperta, apaga o texto do programa e
 * devolve `adiar`.
 * @param {{ pagina, leitor, digitar }} ctx  `leitor.esperarEco({ canal, texto, desde, prazoMs })`
 */
async function enviar(ctx, { numero, pedidoExterno, texto }, { ecoMs = 20000, aoApertar, podeApertar, jaEstaNoChat } = {}) {
  const t = String(texto || '').trim();
  if (!t) return { ok: false, etapas: ['✗ escreva o texto'] };
  const a = await abrirConversa(ctx.pagina, ctx.leitor, { numero, pedidoExterno });
  if (!a.ok) return a;
  const etapas = [...a.etapas];
  // (v0.4) Com a conversa aberta, o Gestor carregou o histórico: a mesma mensagem da loja já está lá? Não digita de novo.
  const ja = jaEstaNoChat ? await jaEstaNoChat() : null;
  if (ja && ja.id) return { ok: true, jaEstava: true, id: ja.id, etapas: [...etapas, '✓ a mensagem já estava no chat (no histórico da conversa) — não digitei de novo'] };
  const e = await escrever(ctx.pagina, ctx.digitar, t);
  if (e.ocupado) return { ok: false, adiar: true, codigo: 'campo_com_texto', etapas: [...etapas, `✗ ${e.motivo}`] };
  if (!e.ok) {
    await apagar(ctx.pagina, t);
    return { ok: false, codigo: 'escrever', etapas: [...etapas, `✗ ${e.motivo} (o texto do programa foi apagado; nada foi enviado)`] };
  }
  if (podeApertar && !(await podeApertar())) {
    await apagar(ctx.pagina, t);
    return { ok: false, adiar: true, codigo: 'pessoa', etapas: [...etapas, '✗ alguém voltou a mexer no Gestor — não apertei; o texto do programa foi apagado'] };
  }
  const desde = Date.now();
  // Escuta o eco ANTES de apertar: o eco pode chegar antes de o clique "terminar" (ERR-375).
  const esperandoEco = ctx.leitor.esperarEco({ canal: a.canal, pedidoExterno, texto: t, desde, prazoMs: ecoMs });
  if (aoApertar) await aoApertar();
  if (!(await ctx.pagina.executeJavaScript(APERTAR_ENVIAR))) {
    await apagar(ctx.pagina, t);
    return { ok: false, codigo: 'botao', etapas: [...etapas, '✗ o botão "Enviar mensagem" não aceitou o clique (nada foi enviado)'] };
  }
  etapas.push('✓ apertei "Enviar mensagem"');
  const eco = await esperandoEco;
  if (!eco) return { ok: false, incerto: true, apertou: true, codigo: 'sem_eco', etapas: [...etapas, '✗ a mensagem não voltou pelo chat a tempo — confira no Gestor se ela saiu antes de tentar de novo'] };
  etapas.push('✓ a mensagem voltou pelo chat do iFood: enviada');
  return { ok: true, apertou: true, etapas, id: eco.id, canal: eco.canalDoChat || a.canal };
}

/** Volta a tela para o quadro: fecha a conversa e o resumo pelos botões "Fechar" (se houver). Nunca com texto no campo. */
async function voltarAoQuadro(pagina, numero) {
  const conversa = NUMERO.test(String(numero || '')) ? await pagina.executeJavaScript(FECHAR_CONVERSA(numero)).catch(() => null) : null;
  await esperar(150);
  const resumo = await pagina.executeJavaScript(FECHAR_RESUMO).catch(() => null);
  return { conversa: conversa || { ok: false }, resumo: resumo || { ok: false } };
}

module.exports = {
  abrirConversa,
  ensaiar,
  enviar,
  escrever,
  apagar,
  voltarAoQuadro,
  ROTEIROS: {
    ABRIR_CARTAO,
    ABRIR_CHAT_DO_RESUMO,
    CONVERSA_ABERTA,
    FOCAR_CAMPO,
    LER_CAMPO,
    APAGAR_CAMPO,
    APAGAR_SE_IGUAL,
    ESCREVER_NO_CAMPO,
    APERTAR_ENVIAR,
    FECHAR_CONVERSA,
    FECHAR_RESUMO,
  },
};
