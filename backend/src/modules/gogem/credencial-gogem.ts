import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { decifrar } from '../../common/cifra-segredo';
import { ehServidorLocal } from '../../common/modo';
import { chaveDoSegredo } from '../integracao-api/webhook-integracao';
import { DESTINO_GOGEM } from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

const log = new Logger('CredencialGoGeM');

// A CREDENCIAL DO GOGEM (mig 290, ERR-108).
//
// O GoGeM aceita UM token por empresa: o da integração dele, que é o token de um equipamento
// `servidor_local` cadastrado no Regem. Uma empresa tem vários `servidor_local` — servidores de loja,
// sobras de instalação — e "pegar um qualquer" (`limit(1)` sem ordem) mandava o aviso de
// cancelamento com o token errado: no piloto, 5 de 6 davam 401 e o estorno não era pedido.
//
// Qual é o do GoGeM, quem diz é o próprio GoGeM: toda chamada dele à nuvem vem com
// `X-Integrador: gogem` junto do token, e o guard marca aquele equipamento
// (`EquipamentoService.notarIntegrador`). Só a NUVEM lê esta credencial — o servidor da loja nunca
// a tem (credencial de integração é da distribuição) e repassa o aviso para a nuvem.

/**
 * O token da integração GoGeM da empresa: o do equipamento MARCADO e ativo — o da loja pedida,
 * depois o da rede (sem loja), depois qualquer um da empresa; no empate, o visto por último.
 * Sem marcado: `null` — quem chama espera o GoGeM se identificar, não chuta.
 */
export async function tokenDoGogem(db: any, tenantId: string, unidadeId?: string | null): Promise<string | null> {
  const r: any = await db.execute(sql`
    select token from equipamento
     where tenant_id = ${tenantId}::uuid and tipo = 'servidor_local' and ativo
       and integrador = ${DESTINO_GOGEM}
     order by case when unidade_id = ${unidadeId ?? null}::uuid then 0 when unidade_id is null then 1 else 2 end,
              integrador_visto_em desc nulls last, created_at desc
     limit 1`);
  return ((r.rows ?? r)[0]?.token as string | undefined) ?? null;
}

/**
 * O equipamento que REPRESENTA o GoGeM na loja (fase 1 da credencial própria, mig 323): a venda feita
 * com o token de integração novo segue com a mesma origem e a mesma regra de NFC-e da feita com o token
 * antigo. É o marcado pelo `X-Integrador`, da loja do token ou da rede (sem loja) — nunca o de outra
 * loja. Ativo ou não: revogar o token antigo depois da troca não pode mudar a origem das vendas.
 * Sem marcado: `null` (a venda fica sem origem de equipamento, como uma venda sem ponto de salão).
 */
export async function equipamentoDoGogem(db: any, tenantId: string, unidadeId: string): Promise<string | null> {
  const r: any = await db.execute(sql`
    select id from equipamento
     where tenant_id = ${tenantId}::uuid and tipo = 'servidor_local'
       and integrador = ${DESTINO_GOGEM}
       and (unidade_id = ${unidadeId}::uuid or unidade_id is null)
     order by case when unidade_id = ${unidadeId}::uuid then 0 else 1 end, ativo desc,
              integrador_visto_em desc nulls last, created_at desc
     limit 1`);
  return ((r.rows ?? r)[0]?.id as string | undefined) ?? null;
}

/**
 * Onde e com que segredo o aviso ASSINADO sai (fase 2, `docs/integracao-gogem/AVISOS-ASSINADOS.md`). `prefixo`: o do
 * token de integração do GoGeM, para o registro do hub (F3, D-1) — o mesmo prefixo público do registro das chamadas.
 */
export type RegistroDoGogem = { tokenId: string; url: string; chave: Buffer; lojaId: string | null; prefixo: string | null };

/**
 * O registro de aviso que o GoGeM fez com o token de integração da loja (`PUT /integracao/webhook`).
 * Com ele, o cancelamento e o "Publicar" saem assinados para o endereço registrado; sem ele, pelo
 * caminho de antes — é o GoGeM quem liga, loja por loja, e um `DELETE` dele desfaz na hora.
 *
 * SÓ NUVEM (a tabela da 304 não existe no servidor da loja — V1): lá devolve `null` sem consultar.
 * A loja pedida, ou o registro da rede (sem loja); nunca o de outra loja, que pode ser outra conta
 * no GoGeM. Sem loja pedida (aviso antigo, "todas as lojas"): só se a empresa tem UM registro — com
 * dois, não se chuta (ERR-108). Token revogado ou vencido não vale. Nunca rejeita (V3): erro ou
 * segredo que não abre mais vira `null` com o motivo no log — o caminho de antes segue valendo.
 */
export async function registroDoGogem(db: any, tenantId: string, unidadeId: string | null): Promise<RegistroDoGogem | null> {
  if (ehServidorLocal()) return null;
  try {
    const r: any = await db.execute(sql`
      select w.token_id::text as token_id, w.url, w.segredo_cifrado, w.unidade_id::text as unidade_id, t.prefixo
        from integracao_webhook w
        join integracao_token_loja t on t.id = w.token_id
       where w.tenant_id = ${tenantId}::uuid and w.cliente = ${DESTINO_GOGEM}
         and t.revogado_em is null and (t.expira_em is null or t.expira_em > now())
         and (${unidadeId}::uuid is null or w.unidade_id = ${unidadeId}::uuid or w.unidade_id is null)
       order by case when w.unidade_id = ${unidadeId}::uuid then 0 when w.unidade_id is null then 1 else 2 end,
                w.registrado_em desc
       limit 2`);
    const linhas = (r.rows ?? r) as any[];
    if (!linhas.length || (!unidadeId && linhas.length > 1)) return null;
    const l = linhas[0];
    let chave: Buffer | null = null;
    try {
      chave = chaveDoSegredo(decifrar(l.segredo_cifrado));
    } catch {
      chave = null;
    }
    if (!chave) {
      log.warn(`registro de aviso do GoGeM (empresa ${tenantId}) com segredo que não abre — sai pelo caminho de antes`);
      return null;
    }
    return { tokenId: l.token_id, url: l.url, chave, lojaId: l.unidade_id ?? null, prefixo: l.prefixo ?? null };
  } catch (e: any) {
    log.warn(`registro de aviso do GoGeM não lido (empresa ${tenantId}): ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e} — sai pelo caminho de antes`);
    return null;
  }
}

/**
 * Anota no registro o último envio assinado — o `GET /integracao/webhook` do GoGeM mostra quando o
 * Regem mandou e o que ele respondeu. Nunca rejeita: é só a vitrine, o desfecho mora na fila.
 */
export async function notarEnvioAoGogem(db: any, tokenId: string, http: number | null): Promise<void> {
  const entregue = http != null && http >= 200 && http < 300;
  await db
    .execute(sql`
      update integracao_webhook
         set ultimo_envio_em = now(), ultimo_status_http = ${http},
             entregues = entregues + ${entregue ? 1 : 0}
       where token_id = ${tokenId}::uuid`)
    .catch((e: any) => log.warn(`último envio ao GoGeM não anotado: ${e?.message ?? e}`));
}
