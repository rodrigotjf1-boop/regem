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
// O painel do pedido ainda entra na tela logo depois da busca: em 07/11 o balão vinha "há algo na frente" na hora e livre
// 2,5 s depois — e a ponte desistia (o envio pela 99 nunca saía). Confere de novo até este prazo.
const BALAO_MS = 4000;
const CAMPO_MS = 45000; // o campo levou 30 s com a loja fechada (06/11); com folga
// 11/11: a 99 lenta abriu a gaveta DEPOIS dos 2,5 s do clique (e já com o esqueleto de "carregando"), com o número do
// pedido chegando só depois. A ponte desistia, o "voltar" não achava nada para fechar e a gaveta aparecia em seguida —
// aberta por ela, mas lida como "alguém da loja usando a 99": a fila da 99 ficou parada das 20h47 até ser reiniciada.
// Depois dos cliques, a gaveta que abre até este prazo é do programa (usa ou fecha).
const TARDE_MS = 30000;
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

/**
 * Onde clicar no balão do chat do resumo (o centro, conferido pelo que está pintado ali). Fora da vista: rola até ele.
 * Uma NOTIFICAÇÃO da própria 99 na frente (`.pb-notification` — a "verifique sua conexão de internet" fica fixa no canto
 * de cima, por cima do resumo: era ela que travava o envio pela 99, 06–09/11) é só aviso: fecha no X dela e confere de
 * novo. Qualquer outra coisa na frente: não clica, e o motivo diz QUAL peça (só a tag e as classes, nunca texto).
 */
