import { sql, type SQL } from 'drizzle-orm';
import { chaveTelefone, sqlChaveTelefone } from './telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// QUEM RECEBE MENSAGEM DE MARKETING — a regra do dono de 01/10/2026, a MESMA para as campanhas e as automáticas
// (Onda 3): o cliente da loja recebe até pedir para sair (SAIR no WhatsApp, a chave do Perfil no cardápio ou a marca no
// cadastro). Um lugar só, para as duas não divergirem.

/**
 * Fragmento do `where` sobre `cliente c`: com telefone de verdade (o marcador `S/N-…` da mig 073 não é número), sem a
 * marca de saída do cadastro e fora da lista de exclusão. A lista compara pela CHAVE do telefone (sem 55, sem formatação,
 * com o nono dígito): o "SAIR" chega com o 55 e, em muitos celulares, sem o 9 (ERR-134).
 */
export function sqlRecebeMarketing(): SQL {
  return sql`and c.opt_out_marketing = false and coalesce(c.telefone,'') <> ''
      and c.telefone not like 'S/N-%'
      and not exists (select 1 from marketing_optout mo where mo.tenant_id = c.tenant_id
        and ${sqlChaveTelefone(sql`mo.telefone`)} = ${sqlChaveTelefone(sql`c.telefone`)})`;
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
