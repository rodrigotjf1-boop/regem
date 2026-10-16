import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Destino de produção (setor, produto, opção, complemento e o direcionamento em massa): só KDS ou
// impressora DESTA empresa e EM USO. Antes a opção e o complemento aceitavam qualquer id (PDV,
// servidor da loja, revogado, até de outra empresa) e o setor/produto aceitavam o revogado. O que
// já estava gravado e saiu de uso depois aparece na tela marcado "fora de uso" e tem de ser
// desmarcado para salvar — a impressão já o ignora. Chamar ANTES de apagar os destinos atuais: a
// recusa não pode deixar o produto sem destino nenhum. Devolve a lista sem repetição.
export async function conferirDestinosDeProducao(db: any, tenantId: string, ids: unknown): Promise<string[]> {
  return (await destinosDeProducaoConferidos(db, tenantId, ids)).map((d) => d.id);
}

/** A mesma conferência, devolvendo também o nome de cada destino (para a auditoria), numa consulta só. */
export async function destinosDeProducaoConferidos(db: any, tenantId: string, ids: unknown): Promise<{ id: string; nome: string }[]> {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).filter((x): x is string => typeof x === 'string' && !!x))];
  if (!lista.length) return [];
  if (!lista.every((x) => UUID.test(x))) throw new BadRequestException('Destino inválido.');
  const r: any = await db.execute(sql`
    select id, nome, tipo, ativo from equipamento
     where tenant_id = ${tenantId} and id in (${sql.join(lista.map((id) => sql`${id}::uuid`), sql`, `)})`);
  const rows: { id: string; nome: string; tipo: string; ativo: boolean }[] = r.rows ?? r;
  const porId = new Map(rows.map((x) => [String(x.id), x]));
  if (lista.some((id) => !['kds', 'impressora'].includes(porId.get(id)?.tipo ?? '')))
    throw new BadRequestException('Destino não encontrado. Atualize a tela e tente de novo.');
  // `ativo = false` = revogado (Equipamentos) ou desligado (Impressoras e cupons).
  const foraDeUso = lista.map((id) => porId.get(id)!).filter((x) => !x.ativo).map((x) => `"${x.nome}"`);
  if (foraDeUso.length === 1)
    throw new BadRequestException(`O destino ${foraDeUso[0]} está fora de uso (revogado ou desligado): desmarque-o para salvar.`);
  if (foraDeUso.length > 1)
    throw new BadRequestException(`Os destinos ${foraDeUso.join(', ')} estão fora de uso (revogados ou desligados): desmarque-os para salvar.`);
  return lista.map((id) => ({ id, nome: porId.get(id)!.nome }));
}