const BALAO = (numero) => `(() => {
  ${VIS}
  const painel = document.querySelector('main.order-container__detail .index-number');
  if (!painel || (painel.textContent || '').trim() !== '#' + ${JSON.stringify(String(numero))}) return { ok: false, motivo: 'o resumo aberto não é deste pedido' };
  const b = [...document.querySelectorAll('main.order-container__detail .receiver-info__chat-action')].find(vis);
  if (!b) return { ok: false, motivo: 'o resumo do pedido não mostra o botão do chat' };
  const c = (${CENTRO})(b);
  if (c.x < 0 || c.y < 0 || c.x > innerWidth || c.y > innerHeight) { b.scrollIntoView({ block: 'center' }); return { ok: false, rolou: true, motivo: 'o botão do chat estava fora da vista' }; }
  const topo = document.elementFromPoint(c.x, c.y);
  if (!topo || !(topo === b || b.contains(topo))) {
    const aviso = topo && topo.closest ? topo.closest('.pb-notification') : null;
    const fechar = aviso ? aviso.querySelector('.pb-notification__closeBtn') : null;
    if (fechar) { fechar.click(); return { ok: false, fechouAviso: true, motivo: 'fechei uma notificação da 99 que estava na frente do botão do chat' }; }
    const peca = topo ? (topo.tagName.toLowerCase() + '.' + String(topo.className || '').split(/\\s+/).filter(Boolean).slice(0, 3).join('.')).slice(0, 80) : 'nada';
    return { ok: false, motivo: 'há algo na frente do botão do chat (' + peca + ')' };
  }
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
    // 11/11: a conversa ainda carregando (o esqueleto da 99) e a conversa ENCERRADA pela 99 (o pedido concluído).
    carregando: [...g.querySelectorAll('.im-chat-window-skeleton, .im-chat-window-edit-skeleton')].some(vis),
    encerrada: /não é possível enviar mensagens/i.test(g.innerText || ''),
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
async function abrirConversa(ctx, { numero }, { buscaMs = BUSCA_MS, gavetaMs = GAVETA_MS, cliqueMs = CLIQUE_MS, campoMs = CAMPO_MS, balaoMs = BALAO_MS, tardeMs = TARDE_MS } = {}) {
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
    // O balão livre — o painel pode estar entrando (algo na frente, fora da vista: rola e confere de novo) até o prazo; o
    // resumo de OUTRO pedido não é passageiro: para na hora.
    const balao = await ate(
      async () => {
        const b = await pagina.executeJavaScript(BALAO(numero));
        if (b && b.rolou) {
          await esperar(400);
          return pagina.executeJavaScript(BALAO(numero));
        }
        return b;
      },
      (b) => !!b && (b.ok || /não é deste pedido/.test(b.motivo || '')),
      balaoMs,
      300,
    );
    if (!balao || !balao.ok) return falhou('balao', (balao && balao.motivo) || 'o botão do chat não respondeu');
    await clicar(ctx, balao);
    // a hora do clique fica no ctx: o `voltar` espera (e fecha) a gaveta que a 99 lenta ainda vai abrir
    ctx.balaoClicadoEm = Date.now();
    // aberta já basta aqui: o número do pedido chega depois do esqueleto e é esperado logo abaixo, com o prazo do carregar
    gaveta = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (g) => !!g && g.aberta, cliqueMs);
    if (gaveta && gaveta.aberta) break;
    // nada abriu: o clique se perdeu (como no iFood, ERR-380) — de novo, UMA vez
  }
  if (!gaveta || !gaveta.aberta) {
    // 11/11: a 99 lenta abre a gaveta DEPOIS do prazo do clique — ela é do programa: espera e segue com ela
    gaveta = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (g) => !!g && g.aberta, tardeMs, 500);
    if (gaveta && gaveta.aberta) etapas.push('✓ a conversa abriu atrasada (a 99 estava lenta)');
  }
  if (!gaveta || !gaveta.aberta) return falhou('gaveta', 'cliquei no botão do chat e a conversa não abriu');
  // o número do pedido aparece quando a conversa termina de carregar: espera enquanto ela carrega
  if (!gaveta.numero) gaveta = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (g) => !g || !g.aberta || !!g.numero, campoMs, 500);
  if (!gaveta || !gaveta.aberta) return falhou('gaveta', 'a conversa fechou antes de carregar');
  if (gaveta.numero !== alvo) return falhou('numero_errado', `a conversa aberta é a do ${gaveta.numero || '(sem número)'}, não a do ${alvo} — não escrevi nada`, { fecharGaveta: true });
  etapas.push(`✓ a conversa aberta é a do ${alvo}`);
  const pronta = await ate(
    () => pagina.executeJavaScript(GAVETA_ABERTA),
    (g) => !!g && (!g.aberta || g.encerrada || (g.campo && !g.carregando)),
    campoMs,
    500,
  );
  if (!pronta || !pronta.aberta) return falhou('gaveta', 'a conversa fechou antes de carregar');
  if (pronta.numero !== alvo) return falhou('numero_errado', `a conversa mudou para a do ${pronta.numero} — não escrevi nada`, { fecharGaveta: true });
  // 11/11: a 99 fecha o chat do pedido concluído ("Não é possível enviar mensagens porque este pedido foi concluído"):
  // tentar de novo não adianta — falha definitiva, com o motivo para a equipe
  if (pronta.encerrada) {
    return falhou('encerrada', 'a 99 encerrou a conversa deste pedido ("não é possível enviar mensagens"): o aviso não tem como chegar ao cliente', {
      definitivo: true,
      fecharGaveta: true,
    });
  }
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
async function voltar(ctx, antes, { tardeMs = TARDE_MS } = {}) {
  const { pagina } = ctx;
  const feito = { gaveta: false, busca: false, aba: false };
  let g = await pagina.executeJavaScript(GAVETA_ABERTA).catch(() => null);
  // 11/11: o programa clicou no balão há pouco e a gaveta ainda não abriu — a 99 lenta a abre atrasada; sem esperar, ela
  // ficava aberta depois do envio e a fila da 99 parava ("há uma conversa aberta"), achando que era alguém da loja
  const desdeOClique = ctx.balaoClicadoEm ? Date.now() - ctx.balaoClicadoEm : Infinity;
  if ((!g || !g.aberta) && desdeOClique < tardeMs) {
    g = await ate(() => pagina.executeJavaScript(GAVETA_ABERTA), (x) => !!x && x.aberta, tardeMs - desdeOClique, 500);
    feito.esperouAtrasada = true;
  }
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

/**
 * A conversa aberta na 99 é a que o PROGRAMA deixou (e pode fechar)? Sim só quando: há gaveta, nenhum texto em campo
 * algum, a gaveta é do pedido do último envio (ou ainda sem número, carregando) e NINGUÉM mexeu na janela desde o clique
 * do programa (o vigia da página, a hora em que ele foi instalado e o teclado da janela — tudo antes da marca).
 * `marca` = { numero: '#436003', em: hora do envio }, guardada pelo `main.js` a cada envio pela 99.
 */
function gavetaEhDoPrograma(e, marca, { ultimaTeclaEm = 0 } = {}) {
  if (!e || !e.gaveta || !marca || !marca.em) return false;
  if (e.campoComTexto) return false;
  if (e.gavetaNumero && e.gavetaNumero !== marca.numero) return false;
  const gente = Math.max(Number(e.acaoEm) || 0, Number(e.vigiaDesde) || 0, Number(ultimaTeclaEm) || 0);
  return gente < marca.em;
}

module.exports = {
  abrirConversa,
  enviar,
  voltar,
  avaliarTela,
  gavetaEhDoPrograma,
  TARDE_MS,
  clicar,
  NUMERO,
  ROTEIROS: { ESTADO_DA_TELA, BUSCAR, PEDIDO_NA_BUSCA, BALAO, GAVETA_ABERTA, ESCREVER, APAGAR_SE_IGUAL, APERTAR_ENVIAR, VOLTAR, LIMPAR_BUSCA, ABA, CLIQUE_DO_PROGRAMA },
};
