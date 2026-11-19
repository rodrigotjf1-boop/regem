import { sql, type SQL } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from './telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUEM RECEBE MENSAGEM DE MARKETING — a regra do dono de 01/10/2026, a MESMA para as campanhas e as automáticas
// (Onda 3): o cliente da loja recebe até pedir para sair (SAIR no WhatsApp, a chave do Perfil no cardápio ou a marca no
// cadastro). Um lugar só, para as duas não divergirem.

/** Os canais em que o telefone e o cliente são da PLATAFORMA (decisão do dono de 09/09/2026, confirmada pelo contrato do
 * iFood, cl. 3.3.1 e 16.3.2, e pela finalidade da LGPD — plano do perfil do cliente, §3). */
export const CANAIS_DA_PLATAFORMA = ['ifood', '99food'] as const;

/**
 * Cliente DIRETO da loja (alias `c`): tem a base importada da loja, OU já pediu fora do iFood e da 99, OU nunca pediu por
 * eles. Fica de fora só quem pediu SOMENTE pelo iFood/99 — a 99 manda o telefone real e o pedido entra no `cliente` pelo
 * telefone, então sem esta regra a campanha alcançava quem a loja conheceu só pela plataforma (ERR-535, medido em
 * 19/11/2026: 572 clientes). As automáticas já exigiam um pedido na loja (`relacionamento.service` `pediuNaLoja`).
 */
export function sqlClienteDireto(): SQL {
  // A importação vai pelo id (e não `c.importacao`): as automáticas montam `c` como uma lista com só algumas colunas.
  return sql`and (exists (select 1 from cliente ci where ci.id = c.id and ci.importacao is not null)
      or exists (select 1 from pedido_externo pd where pd.tenant_id = c.tenant_id and pd.cliente_id = c.id
                   and coalesce(pd.canal, '') not in ('ifood', '99food'))
      or not exists (select 1 from pedido_externo pp where pp.tenant_id = c.tenant_id and pp.cliente_id = c.id
                   and pp.canal in ('ifood', '99food')))`;
}

/**
 * Fragmento do `where` sobre `cliente c`: cliente direto da loja (acima), com telefone de verdade (o marcador `S/N-…` da
 * mig 073 não é número), sem a marca de saída do cadastro e fora da lista de exclusão. A lista compara pela CHAVE do
 * telefone (sem 55, sem formatação, com o nono dígito): o "SAIR" chega com o 55 e, em muitos celulares, sem o 9 (ERR-134).
 */
export function sqlRecebeMarketing(): SQL {
  return sql`and c.opt_out_marketing = false and coalesce(c.telefone,'') <> ''
      and c.telefone not like 'S/N-%'
      and not exists (select 1 from marketing_optout mo where mo.tenant_id = c.tenant_id
        and ${sqlChaveTelefone(sql`mo.telefone`)} = ${sqlChaveTelefone(sql`c.telefone`)})
      ${sqlClienteDireto()}`;
}

/**
 * A pessoa saiu DEPOIS de a lista ser montada? Confere, no momento do envio, a lista de exclusão pela chave do telefone
 * e a marca do cadastro.
 */
export async function saiuDoMarketing(db: any, tenantId: string, telefone: string, clienteId: string | null): Promise<boolean> {
  const r: any = await db.execute(sql`
    select 1 where exists (
      select 1 from marketing_optout mo where mo.tenant_id = ${tenantId}::uuid
         and ${sqlChaveTelefone(sql`mo.telefone`)} = ${chaveTelefone(telefone)})
    or exists (
      select 1 from cliente c where c.id = ${clienteId}::uuid
         and c.tenant_id = ${tenantId}::uuid and c.opt_out_marketing)`);
  return (r.rows ?? r).length > 0;
}
