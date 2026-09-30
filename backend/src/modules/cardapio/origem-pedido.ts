import { Logger } from '@nestjs/common';
import { sql, SQL } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ORIGEM DO PEDIDO DO CARDÁPIO (trilha C, C3a — mig 299, só nuvem).
//
// O cliente chega ao cardápio por um link marcado (anúncio, post, link rastreável do Liame). A tela
// guarda os parâmetros SÓ enquanto a aba estiver aberta (`sessionStorage`, decisão do dono) e os
// manda junto com o pedido; aqui eles são limpos e gravados em `pedido_origem`, e a API de
// integração devolve isso no campo `origem` da venda.
//
// Só grava na loja que MEDE ANÚNCIOS: token ativo com `pedidos.ler` que lê as vendas deste
// cardápio (a loja do token; empresa de loja única lê a empresa toda, inclusive o cardápio da
// rede). Loja sem ferramenta conectada não tem quem use o dado (LGPD, necessidade). A tela mostra
// o aviso de privacidade antes do botão e o cliente pode recusar — então nada disso é obrigatório
// e NADA aqui derruba o pedido: campo ruim é descartado, falha vai para o log com o motivo (V3, V11).
// Pedido da MESA nunca passa por aqui (sai sem checkout, sem aviso).
//
// As regras de limpeza são as mesmas da tela (`frontend/src/components/loja/origem-clique-regras.ts`);
// a spec confere as duas com os mesmos casos.

export const CAMPOS_TEXTO_ORIGEM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
/** Ids de campanha/conjunto/anúncio: só dígitos (descarta a macro não expandida, como `{{ad.id}}`). */
export const CAMPOS_ID_ORIGEM = ['campaign_id', 'adset_id', 'adgroup_id', 'ad_id'] as const;
/** Códigos de clique: apagados aos 90 dias pelo job diário. */
export const CAMPOS_CLIQUE_ORIGEM = ['gclid', 'gbraid', 'wbraid', 'fbclid'] as const;
export const CAMPOS_ORIGEM = ['lk', ...CAMPOS_TEXTO_ORIGEM, ...CAMPOS_ID_ORIGEM, ...CAMPOS_CLIQUE_ORIGEM] as const;
export type CampoOrigem = (typeof CAMPOS_ORIGEM)[number];
export type OrigemPedido = { capturado_em: string } & Partial<Record<CampoOrigem, string>>;

/** Tamanho máximo de cada campo (o do contrato do Liame). */
export const MAX_CAMPO_ORIGEM = 1024;
/** Captura mais antiga aceita (dias) e folga para o relógio adiantado do aparelho (minutos). */
const CAPTURA_MAX_DIAS = 30;
const CAPTURA_FOLGA_MIN = 5;
/** Os códigos de clique somem com este tempo (dias) — decisão do dono, 29/09/2026. */
export const EXPURGO_CLIQUE_DIAS = 90;

/** Nome da ferramenta no aviso do cardápio, pelo cliente do token (quem emite é a distribuição). */
const NOME_FERRAMENTA: Record<string, string> = { liame: 'o Liame, da DMS' };

const CONTROLE = /[\u0000-\u001f\u007f]/;
const LK = /^[A-Za-z0-9_-]{4,64}$/;
const SO_DIGITOS = /^[0-9]{1,64}$/;
const CLIQUE = /^[A-Za-z0-9._-]+$/;

const log = new Logger('OrigemPedido');

/** O valor do campo, limpo — ou `null` (descarta só o campo, nunca o pedido). */
export function valorOrigem(campo: CampoOrigem, v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t || t.length > MAX_CAMPO_ORIGEM || CONTROLE.test(t)) return null;
  if (campo === 'lk') return LK.test(t) ? t : null;
  if ((CAMPOS_ID_ORIGEM as readonly string[]).includes(campo)) return SO_DIGITOS.test(t) ? t : null;
  if ((CAMPOS_CLIQUE_ORIGEM as readonly string[]).includes(campo)) return CLIQUE.test(t) ? t : null;
  return t;
}

/** Instante da captura: o do aparelho, se plausível (até 30 dias atrás, 5 min à frente); senão agora. */
function instanteCaptura(v: unknown, agora: Date): string {
  const ms = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Date.parse(v) : NaN;
  const min = agora.getTime() - CAPTURA_MAX_DIAS * 86_400_000;
  const max = agora.getTime() + CAPTURA_FOLGA_MIN * 60_000;
  return new Date(Number.isFinite(ms) && ms >= min && ms <= max ? ms : agora.getTime()).toISOString();
}

