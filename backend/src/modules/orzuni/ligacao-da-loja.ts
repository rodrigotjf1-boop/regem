import type { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { decifrar } from '../../common/cifra-segredo';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ligação viva da loja com o Orzuni, lida NA HORA, com a régua de "acesso vale" (V75): empresa viva, loja viva e da
 * empresa, o direito `ifood_pelo_orzuni` ligado e a ligação não revogada. Devolve o segredo aberto ou o motivo (frase para
 * a tela). Uma régua só para quem chama a porta do Orzuni fora da fila (a pausa da loja, a leitura do cardápio).
 */
export async function ligacaoDaLoja(
  db: any,
  tenantId: string,
  unidadeId: string,
  log?: Pick<Logger, 'error'>,
): Promise<{ segredo: string } | { motivo: string }> {
  const r: any = await db.execute(sql`
    select (select emp.deleted_at is null from empresa emp where emp.id = ${tenantId}::uuid) as empresa_viva,
           exists (select 1 from unidade u where u.id = ${unidadeId}::uuid and u.tenant_id = ${tenantId}::uuid
                     and u.deleted_at is null) as loja_viva,
           exists (select 1 from entitlement e where e.tenant_id = ${tenantId}::uuid
                     and e.modulo = 'ifood_pelo_orzuni' and e.ativo) as liberado,
           (select l.segredo_cifrado from orzuni_ligacao l
             where l.unidade_id = ${unidadeId}::uuid and l.tenant_id = ${tenantId}::uuid and l.revogada_em is null
             limit 1) as segredo`);
  const x = (r.rows ?? r)[0] ?? {};
  if (x.empresa_viva !== true || x.loja_viva !== true) return { motivo: 'A loja foi excluída.' };
  if (x.liberado !== true) return { motivo: 'O iFood pelo Orzuni está desligado nesta empresa.' };
  if (!x.segredo) return { motivo: 'Esta loja não está ligada ao Orzuni — a distribuição registra a chave da loja.' };
  try {
    return { segredo: decifrar(String(x.segredo)) };
  } catch {
    log?.error(`ligação da loja ${unidadeId}: o segredo não abre com a SEGREDOS_CHAVE desta máquina`);
    return { motivo: 'A ligação da loja com o Orzuni não abre — a distribuição registra a chave de novo.' };
  }
}
