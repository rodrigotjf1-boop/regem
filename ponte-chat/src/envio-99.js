'use strict';

// O ENVIO PELA 99 (Etapa 4b). Mapeado em 06/11/2026 no portal de verdade (`merchant.99app.com`, o usuário EXTRA da loja na
// janela da ponte; inspeção só leitura, texto mascarado):
//   • BUSCA: o campo "Nº pedido/índice do pedido" (`.order-search-bar input`) + Enter mostra SÓ aquele pedido, já
//     selecionado, com o resumo aberto no painel da direita (`main.order-container__detail`, número em `.index-number`),
//     de qualquer aba; número que não está em andamento → `.order-search-empty`. Limpar a busca (vazio + Enter) volta.
//   • O BALÃO do chat no resumo (`.receiver-info__chat-action`) só abre com clique de MOUSE de verdade (o `click()` no
//     elemento não abre — 05/11): o clique vai pelo depurador (`Input.dispatchMouseEvent`), sem mexer no mouse do PC.
//   • A GAVETA (`.pb-drawer__container.pb-drawer__open .pb-drawer.rtl`) abre na hora com o número da conversa
//     (`.im-order-id` "#NNNNNN"); o campo (`textarea.im-chat-window-edit-content`, 500) só aparece quando a conversa termina
//     de carregar — 30 s com a loja fechada (medido 3×), < 10 s com ela aberta (05/11).
//   • "ENVIAR" = `button.im-chat-window-edit-btn` (texto "Enviar", `is-disabled` com o campo vazio), SEMPRE dentro da
//     gaveta: no rodapé do resumo há um botão primário "Cheguei" com a mesma cara — apertá-lo avisaria o cliente que o
//     entregador chegou. Fechar = o voltar da gaveta (`.im-chat-items-icon-back`).
//   • A CONFIRMAÇÃO: o envio é um `POST /im/broker/` op_type 3 e a resposta traz o id (`uniq_msg_id`) — o mesmo que o
//     polling repete; o leitor (`leitor-99.js`) escuta os dois (`esperarEco`).
// O texto entra pelo "setter" do campo (como no iFood, sem o teclado: não depende do foco da janela). Antes de escrever, as
// conferências: o número no resumo E na conversa; o campo vazio (texto de alguém = não mexe); ninguém usando a janela.

const NUMERO = /^\d{4,8}$/;
const BUSCA_MS = 8000;
const GAVETA_MS = 6000;
const CLIQUE_MS = 2500; // a gaveta abre em ~30 ms depois do clique (medido); sem ela em 2,5 s, o clique se perdeu
const CAMPO_MS = 45000; // o campo levou 30 s com a loja fechada (06/11); com folga
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

const VIS = 'const vis = (el) => { if (!el) return false; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };';
// a gaveta do CHAT (há outras gavetas no portal — a do horário de funcionamento, por exemplo — todas escondidas)
const GAVETA = "[...document.querySelectorAll('.pb-drawer__container.pb-drawer__open .pb-drawer.rtl')].find((d) => vis(d) && d.querySelector('.im-chat-items-container, .im-order-id'))";
const BUSCA = "document.querySelector('.order-search-bar input')";
const CENTRO = '(el) => { const r = el.getBoundingClientRect(); const x = Math.round(r.x + r.width / 2); const y = Math.round(r.y + r.height / 2); return { x, y }; }';

/** O estado da janela da 99 (a tela livre e o que restaurar depois do envio). */
const ESTADO_DA_TELA = `(() => {
  ${VIS}
  const g = ${GAVETA};
  const b = ${BUSCA};
  const aba = document.querySelector('.order-primary-tabs__item--active');
  const campos = [...document.querySelectorAll('textarea.im-chat-window-edit-content')];
  const painel = document.querySelector('main.order-container__detail .index-number');
  return {
    vigia: !!window.__ponteVigia, acaoEm: window.__ponteAcaoEm || 0, vigiaDesde: window.__ponteVigiaDesde || 0,
    portal: !!document.querySelector('.order-primary-tabs'),
    gaveta: !!g, gavetaNumero: g ? ((g.querySelector('.im-order-id') || {}).textContent || '').trim() : '',
    campoComTexto: campos.some((c) => (c.value || '') !== ''),
    busca: b ? b.value : null,
    aba: aba ? (aba.innerText || '').replace(/\\s*\\(\\d+\\)\\s*$/, '').replace(/\\s+/g, ' ').trim() : null,
    painel: painel ? (painel.textContent || '').trim() : null,
  };
})()`;