/** A origem que veio no corpo do pedido, limpa. `null` = nada aproveitável. */
export function limparOrigem(bruto: unknown, agora: Date = new Date()): OrigemPedido | null {
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return null;
  const b = bruto as Record<string, unknown>;
  const campos: Partial<Record<CampoOrigem, string>> = {};
  for (const campo of CAMPOS_ORIGEM) {
    const v = valorOrigem(campo, b[campo]);
    if (v !== null) campos[campo] = v;
  }
  if (!Object.keys(campos).length) return null;
  return { capturado_em: instanteCaptura(b.capturado_em, agora), ...campos };
}

/**
 * O token que faz esta loja medir anúncios (o mais antigo, se houver mais de um): ativo, com
 * `pedidos.ler`, da loja do cardápio — ou de uma empresa de loja única, cuja leitura pega a
 * empresa toda (inclusive o cardápio da rede, sem loja).
 */
function sqlTokenQueMede(tenantId: string, unidadeId: string | null): SQL {
  return sql`
    select t.cliente
      from integracao_token_loja t
      join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id and u.deleted_at is null
     where t.tenant_id = ${tenantId}::uuid
       and t.revogado_em is null
       and (t.expira_em is null or t.expira_em > now())
       and 'pedidos.ler' = any(t.escopos)
       and (t.unidade_id = ${unidadeId ?? null}::uuid
            or (select count(*) from unidade u2 where u2.tenant_id = t.tenant_id and u2.deleted_at is null) = 1)
     order by t.criado_em, t.id
     limit 1`;
}

/**
 * O cardápio desta loja mede anúncios? `{ ferramenta }` (nome para o aviso; `null` se a
 * ferramenta não tem nome conhecido) ou `null`. Nunca rejeita: é parte da montagem do cardápio.
 */
export async function medicaoDeAnuncios(
  db: DrizzleDB,
  tenantId: string,
  unidadeId: string | null,
): Promise<{ ferramenta: string | null } | null> {
  try {
    const r: any = await db.execute(sqlTokenQueMede(tenantId, unidadeId));
    const [t] = r?.rows ?? r ?? [];
    return t ? { ferramenta: NOME_FERRAMENTA[String(t.cliente)] ?? null } : null;
  } catch (e: any) {
    log.warn(`medição de anúncios da empresa ${tenantId.slice(0, 8)} não conferida: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return null;
  }
}

/** Grava a origem do pedido se a loja mede anúncios (conferido de novo aqui, não pela tela). */
export function sqlGravarOrigem(p: { tenantId: string; unidadeId: string | null; pedidoId: string; origem: OrigemPedido }): SQL {
  const o = p.origem;
  const v = (c: CampoOrigem) => o[c] ?? null;
  return sql`
    insert into pedido_origem (pedido_id, tenant_id, unidade_id, capturado_em, lk,
                               utm_source, utm_medium, utm_campaign, utm_content, utm_term,
                               campaign_id, adset_id, adgroup_id, ad_id, gclid, gbraid, wbraid, fbclid)
    select ${p.pedidoId}::uuid, ${p.tenantId}::uuid, ${p.unidadeId ?? null}::uuid, ${o.capturado_em}::timestamptz, ${v('lk')},
           ${v('utm_source')}, ${v('utm_medium')}, ${v('utm_campaign')}, ${v('utm_content')}, ${v('utm_term')},
           ${v('campaign_id')}, ${v('adset_id')}, ${v('adgroup_id')}, ${v('ad_id')},
           ${v('gclid')}, ${v('gbraid')}, ${v('wbraid')}, ${v('fbclid')}
     where exists (${sqlTokenQueMede(p.tenantId, p.unidadeId)})
    on conflict (pedido_id) do nothing
    returning pedido_id`;
}

/**
 * Grava a origem que veio com o pedido (primeiro envio ou reenvio pelo `clientRef` — a primeira
 * que chegou fica). `true` = gravou agora. Nunca rejeita e nunca derruba o pedido.
 */
export async function gravarOrigemPedido(
  db: DrizzleDB,
  p: { tenantId: string; unidadeId: string | null; pedidoId: string; bruto: unknown },
): Promise<boolean> {
  if (p.bruto === undefined || p.bruto === null) return false;
  const origem = limparOrigem(p.bruto);
  if (!origem) return false;
  try {
    const r: any = await db.execute(sqlGravarOrigem({ ...p, origem }));
    return (r?.rows ?? r ?? []).length > 0;
  } catch (e: any) {
    log.warn(`origem do pedido ${String(p.pedidoId).slice(0, 8)} não gravada: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
    return false;
  }
}
