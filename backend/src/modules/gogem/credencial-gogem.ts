import { sql } from 'drizzle-orm';
import { DESTINO_GOGEM } from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

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