/** Escreve na busca pelo setter (o Vue ouve o "input") e aperta Enter (a 99 busca no Enter). */
const BUSCAR = (numero) => `(() => {
  const b = ${BUSCA};
  if (!b) return { ok: false, motivo: 'o campo de busca da 99 não está na tela' };
  const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  definir.call(b, ${JSON.stringify(String(numero))});
  b.dispatchEvent(new Event('input', { bubbles: true }));
  for (const t of ['keydown', 'keypress', 'keyup']) b.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return { ok: true };
})()`;

/** O pedido achado pela busca: o cartão e o resumo do painel com ESTE número (ou "nada encontrado"). */
const PEDIDO_NA_BUSCA = (numero) => `(() => {
  ${VIS}
  const alvo = '#' + ${JSON.stringify(String(numero))};
  const cartoes = [...document.querySelectorAll('.order-card-item')].filter(vis);
  const num = (c) => ((c.querySelector('.order-card-item__num') || {}).textContent || '').trim();
  const painel = document.querySelector('main.order-container__detail .index-number');
  const vazio = [...document.querySelectorAll('.order-search-empty')].some(vis);
  return { achou: cartoes.some((c) => num(c) === alvo) && !!painel && (painel.textContent || '').trim() === alvo, vazio, painel: painel ? (painel.textContent || '').trim() : null };
})()`;

/** Onde clicar no balão do chat do resumo (o centro, conferido pelo que está pintado ali). Fora da vista: rola até ele. */
const BALAO = (numero) => `(() => {
  ${VIS}
  const painel = document.querySelector('main.order-container__detail .index-number');
  if (!painel || (painel.textContent || '').trim() !== '#' + ${JSON.stringify(String(numero))}) return { ok: false, motivo: 'o resumo aberto não é deste pedido' };
  const b = [...document.querySelectorAll('main.order-container__detail .receiver-info__chat-action')].find(vis);
  if (!b) return { ok: false, motivo: 'o resumo do pedido não mostra o botão do chat' };
  const c = (${CENTRO})(b);
  if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) { b.scrollIntoView({ block: 'center' }); return { ok: false, rolou: true, motivo: 'o botão do chat estava fora da vista' }; }
  const topo = document.elementFromPoint(c.x, c.y);
  if (!topo || !(topo === b || b.contains(topo))) return { ok: false, motivo: 'há algo na frente do botão do chat' };
  return { ok: true, x: c.x, y: c.y };
})()`;

/** A gaveta do chat: aberta? o número; o campo pronto (com o valor); o "Enviar" (dentro dela, texto exato). */
const GAVETA_ABERTA = `(() => {
  ${VIS}
  const g = ${GAVETA};
  if (!g) return { aberta: false };
  const campo = g.querySelector('textarea.im-chat-window-edit-content');
  const enviar = [...g.querySelectorAll('button.im-chat-window-edit-btn')].find((b) => vis(b) && (b.innerText || '').trim() === 'Enviar');
  return {
    aberta: true,
    numero: ((g.querySelector('.im-order-id') || {}).textContent || '').trim(),
    campo: vis(campo),
    valor: campo ? campo.value : null,
    enviar: !!enviar,
    enviarLigado: !!enviar && !enviar.disabled && !/is-disabled/.test(enviar.className),
  };
})()`;

/** Escreve no campo da gaveta pelo setter (o Vue ouve o "input"). Campo com texto de alguém: não mexe. */
const ESCREVER = (texto) => `(() => {
  ${VIS}
  const g = ${GAVETA};
  const c = g && g.querySelector('textarea.im-chat-window-edit-content');
  if (!vis(c)) return { ok: false, motivo: 'o campo da conversa não está na tela' };
  if ((c.value || '') !== '') return { ok: false, ocupado: true, motivo: 'há um texto no campo da conversa (de alguém da loja)' };
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c, ${JSON.stringify(String(texto))});
  c.dispatchEvent(new Event('input', { bubbles: true }));
  c.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`;

/** Apaga o campo SÓ se ele ainda tem o texto do programa (nunca o de alguém). */
const APAGAR_SE_IGUAL = (texto) => `(() => {
  ${VIS}
  const g = ${GAVETA};
  const c = g && g.querySelector('textarea.im-chat-window-edit-content');
  if (!c) return { ok: true, apagou: false };
  if (c.value !== ${JSON.stringify(String(texto))}) return { ok: c.value === '', apagou: false };
  const definir = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  definir.call(c, '');
  c.dispatchEvent(new Event('input', { bubbles: true }));
  return { ok: true, apagou: true };
})()`;

