import { createHmac } from 'node:crypto';
import { EscopoIntegracao, WEBHOOK_INTEGRACAO } from './escopos';

// AVISOS (webhooks) da API de integração — as regras puras (trilha C, C3b — mig 304).
//
// O aviso é SÓ GATILHO de frescor: diz "algo mudou nesta loja" e quem recebe lê pela rota com
// cursor. Por isso não há fila de eventos: dez mudanças seguidas viram UM aviso, e um aviso
// perdido não perde nada (a leitura de 15 em 15 minutos do cliente continua valendo).
// Formato: Standard Webhooks (standardwebhooks.com) — o mesmo que o Liame verifica.

/** Prefixo do segredo no padrão Standard Webhooks. */
export const PREFIXO_SEGREDO = 'whsec_';
const SEGREDO_MIN_BYTES = 24;
const SEGREDO_MAX_BYTES = 64;
/** Tamanho máximo do endereço (o mesmo do `check` da tabela). */
export const URL_MAX = 500;
/** O trecho depois do endereço permitido (o id da conexão no cliente). */
const TRECHO_MAX = 64;

/** O que a integração enxerga de cada recurso publicado: o nome do evento e o escopo que o libera. */
export const EVENTO_DO_RECURSO = {
  venda: { tipo: 'pedido.alterado', escopo: 'pedidos.ler' },
  cliente: { tipo: 'cliente.anonimizado', escopo: 'clientes.anonimizacao.ler' },
  cupom: { tipo: 'cupom.alterado', escopo: 'cupons.ler' },
  cupom_uso: { tipo: 'cupom.usado', escopo: 'cupons.uso.ler' },
} as const satisfies Record<string, { tipo: string; escopo: EscopoIntegracao }>;

export type RecursoAvisado = keyof typeof EVENTO_DO_RECURSO;

/** Os endereços-base para onde o cliente pode pedir aviso (lista vazia = cliente sem avisos). */
export function basesDoWebhook(cliente: string, env: NodeJS.ProcessEnv = process.env): string[] {
  if (!Object.prototype.hasOwnProperty.call(WEBHOOK_INTEGRACAO, cliente)) return [];
  const cfg = WEBHOOK_INTEGRACAO[cliente];
  const doAmbiente = String(env[cfg.envUrls] ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  return (doAmbiente.length ? doAmbiente : [...cfg.padrao]).filter(baseValida);
}

function baseValida(base: string): boolean {
  try {
    const u = new URL(base);
    // A base termina em "/": o que vem depois é UM trecho. `http` só em teste/dev (a lista é nossa).
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password && !u.search && !u.hash && u.pathname.endsWith('/');
  } catch {
    return false;
  }
}

function trechoValido(t: string): boolean {
  if (!t.length || t.length > TRECHO_MAX) return false;
  for (const c of t) {
    const ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '-' || c === '_';
    if (!ok) return false;
  }
  return true;
}

/**
 * O endereço do aviso, normalizado, se ele estiver DENTRO de uma das bases do cliente — senão
 * `null`. A comparação é feita sobre o endereço já interpretado (`new URL`): `..`, `@`, porta
 * trocada, parâmetro e redirecionamento embutido não passam. Mesma origem, mesmo começo de
 * caminho e um trecho só depois dele (letras, números, `-` e `_`).
 */
export function enderecoPermitido(url: unknown, bases: readonly string[]): string | null {
  if (typeof url !== 'string' || !url.length || url.length > URL_MAX) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.username || u.password || u.search || u.hash) return null;
  for (const base of bases) {
    const b = new URL(base);
    if (u.protocol !== b.protocol || u.host !== b.host) continue;
    if (!u.pathname.startsWith(b.pathname)) continue;
    if (!trechoValido(u.pathname.slice(b.pathname.length))) continue;
    return u.href;
  }
  return null;
}

/** O base64 sem os `=` do fim (o preenchimento é opcional na comparação). */
function semPreenchimento(b64: string): string {
  let fim = b64.length;
  while (fim > 0 && b64[fim - 1] === '=') fim--;
  return b64.slice(0, fim);
}

/** A chave (bytes) do segredo `whsec_<base64>`, ou `null` se o formato não serve. */
export function chaveDoSegredo(segredo: unknown): Buffer | null {
  if (typeof segredo !== 'string' || !segredo.startsWith(PREFIXO_SEGREDO) || segredo.length > 200) return null;
  const b64 = segredo.slice(PREFIXO_SEGREDO.length);
  const chave = Buffer.from(b64, 'base64');
  // `Buffer.from` ignora caractere estranho: só vale o texto que volta igual (sem lixo no meio).
  if (semPreenchimento(chave.toString('base64')) !== semPreenchimento(b64)) return null;
  if (chave.length < SEGREDO_MIN_BYTES || chave.length > SEGREDO_MAX_BYTES) return null;
  return chave;
}

