import { AsyncLocalStorage } from 'node:async_hooks';

// OBSERVAR AS CHAMADAS A SERVIÇOS EXTERNOS feitas dentro de um trecho de código — sem mudar a
// chamada. Serve para REGISTRAR o que saiu (ex.: o status do pedido enviado ao canal): quem
// quer saber abre a observação em volta do envio; o `fetchExterno`, por onde todas as chamadas
// a canais passam, anota cada uma no contexto aberto. Fora de uma observação o custo é zero e
// nada muda.
//
// O contexto é do FLUXO que o abriu (AsyncLocalStorage): duas requisições ao mesmo tempo não
// se enxergam — não é estado compartilhado.
//
// O que se guarda de cada chamada: método, destino SEM a query (a 99Food manda o token nela),
// código HTTP, duração e um trecho curto da resposta (onde o canal diz por que recusou).
// Nunca o corpo enviado nem os cabeçalhos.

export interface ChamadaExterna {
  metodo: string;
  /** host + caminho, sem query e sem credencial. */
  destino: string;
  /** Código HTTP; null quando não houve resposta. */
  status: number | null;
  ok: boolean;
  ms: number;
  /** Trecho da resposta do serviço (aparado e sem nada que pareça credencial). */
  trecho?: string;
  /** 'timeout' | 'rede' quando não houve resposta. */
  erro?: 'timeout' | 'rede';
}

interface Contexto {
  chamadas: ChamadaExterna[];
  pendentes: Promise<void>[];
}

const contexto = new AsyncLocalStorage<Contexto>();
const TRECHO_MAX = 240;

/** Tira do texto o que não pode ir para um registro: sequências longas com cara de credencial. */
export function trechoSeguro(texto: string): string {
  return texto
    .replace(/\s+/g, ' ')
    .replace(/[A-Za-z0-9_\-+/=.]{32,}/g, '…')
    .trim()
    .slice(0, TRECHO_MAX);
}

/** host + caminho de uma URL, sem query, sem usuário/senha. Nunca lança. */
export function destinoSemQuery(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.slice(0, 200);
  } catch {
    return String(url).split('?')[0].slice(0, 200);
  }
}

export interface Observacao<T> {
  valor?: T;
  /** A função lançou (o erro vem em `erro`). */
  lancou: boolean;
  erro?: unknown;
  chamadas: ChamadaExterna[];
}

/** Roda `fn` anotando as chamadas externas que ela fizer. NUNCA lança: o erro de `fn` volta em `erro`. */
export async function observarChamadasExternas<T>(fn: () => Promise<T>): Promise<Observacao<T>> {
  const ctx: Contexto = { chamadas: [], pendentes: [] };
  const saida: Observacao<T> = { lancou: false, chamadas: ctx.chamadas };
  await contexto.run(ctx, async () => {
    try {
      saida.valor = await fn();
    } catch (e) {
      saida.lancou = true;
      saida.erro = e;
    }
  });
  // os trechos das respostas são lidos em paralelo com quem chamou: espera terminarem
  await Promise.allSettled(ctx.pendentes);
  return saida;
}

/** Há uma observação aberta neste fluxo? (o `fetchExterno` pergunta antes de anotar) */
export function observando(): boolean {
  return contexto.getStore() !== undefined;
}

/** Anota a resposta de uma chamada. Lê o trecho de uma CÓPIA: quem chamou lê a resposta normalmente. */
export function anotarResposta(metodo: string | undefined, url: string, res: Response, ms: number): void {
  const ctx = contexto.getStore();
  if (!ctx) return;
  const chamada: ChamadaExterna = { metodo: (metodo ?? 'GET').toUpperCase(), destino: destinoSemQuery(url), status: res.status, ok: res.ok, ms };
  ctx.chamadas.push(chamada);
  try {
    ctx.pendentes.push(
      res
        .clone()
        .text()
        .then((t) => {
          if (t) chamada.trecho = trechoSeguro(t);
        })
        .catch(() => undefined),
    );
  } catch {
    /* resposta sem corpo clonável: fica sem trecho */
  }
}

/** Anota uma chamada que não teve resposta (tempo esgotado ou falha de rede). */
export function anotarFalha(metodo: string | undefined, url: string, erro: 'timeout' | 'rede', ms: number): void {
  const ctx = contexto.getStore();
  if (!ctx) return;
  ctx.chamadas.push({ metodo: (metodo ?? 'GET').toUpperCase(), destino: destinoSemQuery(url), status: null, ok: false, ms, erro });
}