/** Aperta "Enviar" — o da GAVETA, pelo texto exato e pela classe dele (nunca o "Cheguei" do resumo). */
const APERTAR_ENVIAR = `(() => {
  ${VIS}
  const g = ${GAVETA};
  const b = g && [...g.querySelectorAll('button.im-chat-window-edit-btn')].find((x) => vis(x) && (x.innerText || '').trim() === 'Enviar');
  if (!b || b.disabled || /is-disabled/.test(b.className)) return false;
  b.click();
  return true;
})()`;

/** Onde clicar no voltar da gaveta (fecha a conversa). */
const VOLTAR = `(() => {
  ${VIS}
  const g = ${GAVETA};
  const v = g && [...g.querySelectorAll('.im-chat-items-icon-back')].find(vis);
  return v ? (${CENTRO})(v) : null;
})()`;

/** Limpa a busca (vazio + Enter): a lista volta. */
const LIMPAR_BUSCA = `(() => {
  const b = ${BUSCA};
  if (!b || b.value === '') return { ok: true, limpou: false };
  const definir = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  definir.call(b, '');
  b.dispatchEvent(new Event('input', { bubbles: true }));
  for (const t of ['keydown', 'keypress', 'keyup']) b.dispatchEvent(new KeyboardEvent(t, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
  return { ok: true, limpou: true };
})()`;

/** Onde clicar na aba (pelo nome, sem a contagem). */
const ABA = (nome) => `(() => {
  ${VIS}
  const a = [...document.querySelectorAll('.order-primary-tabs__item')].find((x) => vis(x) && (x.innerText || '').replace(/\\s*\\(\\d+\\)\\s*$/, '').replace(/\\s+/g, ' ').trim() === ${JSON.stringify(String(nome))});
  return a ? (${CENTRO})(a) : null;
})()`;

/** Antes do clique do programa: o vigia da tela (`tela-livre.js`) não conta este clique como de gente. */
const CLIQUE_DO_PROGRAMA = 'window.__ponteCliqueAte = Date.now() + 800; true';

/**
 * Um clique de mouse de verdade, pelo depurador (não mexe no mouse do PC nem tira o foco de ninguém). Avisa o vigia antes:
 * o clique é "de verdade" (`isTrusted`) e, sem o aviso, o programa se acharia uma pessoa mexendo e desistiria.
 */
async function clicar({ pagina, cdp }, { x, y }) {
  await pagina.executeJavaScript(CLIQUE_DO_PROGRAMA);
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function ate(fn, ok, prazoMs, passoMs = 250) {
  const fim = Date.now() + prazoMs;
  let ultimo = null;
  for (;;) {
    try {
      ultimo = await fn();
    } catch {
      ultimo = null;
    }
    if (ok(ultimo)) return ultimo;
    if (Date.now() >= fim) return ultimo;
    await esperar(passoMs);
  }
}

/**
 * Abre a conversa do pedido na 99: busca pelo número, confere o resumo, clica no balão (de novo uma vez, se nada abrir),
 * confere o número da conversa e espera o campo. { ok, etapas } — ou { ok: false, codigo, definitivo?, adiar?, etapas }.
 */
async function abrirConversa(ctx, { numero }, { buscaMs = BUSCA_MS, gavetaMs = GAVETA_MS, cliqueMs = CLIQUE_MS, campoMs = CAMPO_MS } = {}) {
  const { pagina, cdp } = ctx;
  const etapas = [];
  const falhou = (codigo, motivo, extra = {}) => ({ ok: false, codigo, etapas: [...etapas, `✗ ${motivo}`], ...extra });
  if (!NUMERO.test(String(numero || ''))) return falhou('sem_numero', 'a mensagem veio sem o número do pedido na 99', { definitivo: true });
  const alvo = `#${numero}`;
  const g0 = await pagina.executeJavaScript(GAVETA_ABERTA);
  if (g0 && g0.aberta) return falhou('gaveta_aberta', 'há uma conversa aberta na 99 (de alguém da loja)', { adiar: true });
  const b = await pagina.executeJavaScript(BUSCAR(numero));
  if (!b || !b.ok) return falhou('busca', (b && b.motivo) || 'a busca da 99 não respondeu');
  const achado = await ate(() => pagina.executeJavaScript(PEDIDO_NA_BUSCA(numero)), (r) => !!r && (r.achou || r.vazio), buscaMs);
  if (achado && achado.vazio) return falhou('sem_pedido', `a busca da 99 não achou o pedido ${alvo} entre os em andamento`, { definitivo: true });
  if (!achado || !achado.achou) return falhou('busca', `a busca da 99 não mostrou o pedido ${alvo}`);
  etapas.push(`✓ achei o pedido ${alvo} na busca da 99 (resumo aberto)`);
  let gaveta = null;
  for (let clique = 1; clique <= 2; clique++) {
    let balao = await pagina.executeJavaScript(BALAO(numero));
    if (balao && balao.rolou) {
      await esperar(400);
      balao = await pagina.executeJavaScript(BALAO(numero));
    }
    if (!balao || !balao.ok) return falhou('balao', (balao && balao.motivo) || 'o botão do chat não respondeu');
    await clicar(ctx, balao);
    gaveta = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (g) => !!g && g.aberta && !!g.numero, cliqueMs);
    if (gaveta && gaveta.aberta) break;
    // nada abriu: o clique se perdeu (como no iFood, ERR-380) — de novo, UMA vez
  }
  if (!gaveta || !gaveta.aberta) return falhou('gaveta', 'cliquei no botão do chat e a conversa não abriu');
  if (gaveta.numero !== alvo) return falhou('numero_errado', `a conversa aberta é a do ${gaveta.numero || '(sem número)'}, não a do ${alvo} — não escrevi nada`, { fecharGaveta: true });
  etapas.push(`✓ a conversa aberta é a do ${alvo}`);
  const pronta = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (g) => !!g && g.aberta && g.campo, campoMs, 500);
  if (!pronta || !pronta.aberta) return falhou('gaveta', 'a conversa fechou antes de carregar');
  if (pronta.numero !== alvo) return falhou('numero_errado', `a conversa mudou para a do ${pronta.numero} — não escrevi nada`, { fecharGaveta: true });
  if (!pronta.campo) return falhou('sem_campo', 'a conversa da 99 não terminou de carregar (o campo não apareceu)', { fecharGaveta: true });
  etapas.push('✓ a conversa carregou (o campo está na tela)');
  return { ok: true, etapas };
}

