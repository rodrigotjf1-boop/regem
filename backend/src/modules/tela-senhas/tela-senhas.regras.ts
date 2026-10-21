// Tela de senhas (Cozinha em estações, entrega 4) — as regras puras: as faixas dos ajustes e a montagem das duas
// colunas (Preparando e Pronto). O servidor decide o que aparece e até quando; a TV só desenha e tira da tela na hora
// que ele mandou. A tela repete as faixas dos ajustes em `frontend/src/lib/tela-senhas.ts` — o `check:tela-senhas`
// compara os dois arquivos.
// Sem import de propósito: o check da tela transpila este arquivo sozinho.

/** Minutos da senha em Pronto, na ordem do seletor. 0 = "até o balcão entregar". */
export const TEMPOS_PRONTO_MIN = [2, 5, 10, 15, 20, 30, 0] as const;
export const TEMPO_PRONTO_PADRAO = 10;
export const SOM_PADRAO = true;

/** Tamanho das letras, em %: de 60 a 160, de 10 em 10. */
export const TAMANHO_MIN = 60;
export const TAMANHO_MAX = 160;
export const TAMANHO_PASSO = 10;
export const TAMANHO_PADRAO = 100;
export const CAMPOS_TAMANHO = ['pronto', 'preparando', 'titulos'] as const;
export type CampoTamanho = (typeof CAMPOS_TAMANHO)[number];
export type Tamanhos = Record<CampoTamanho, number>;

/** Quantas senhas cada coluna leva, no máximo (a TV mostra as que cabem e diz quantas ficaram de fora). */
export const LIMITE_POR_COLUNA = 60;

const tamanhoValido = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= TAMANHO_MIN && n <= TAMANHO_MAX && n % TAMANHO_PASSO === 0;

/** Os tamanhos gravados (ou nada), com o padrão no que falta ou não vale. */
export function tamanhosDaTela(v: unknown): Tamanhos {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const t = {} as Tamanhos;
  for (const c of CAMPOS_TAMANHO) t[c] = tamanhoValido(o[c]) ? (o[c] as number) : TAMANHO_PADRAO;
  return t;
}

/** Confere os tamanhos enviados: só os três campos, cada um inteiro, de 10 em 10, de 60 a 160. A mensagem do erro, ou null. */
export function erroDosTamanhos(v: unknown): string | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return 'Tamanhos inválidos.';
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(CAMPOS_TAMANHO as readonly string[]).includes(k)) return `Tamanho desconhecido: ${k}.`;
  for (const c of CAMPOS_TAMANHO) {
    if (!(c in o)) return 'Informe os três tamanhos: Pronto, Preparando e títulos.';
    if (!tamanhoValido(o[c])) return `O tamanho vai de ${TAMANHO_MIN}% a ${TAMANHO_MAX}%, de ${TAMANHO_PASSO} em ${TAMANHO_PASSO}.`;
  }
  return null;
}

export const tempoProntoValido = (v: unknown): v is number =>
  typeof v === 'number' && (TEMPOS_PRONTO_MIN as readonly number[]).includes(v);

/** Um cartão de KDS, como a consulta da TV o lê. */
export interface CartaoDaTela {
  comandaId: string;
  senha: number | null;
  senhaPrefixo: string | null;
  status: string; // recebido | preparo | pronto | entregue | cancelado
  criadoEm: Date | string;
  prontoEm: Date | string | null;
}

/** O que a TV recebe de cada pedido: só o número e a origem (nada do cliente — LGPD). */
export interface SenhaNaTela {
  id: string; // a venda: chave estável para a tela (não é dado do cliente)
  senha: number;
  prefixo: string | null;
}
export interface SenhaPronta extends SenhaNaTela {
  prontoEm: string;
  /** Quando sai da TV; null = "até o balcão entregar". */
  saiEm: string | null;
}

const ms = (d: Date | string | null | undefined) => (d == null ? NaN : new Date(d).getTime());
const ABERTO = new Set(['recebido', 'preparo']);

