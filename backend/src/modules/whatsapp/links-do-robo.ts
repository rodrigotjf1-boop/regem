// SÓ O LINK DA LOJA — trava de toda resposta do robô (publico/bot/responder). No teste dos modelos de 29/10/2026 o
// Gemini, com o cardápio do Regem em mãos, escreveu em 4 de 40 respostas o endereço da loja em OUTROS sistemas de
// cardápio (anota.ai, Goomer, Zaply) — tirado da memória dele, não da loja (a base de conhecimento estava vazia). A
// instrução do robô proíbe; aqui o Regem garante: link de fora vira o link do cardápio da loja antes de sair.

const ENDERECO = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;
const PONTUACAO_NO_FIM = /[.,;:!?)\]}]+$/;

/** O link público do cardápio da loja (o mesmo do CardapioService.linkDoCardapio). */
export function linkDoCardapioDaLoja(token: string): string {
  const base = (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/$/, '');
  return `${base}/c/${token}`;
}

/** "app.dmsregem.com" de "https://www.App.dmsregem.com/c/x" (sem www, minúsculo); null se não der para ler. */
export function hostDe(endereco: unknown): string | null {
  const s = String(endereco ?? '').trim();
  if (!s) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.hostname.toLowerCase().replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

/**
 * Troca todo endereço cujo site não seja o do cardápio da loja (ou um dos `outrosPermitidos`, como o site próprio da
 * loja) pelo link do cardápio. Se o link certo já está na mensagem, o de fora sai sem repetir o certo.
 */
export function soLinksDaLoja(
  texto: string,
  linkDaLoja: string,
  outrosPermitidos: (string | null | undefined)[] = [],
): { texto: string; trocados: number } {
  const hostDaLoja = hostDe(linkDaLoja);
  const permitidos = new Set([hostDaLoja, ...outrosPermitidos.map(hostDe)].filter(Boolean) as string[]);
  const jaTemOCerto = String(texto ?? '').includes(linkDaLoja);
  let trocados = 0;
  let saida = String(texto ?? '').replace(ENDERECO, (achado) => {
    const fim = (achado.match(PONTUACAO_NO_FIM) ?? [''])[0];
    const endereco = fim ? achado.slice(0, -fim.length) : achado;
    const host = hostDe(endereco);
    if (host && permitidos.has(host)) return achado;
    trocados++;
    return (jaTemOCerto ? '' : linkDaLoja) + fim;
  });
  if (trocados && !jaTemOCerto) {
    // Dois endereços de fora na mesma mensagem viram o mesmo link: fica só o primeiro.
    const primeiro = saida.indexOf(linkDaLoja);
    saida = saida.slice(0, primeiro + linkDaLoja.length) + saida.slice(primeiro + linkDaLoja.length).split(linkDaLoja).join('');
  }
  if (trocados) saida = saida.replace(/[ \t]+([.,;:!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').trim();
  return { texto: saida, trocados };
}

// O que costuma vir logo antes do link ("acesse", "no link", "por aqui:") e sobra solto quando o link vira botão.
const CHAMADA_DO_LINK = /(?:\s|^)(?:acesse(?: o link)?|clique(?: aqui| no link)?|pelo link|no link|neste link|nesse link|por aqui|aqui|em|no|pelo)\s*:?\s*$/i;

/**
 * BOTÃO "VER CARDÁPIO" (API oficial, 30/10/2026): acha no texto o primeiro link do site do cardápio da loja (o
 * personalizado também — mesmo site) e devolve o texto SEM ele, para o link ir num botão. Sem link da loja: null.
 */
export function separarLinkDoCardapio(texto: string, linkDaLoja: string): { corpo: string; url: string } | null {
  const hostDaLoja = hostDe(linkDaLoja);
  if (!hostDaLoja) return null;
  const t = String(texto ?? '');
  let achado: { inicio: number; fim: number; url: string } | null = null;
  for (const m of t.matchAll(ENDERECO)) {
    const bruto = m[0];
    const fimPont = (bruto.match(PONTUACAO_NO_FIM) ?? [''])[0];
    const url = fimPont ? bruto.slice(0, -fimPont.length) : bruto;
    if (hostDe(url) === hostDaLoja) {
      achado = { inicio: m.index ?? 0, fim: (m.index ?? 0) + url.length, url: /^https?:\/\//i.test(url) ? url : `https://${url}` };
      break;
    }
  }
  if (!achado) return null;
  const antes = t.slice(0, achado.inicio).replace(CHAMADA_DO_LINK, '');
  const corpo = (antes + t.slice(achado.fim))
    .replace(/[ \t]+([.,;:!?])/g, '$1')
    .replace(/,\s*([.!?])/g, '$1')
    .replace(/:\s*([.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .replace(/\s*:$/, ''); // "Confira o cardápio: <link>" → "Confira o cardápio"
  return { corpo, url: achado.url.replace(/^http:\/\//i, 'https://') };
}
