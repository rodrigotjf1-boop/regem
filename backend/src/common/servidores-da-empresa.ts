import { sql } from 'drizzle-orm';
import { compararVersao } from '../modules/edge/release-selecao';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type ServidorDaEmpresa = { id: string; nome: string; versao: string | null; vistoEm: unknown; pronto: boolean };

/**
 * Os servidores de loja ATIVOS da empresa (não revogados) com a versão que cada um informou por último, e se ela já é a
 * `versaoMinima` ou mais nova. Serve aos direitos que só podem ser ligados com a loja na versão que traz a migration
 * deles (o iFood pelo Orzuni — mig 369; a 99 — mig 401). Sem versão informada = não está pronto.
 */
export async function servidoresDaEmpresa(db: any, tenantId: string, versaoMinima: string): Promise<ServidorDaEmpresa[]> {
  const r: any = await db.execute(sql`
    select eq.id, eq.nome, es.versao, es.recebido_em
      from equipamento eq
      left join edge_status es on es.equipamento_id = eq.id
     where eq.tenant_id = ${tenantId} and eq.tipo = 'servidor_local' and eq.ativo and eq.revogado_em is null
     order by eq.nome`);
  return ((r.rows ?? r) as any[]).map((s) => ({
    id: String(s.id),
    nome: String(s.nome),
    versao: s.versao ? String(s.versao) : null,
    vistoEm: s.recebido_em ?? null,
    pronto: !!s.versao && compararVersao(String(s.versao), versaoMinima) >= 0,
  }));
}