/** A assinatura Standard Webhooks: `v1,` + HMAC-SHA256 (base64) de `id.timestamp.corpo`. */
export function assinarAviso(chave: Buffer, id: string, timestampSeg: number, corpo: string): string {
  return `v1,${createHmac('sha256', chave).update(`${id}.${timestampSeg}.${corpo}`).digest('base64')}`;
}

/** Os cabeçalhos do envio (o corpo assinado é exatamente o texto enviado). */
export function cabecalhosDoAviso(chave: Buffer, id: string, corpo: string, agora: Date = new Date()): Record<string, string> {
  const ts = Math.floor(agora.getTime() / 1000);
  return {
    'content-type': 'application/json',
    'user-agent': 'Regem-Integracao/1',
    'webhook-id': id,
    'webhook-timestamp': String(ts),
    'webhook-signature': assinarAviso(chave, id, ts, corpo),
  };
}

export type Novidade = {
  recurso: RecursoAvisado;
  id: string;
  versao: number | null;
  /** Só no uso de cupom: o cupom e o pedido (o contrato de cupons §4 pede os dois). */
  cupom_id?: string | null;
  pedido_id?: string | null;
};

/**
 * O corpo do aviso, no formato do contrato (`docs/integracoes/regem.md` §3 e cupons §4 do Liame).
 * Um aviso pode valer por várias mudanças: o `id` é o da mais recente. `loja_id` é a loja DO TOKEN
 * (não a do recurso): uma conexão do cliente pode ter várias lojas no mesmo endereço, e é por ele
 * que o cliente sabe qual reler. Token da empresa inteira não manda o campo.
 */
export function corpoDoAviso(n: Novidade, lojaId: string | null = null): Record<string, unknown> {
  const tipo = EVENTO_DO_RECURSO[n.recurso].tipo;
  const loja = lojaId ? { loja_id: lojaId } : {};
  if (n.recurso === 'cliente') return { tipo, id: n.id, ...loja };
  if (n.recurso === 'cupom_uso') return { tipo, id: n.id, cupom_id: n.cupom_id ?? null, pedido_id: n.pedido_id ?? null, ...loja };
  return { tipo, id: n.id, versao: n.versao, ...loja };
}

/** Recuo depois de N falhas seguidas (segundos): 1, 2, 5, 15, 30 min e daí 1 h. */
const RECUO_SEG = [60, 120, 300, 900, 1800, 3600];
export function recuoSeg(falhasSeguidas: number): number {
  const i = Math.min(Math.max(Math.trunc(falhasSeguidas) || 1, 1), RECUO_SEG.length) - 1;
  return RECUO_SEG[i];
}

/** Falhando há este tempo (qualquer motivo), o aviso é pausado até um registro novo. */
export const PAUSA_APOS_FALHA_SEG = 3 * 24 * 3600;
/** O destino dizendo "essa conexão não existe" (404/410) há este tempo: pausa. */
export const PAUSA_APOS_SUMICO_SEG = 3600;

export type Desfecho =
  | { resultado: 'entregue' }
  | { resultado: 'falha'; recuoSeg: number }
  | { resultado: 'pausa'; motivo: string };

/**
 * O que fazer com a resposta do destino. 2xx = entregue. 404/410 = "a conexão não existe mais":
 * pausa, mas só depois de uma hora assim — durante uma troca de versão do destino o proxy dele
 * responde 404 por instantes, e pausar na hora deixaria todas as lojas sem aviso até o registro
 * do dia seguinte. Qualquer outra coisa (rede, tempo esgotado, 3xx, 401, 429, 5xx) é falha com
 * recuo; três dias falhando, pausa.
 */
export function desfechoDoEnvio(p: { status: number | null; falhasSeguidas: number; falhandoHaSeg: number | null }): Desfecho {
  if (p.status !== null && p.status >= 200 && p.status < 300) return { resultado: 'entregue' };
  const ha = p.falhandoHaSeg ?? 0;
  const sumiu = p.status === 404 || p.status === 410;
  if (sumiu && ha >= PAUSA_APOS_SUMICO_SEG) {
    return { resultado: 'pausa', motivo: `o destino respondeu ${p.status} (a conexão não existe mais) por mais de uma hora` };
  }
  if (ha >= PAUSA_APOS_FALHA_SEG) return { resultado: 'pausa', motivo: 'o destino falhou por três dias seguidos' };
  return { resultado: 'falha', recuoSeg: recuoSeg(p.falhasSeguidas + 1) };
}
