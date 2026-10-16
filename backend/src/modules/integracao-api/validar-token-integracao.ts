import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { EscopoIntegracao } from './escopos';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { hashTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VALIDAÇÃO do token de integração e o "último uso", fora do `IntegracaoTokenService` (14/10/2026).
//
// O serviço vive no `IntegracaoApiModule`, que é SÓ NUVEM (`edge-manifest.ts`): o servidor da loja nem o
// sobe. As cinco rotas do totem (GoGeM, mig 323) moram em módulos que rodam na loja (venda, delivery,
// produto) e também aceitam o token de integração — o guard delas (`credencial-totem.guard.ts`) usa estas
// funções sem importar o módulo da nuvem. O serviço usa as mesmas: uma regra só.

const log = new Logger('IntegracaoToken');
/** Intervalo mínimo entre duas gravações do "último uso" do mesmo token. */
const USO_INTERVALO_MS = 60_000;
/** Última gravação do uso por token, no processo (compartilhado pelo serviço e pelo guard do totem). */
const usoGravado = new Map<string, number>();

/**
 * O token (já com o formato conferido) vale? Busca pelo hash, com a loja e a empresa: a loja tem de ser
 * DA empresa do token e as duas vivas. `null` = recusa (o motivo vai para o log só quando o token
 * existe — revogado, vencido, loja apagada —, nunca o token).
 */
export async function validarTokenIntegracao(db: any, token: string): Promise<IntegracaoCtxData | null> {
  // Token de LOJA: a loja tem de existir, ser da empresa e estar viva (senão, "loja apagada").
  // Token da EMPRESA (sem loja — só o RegemCast, mig 302): vale a empresa inteira.
  const r: any = await db.execute(sql`
    select t.id, t.tenant_id, t.unidade_id, t.cliente, t.prefixo, t.escopos, t.autorizado_por,
           t.revogado_em is not null as revogado,
           (t.expira_em is not null and t.expira_em <= now()) as vencido,
           (t.unidade_id is not null and (u.id is null or u.deleted_at is not null)) as loja_apagada,
           e.deleted_at is not null as empresa_apagada,
           (select count(*)::int from unidade u2
             where u2.tenant_id = t.tenant_id and u2.deleted_at is null) as lojas
      from integracao_token_loja t
      left join unidade u on u.id = t.unidade_id and u.tenant_id = t.tenant_id
      join empresa e on e.id = t.tenant_id
     where t.token_hash = ${hashTokenIntegracao(token)}
     limit 1`);
  const t = (r.rows ?? r)[0];
  if (!t) return null;
  const motivo = t.revogado
    ? 'revogado'
    : t.vencido
      ? 'vencido'
      : t.loja_apagada
        ? 'loja apagada'
        : t.empresa_apagada
          ? 'empresa apagada'
          : null;
  if (motivo) {
    log.warn(`token ${t.prefixo}… (${t.cliente}) recusado: ${motivo}`);
    return null;
  }
  return {
    tokenId: t.id,
    tenantId: t.tenant_id,
    unidadeId: t.unidade_id ?? null,
    abrangencia: t.unidade_id ? 'loja' : 'empresa',
    lojaUnica: Number(t.lojas) === 1,
    escopos: (t.escopos ?? []) as EscopoIntegracao[],
    cliente: t.cliente,
    autorizadoPor: t.autorizado_por,
    prefixo: t.prefixo,
  };
}

/** Grava o último uso (no máximo 1×/min por token). Nunca rejeita (V3): não derruba a chamada. */
export function marcarUsoTokenIntegracao(db: any, tokenId: string, ip: string | null): void {
  const agora = Date.now();
  if (agora - (usoGravado.get(tokenId) ?? 0) < USO_INTERVALO_MS) return;
  usoGravado.set(tokenId, agora);
  if (usoGravado.size > 50_000) usoGravado.clear();
  db.execute(sql`
      update integracao_token_loja set ultimo_uso_em = now(), ultimo_ip = ${ip ? String(ip).slice(0, 64) : null}
       where id = ${tokenId}`)
    .catch((e: any) => log.warn(`último uso do token ${tokenId.slice(0, 8)} não gravado: ${e?.message ?? e}`));
}