/**
 * Envia `texto` na conversa do pedido `numero` da 99. Mesmo contrato do envio do iFood (`envio-ifood.js#enviar`, que a
 * fila de saída usa): { ok, id } · { ok: true, jaEstava } · { incerto, apertou } · { ok: false, codigo, adiar?, definitivo? }.
 */
async function enviar(ctx, { numero, pedidoExterno, texto }, { ecoMs = 20000, aoApertar, podeApertar, jaEstaNoChat, ...prazos } = {}) {
  const t = String(texto || '').trim();
  if (!t) return { ok: false, etapas: ['✗ escreva o texto'] };
  const a = await abrirConversa(ctx, { numero }, prazos);
  if (!a.ok) return a;
  const etapas = [...a.etapas];
  const ja = jaEstaNoChat ? await jaEstaNoChat() : null;
  if (ja && ja.id) return { ok: true, jaEstava: true, id: ja.id, etapas: [...etapas, '✓ a mensagem já estava na conversa — não escrevi de novo'] };
  const e = await ctx.pagina.executeJavaScript(ESCREVER(t));
  if (e && e.ocupado) return { ok: false, adiar: true, codigo: 'campo_com_texto', etapas: [...etapas, `✗ ${e.motivo}`] };
  const apagar = () => ctx.pagina.executeJavaScript(APAGAR_SE_IGUAL(t)).catch(() => null);
  const lido = await ctx.pagina.executeJavaScript(GAVETA_ABERTA);
  if (!e || !e.ok || !lido || lido.valor !== t || !lido.enviarLigado) {
    await apagar();
    const motivo = !e || !e.ok ? (e && e.motivo) || 'não deu para escrever' : !lido || lido.valor !== t ? 'o campo não ficou com o texto' : 'o "Enviar" não ligou com o texto no campo';
    return { ok: false, codigo: 'escrever', etapas: [...etapas, `✗ ${motivo} (o texto do programa foi apagado; nada foi enviado)`] };
  }
  if (lido.numero !== `#${numero}`) {
    await apagar();
    return { ok: false, codigo: 'numero_errado', fecharGaveta: true, etapas: [...etapas, '✗ a conversa mudou antes de apertar — apaguei o texto'] };
  }
  etapas.push('✓ escrevi o texto no campo da conversa');
  if (podeApertar && !(await podeApertar())) {
    await apagar();
    return { ok: false, adiar: true, codigo: 'pessoa', etapas: [...etapas, '✗ alguém voltou a mexer na 99 — não apertei; o texto do programa foi apagado'] };
  }
  const desde = Date.now();
  // Escuta a confirmação ANTES de apertar (ela pode chegar antes de o clique "terminar" — ERR-375).
  const esperandoEco = ctx.leitor.esperarEco({ pedidoExterno, texto: t, desde, prazoMs: ecoMs });
  if (aoApertar) await aoApertar();
  if (!(await ctx.pagina.executeJavaScript(APERTAR_ENVIAR))) {
    await apagar();
    return { ok: false, codigo: 'botao', etapas: [...etapas, '✗ o "Enviar" da conversa não aceitou o clique (nada foi enviado)'] };
  }
  etapas.push('✓ apertei "Enviar"');
  const eco = await esperandoEco;
  if (!eco) return { ok: false, incerto: true, apertou: true, codigo: 'sem_eco', etapas: [...etapas, '✗ a 99 não confirmou o envio a tempo — confira no portal da 99 antes de tentar de novo'] };
  etapas.push('✓ a 99 confirmou: enviada');
  return { ok: true, apertou: true, etapas, id: eco.id };
}

