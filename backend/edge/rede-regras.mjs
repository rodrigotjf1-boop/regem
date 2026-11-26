// A CONEXÃO DO SERVIDOR DA LOJA COM A NUVEM (1.30.16; análise de rede de 25–26/11/2026). ESM puro, sem import: o teste
// (src/modules/sync/rede-nuvem.spec.ts) avalia este arquivo como texto, e o sync-daemon.mjs cria com ele o agente do undici.
//
// O que se mediu na loja: 35–50% das conexões NOVAS ficavam sem resposta (até o roteador ser reiniciado em 26/11 01:12) e o
// log do sync tinha 6 a 13 UND_ERR_CONNECT_TIMEOUT por dia. O undici guardava a conexão aberta só por 4 s e esperava até
// 10 s para abrir outra — quase toda chamada do ciclo pagava uma abertura nova, que podia ficar presa 10 s. Agora:
//   • a conexão fica aberta 60 s sem uso (abaixo do tempo ocioso da Cloudflare): o ciclo seguinte reaproveita;
//   • a abertura tem 3 s e, se falhar, a nova tentativa sai NA HORA — o pedido nem saiu, então vale até para o envio (POST);
//   • um agente só para todas as chamadas do daemon (o envio rápido e a conferência dos pedidos usam o mesmo fetchT).
// Variáveis: SYNC_KEEPALIVE_MS (1–90 s) e SYNC_CONEXAO_MS (1–30 s). Na simulação, só o keep-alive levou os pedidos com mais
// de 1 min de 2,4% para 0%.

export const KEEPALIVE_PADRAO_MS = 60000;
export const ABERTURA_PADRAO_MS = 3000;

function numeroEntre(valor, padrao, minimo, maximo) {
  const n = Number(valor);
  if (!Number.isFinite(n) || n <= 0) return padrao;
  return Math.min(maximo, Math.max(minimo, Math.round(n)));
}

/** As opções do `Agent` do undici (as mesmas para todas as chamadas à nuvem). */
export function opcoesDoAgente(env = {}) {
  const keepAlive = numeroEntre(env.SYNC_KEEPALIVE_MS, KEEPALIVE_PADRAO_MS, 1000, 90000);
  const abertura = numeroEntre(env.SYNC_CONEXAO_MS, ABERTURA_PADRAO_MS, 1000, 30000);
  // keepAliveMaxTimeout = o mesmo: a dica do servidor (cabeçalho Keep-Alive) não segura a conexão além disso.
  return { keepAliveTimeout: keepAlive, keepAliveMaxTimeout: keepAlive, connect: { timeout: abertura } };
}

/**
 * A falha foi na ABERTURA da conexão (o pedido nem chegou a sair)? Prazo de abertura, recusa, rede ou nome que não
 * resolve. `causa` = o texto do `causaErro` do daemon (código + mensagem, com as causas aninhadas do undici).
 */
export function ehFalhaDeAbertura(causa) {
  return /UND_ERR_CONNECT_TIMEOUT|Connect Timeout Error|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_AGAIN|ENOTFOUND/i.test(String(causa ?? ''));
}

/** Quanto esperar antes da próxima tentativa: nada na falha de abertura (tentar de novo na hora); 0,6 s × n no resto. */
export function pausaAntesDeTentarDeNovo(causa, tentativa) {
  return ehFalhaDeAbertura(causa) ? 0 : 600 * Math.max(1, Number(tentativa) || 1);
}

// O QUE O PRÓPRIO SYNC VIU DA NUVEM (a medida da batida que o vigia usa). O agente conta cada conexão que abriu para a
// nuvem e as que falharam ao abrir (prazo, recusa, rede, TLS), e o fetchT conta as novas tentativas. Os contadores TCP do
// Windows NÃO servem para o alerta: são do PC inteiro e, na loja, as tentativas presas na REDE LOCAL (a impressora que não
// existe mais, a otimização de entrega do Windows Update entre os PCs, um sistema antigo tentando um MySQL) davam 41% de
// falhas e 6,5% de retransmissão com a internet sã (medição da regen-30, 26/11 03:28). Com o keep-alive longo o sync abre
// poucas conexões por minuto: a soma é de uma janela de 30 min. Rede ruim (25/11): 34–53% das aberturas sem resposta;
// rede sã: 0 em 120.
export const JANELA_DA_REDE_MS = 30 * 60 * 1000;

/**
 * Soma das contagens das batidas dentro da janela. `historico` = [{ em: ms, aberturas, falhas, novasTentativas }, …]
 * (uma por batida, contagem desde a anterior). Sem batida na janela: null.
 */
export function resumoDaJanela(historico, agora, janelaMs = JANELA_DA_REDE_MS) {
  const dentro = (Array.isArray(historico) ? historico : []).filter((h) => h && agora - h.em <= janelaMs && agora >= h.em);
  if (!dentro.length) return null;
  const soma = (k) => dentro.reduce((s, h) => s + (Number(h[k]) > 0 ? Number(h[k]) : 0), 0);
  const aberturas = soma('aberturas');
  const falhas = soma('falhas');
  return {
    aberturas,
    falhas,
    falhasPct: aberturas > 0 ? Math.round((falhas / aberturas) * 1000) / 10 : 0,
    novasTentativas: soma('novasTentativas'),
    janelaMin: Math.round((agora - Math.min(...dentro.map((h) => h.em))) / 60000) || 1,
  };
}