/**
 * A situação de UM pedido na TV, pelos cartões de KDS dele (o cartão de papel não passa por tela nenhuma e não entra):
 *  · 'preparando' — algum cartão aberto (também o que espera no despacho: a senha só vai para Pronto quando ele chama);
 *  · 'pronto' — nenhum aberto e algum pronto; vale o pronto mais recente;
 *  · null — sai da TV: todos cancelados ou entregues. Um cartão entregue sozinho não tira a senha: numa cozinha em
 *    estações sem despacho, a estação que termina antes pode marcar o dela como entregue — e a senha nunca chegaria
 *    a Pronto quando a última estação terminasse.
 */
export function situacaoDoPedido(cartoes: CartaoDaTela[]): { situacao: 'preparando' | 'pronto'; prontoEm: number } | null {
  const vivos = cartoes.filter((c) => c.status !== 'cancelado');
  if (!vivos.length) return null;
  if (vivos.some((c) => ABERTO.has(c.status))) return { situacao: 'preparando', prontoEm: NaN };
  const prontos = vivos.filter((c) => c.status === 'pronto');
  if (!prontos.length) return null;
  const quando = Math.max(...prontos.map((c) => ms(c.prontoEm)).filter((n) => !Number.isNaN(n)));
  return { situacao: 'pronto', prontoEm: Number.isFinite(quando) ? quando : NaN };
}

/**
 * As duas colunas da TV. Preparando: a ordem de chegada (o mais antigo primeiro). Pronto: o mais recente primeiro, e
 * a senha sai `prontoMin` minutos depois do pronto (0 = só quando o balcão entregar). Pedido sem senha (mesa, comanda)
 * não aparece: a TV mostra só números. Cada coluna vai até `limite`.
 */
export function montarQuadro(
  cartoes: CartaoDaTela[],
  agora: Date,
  prontoMin: number,
  limite = LIMITE_POR_COLUNA,
): { preparando: SenhaNaTela[]; pronto: SenhaPronta[] } {
  const porPedido = new Map<string, CartaoDaTela[]>();
  for (const c of cartoes) {
    if (!c.comandaId) continue;
    const g = porPedido.get(c.comandaId);
    if (g) g.push(c);
    else porPedido.set(c.comandaId, [c]);
  }
  const preparando: (SenhaNaTela & { desde: number })[] = [];
  const pronto: (SenhaPronta & { quando: number })[] = [];
  const t = agora.getTime();
  for (const [id, grupo] of porPedido) {
    const comSenha = grupo.find((c) => c.senha != null && Number.isFinite(Number(c.senha)));
    if (!comSenha) continue;
    const s = situacaoDoPedido(grupo);
    if (!s) continue;
    const base = { id, senha: Number(comSenha.senha), prefixo: (comSenha.senhaPrefixo ?? '').trim() || null };
    if (s.situacao === 'preparando') {
      preparando.push({ ...base, desde: Math.min(...grupo.map((c) => ms(c.criadoEm)).filter((n) => !Number.isNaN(n))) });
      continue;
    }
    // Pronto sem a hora do pronto (cartão antigo): conta da chegada, para não ficar na TV para sempre.
    const quando = Number.isNaN(s.prontoEm) ? Math.max(...grupo.map((c) => ms(c.criadoEm)).filter((n) => !Number.isNaN(n))) : s.prontoEm;
    if (!Number.isFinite(quando)) continue;
    const sai = prontoMin > 0 ? quando + prontoMin * 60_000 : null;
    if (sai != null && sai <= t) continue;
    pronto.push({ ...base, prontoEm: new Date(quando).toISOString(), saiEm: sai == null ? null : new Date(sai).toISOString(), quando });
  }
  preparando.sort((a, b) => a.desde - b.desde || a.senha - b.senha);
  pronto.sort((a, b) => b.quando - a.quando || b.senha - a.senha);
  return {
    preparando: preparando.slice(0, limite).map(({ desde: _d, ...r }) => r),
    pronto: pronto.slice(0, limite).map(({ quando: _q, ...r }) => r),
  };
}