/**
 * Devolve a tela como estava: fecha a conversa (pelo voltar — nunca com o texto do programa no campo: o envio já apagou),
 * limpa a busca que o programa fez e volta à aba que estava aberta.
 */
async function voltar(ctx, antes) {
  const { pagina, cdp } = ctx;
  const feito = { gaveta: false, busca: false, aba: false };
  const g = await pagina.executeJavaScript(GAVETA_ABERTA).catch(() => null);
  if (g && g.aberta && !(g.valor || '').trim()) {
    const v = await pagina.executeJavaScript(VOLTAR).catch(() => null);
    if (v) {
      await clicar(ctx, v);
      const fechou = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (x) => !!x && !x.aberta, 3000);
      feito.gaveta = !!fechou && !fechou.aberta;
    }
  }
  if (!antes || antes.busca === '' || antes.busca === null) {
    const l = await pagina.executeJavaScript(LIMPAR_BUSCA).catch(() => null);
    feito.busca = !!(l && l.limpou);
    if (feito.busca) await esperar(800);
  }
  if (antes && antes.aba) {
    const agora = await pagina.executeJavaScript(ESTADO_DA_TELA).catch(() => null);
    if (agora && agora.aba !== antes.aba) {
      const a = await pagina.executeJavaScript(ABA(antes.aba)).catch(() => null);
      if (a) {
        await clicar(ctx, a);
        feito.aba = true;
      }
    }
  }
  return feito;
}

/**
 * A janela da 99 está livre para o programa? Livre = o portal na lista de pedidos, NENHUMA conversa aberta (alguém da loja
 * pode estar lendo), nada no campo de nenhuma conversa, a busca vazia (alguém procurando um pedido) e ninguém mexendo há
 * `paradaMs` (o vigia da página — `tela-livre.js#INSTALAR_VIGIA` — e o teclado da janela).
 */
function avaliarTela(e, { agora = Date.now(), ultimaTeclaEm = 0, paradaMs = 10000 } = {}) {
  if (!e) return { ok: false, motivo: 'a página da 99 não respondeu' };
  if (!e.vigia) return { ok: false, motivo: 'o vigia da tela ainda não está na página da 99' };
  if (!e.portal) return { ok: false, motivo: 'a 99 não está na lista de pedidos' };
  if (e.gaveta) return { ok: false, motivo: 'há uma conversa aberta na 99' };
  if (e.campoComTexto) return { ok: false, motivo: 'há um texto no campo de uma conversa (de alguém da loja)' };
  if (e.busca) return { ok: false, motivo: 'alguém está buscando um pedido na 99' };
  const ultima = Math.max(Number(e.acaoEm) || 0, Number(e.vigiaDesde) || 0, Number(ultimaTeclaEm) || 0);
  if (agora - ultima < paradaMs) return { ok: false, motivo: 'alguém está usando a 99 agora' };
  return { ok: true };
}

module.exports = {
  abrirConversa,
  enviar,
  voltar,
  avaliarTela,
  clicar,
  NUMERO,
  ROTEIROS: { ESTADO_DA_TELA, BUSCAR, PEDIDO_NA_BUSCA, BALAO, GAVETA_ABERTA, ESCREVER, APAGAR_SE_IGUAL, APERTAR_ENVIAR, VOLTAR, LIMPAR_BUSCA, ABA, CLIQUE_DO_PROGRAMA },
};
