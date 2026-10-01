// Volta para a página "Autorizar o <aplicativo>" depois do login (trilha C, C1b).
//
// Quem chega do aplicativo sem sessão no Regem cai no login; ao entrar, volta para a
// autorização que estava pedindo. O caminho fica em sessionStorage (só desta aba, some ao
// fechá-la) — é preferência de navegação, não dado de negócio.
//
// Só vale caminho DESTA página (nunca um endereço de fora) e por 15 minutos: mais do que isso,
// o pedido do aplicativo já venceu.

const CHAVE = 'regem_volta_autorizacao';
const PREFIXO = '/integracoes/autorizar?';
const VALIDADE_MS = 15 * 60 * 1000;
const ROTULOS: Record<string, string> = { liame: 'o Liame' };

type Guardado = { caminho: string; em: number };

function ler(): Guardado | null {
  if (typeof window === 'undefined') return null;
  try {
    const g = JSON.parse(sessionStorage.getItem(CHAVE) || 'null') as Guardado | null;
    if (!g || typeof g.caminho !== 'string' || typeof g.em !== 'number') return null;
    if (!g.caminho.startsWith(PREFIXO) || g.caminho.length > 2000) return null;
    if (Date.now() - g.em > VALIDADE_MS) return null;
    return g;
  } catch {
    return null;
  }
}

/** Guarda o caminho da autorização em andamento (o que não for desta página é ignorado). */
export function guardarVoltaAutorizacao(caminho: string) {
  if (typeof window === 'undefined' || !caminho.startsWith(PREFIXO)) return;
  try {
    sessionStorage.setItem(CHAVE, JSON.stringify({ caminho, em: Date.now() } satisfies Guardado));
  } catch {
    /* sem armazenamento (aba anônima restrita): o login leva ao início, como sempre */
  }
}

export function limparVoltaAutorizacao() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CHAVE);
  } catch {
    /* nada a limpar */
  }
}

/**
 * O caminho para onde o login leva, ou `null` se não há autorização esperando. Só LÊ: quem
 * esquece o caminho é a própria página de autorização, quando abre — o login pode perguntar mais
 * de uma vez (o efeito do React roda duas vezes em desenvolvimento) sem perder a volta.
 */
export function voltaAutorizacao(): string | null {
  return ler()?.caminho ?? null;
}

/** Quem pediu a autorização que está esperando o login ("o Liame"), para o aviso da tela de entrar. */
export function quemEsperaAutorizacao(): string | null {
  const g = ler();
  if (!g) return null;
  const cliente = new URLSearchParams(g.caminho.slice(PREFIXO.length)).get('cliente') ?? '';
  return ROTULOS[cliente] ?? 'o aplicativo';
}
