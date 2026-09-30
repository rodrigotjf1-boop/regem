// Regras da ORIGEM do pedido do cardápio (trilha C, C3a — mig 299): quais parâmetros do link
// valem e como se limpam. São as MESMAS do servidor (`backend/src/modules/cardapio/origem-pedido.ts`,
// que confere tudo de novo). Arquivo sem DOM nem React: a spec do backend testa os dois lados com
// os mesmos casos.

export const PARAMS_ORIGEM = [
  'lk',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'campaign_id',
  'adset_id',
  'adgroup_id',
  'ad_id',
  'gclid',
  'gbraid',
  'wbraid',
  'fbclid',
] as const;
export type ParamOrigem = (typeof PARAMS_ORIGEM)[number];
export type OrigemClique = { capturado_em: string } & Partial<Record<ParamOrigem, string>>;

const IDS = ['campaign_id', 'adset_id', 'adgroup_id', 'ad_id'];
const CLIQUES = ['gclid', 'gbraid', 'wbraid', 'fbclid'];
const MAX = 1024;
const CONTROLE = /[\u0000-\u001f\u007f]/;
const LK = /^[A-Za-z0-9_-]{4,64}$/;
const SO_DIGITOS = /^[0-9]{1,64}$/;
const CLIQUE = /^[A-Za-z0-9._-]+$/;

/** O valor do parâmetro, limpo — ou `null` (a macro não expandida, como `{{ad.id}}`, fica de fora). */
export function valorOrigemClique(campo: ParamOrigem, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > MAX || CONTROLE.test(t)) return null;
  if (campo === 'lk') return LK.test(t) ? t : null;
  if (IDS.includes(campo)) return SO_DIGITOS.test(t) ? t : null;
  if (CLIQUES.includes(campo)) return CLIQUE.test(t) ? t : null;
  return t;
}

/** A origem que está no link, ou `null` se ele não traz nenhum parâmetro aproveitável. */
export function origemDaUrl(
  params: { get(nome: string): string | null } | null | undefined,
  agora: Date = new Date(),
): OrigemClique | null {
  if (!params) return null;
  const campos: Partial<Record<ParamOrigem, string>> = {};
  for (const p of PARAMS_ORIGEM) {
    const v = valorOrigemClique(p, params.get(p));
    if (v !== null) campos[p] = v;
  }
  return Object.keys(campos).length ? { capturado_em: agora.toISOString(), ...campos } : null;
}

/** Vale o último link: link marcado substitui a origem guardada; link sem marca mantém a que havia. */
export function proximaOrigem(guardada: OrigemClique | null, daUrl: OrigemClique | null): OrigemClique | null {
  return daUrl ?? guardada;
}
