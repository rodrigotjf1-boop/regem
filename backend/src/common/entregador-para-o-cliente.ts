/* eslint-disable @typescript-eslint/no-explicit-any */
import { sql } from 'drizzle-orm';

// O NOME DO ENTREGADOR QUE O CLIENTE PODE VER (26/11/2026, ERR-623 — a análise do atendente achou o nome indo ao robô sem
// a permissão do entregador): a mesma regra do rastreio (`EntregadorService.rastreioPublico`, que já fazia assim). O entregador
// da LOJA (com `entregador_id`, um colaborador) só aparece se ele marcou "compartilhar contato" no app
// (`entregador_preferencia`, mig 208); o de fora (o da plataforma, sem cadastro na loja — o app dela já mostra ao cliente)
// segue como veio. Sem permissão: null.

/**
 * Quem da lista deixou o nome aparecer ao cliente — UMA consulta para a lista toda. A tabela é só da nuvem (mig 208,
 * `@cloud-only`): no servidor da loja ela não existe e ninguém compartilhou (o nome não vai — o lado seguro).
 */
export async function entregadoresQueCompartilham(db: any, tenantId: string, ids: readonly unknown[]): Promise<Set<string>> {
  const uns = [...new Set(ids.map((x) => String(x ?? '').trim()).filter((x) => /^[0-9a-f-]{36}$/i.test(x)))];
  if (!uns.length || !tenantId) return new Set();
  try {
    const r: any = await db.execute(sql`
      select colaborador_id::text as id from entregador_preferencia
       where tenant_id = ${tenantId}::uuid and compartilha_contato
         and colaborador_id::text = any(string_to_array(${uns.join(',')}, ','))`);
    return new Set((r?.rows ?? r ?? []).map((x: any) => String(x.id)));
  } catch (e: any) {
    if (e?.code === '42P01') return new Set(); // a tabela só da nuvem não existe aqui (servidor da loja)
    throw e;
  }
}

/** O nome que o cliente pode ver: o da plataforma (sem `entregadorId`) como veio; o da loja só se ele compartilha. */
export function nomeDoEntregadorParaOCliente(
  p: { entregadorId?: unknown; entregadorNome?: string | null },
  compartilham: ReadonlySet<string>,
): string | null {
  const nome = p.entregadorNome ? String(p.entregadorNome) : null;
  if (!nome) return null;
  const id = String(p.entregadorId ?? '').trim();
  if (!id) return nome;
  return compartilham.has(id) ? nome : null;
}

/** As linhas com o nome do entregador já filtrado e SEM o `entregadorId` (o id não sai para o cliente nem para o robô). */
export async function comNomeDoEntregadorParaOCliente<T extends { entregadorId?: unknown; entregadorNome?: string | null }>(
  db: any,
  tenantId: string,
  linhas: T[],
): Promise<(Omit<T, 'entregadorId'> & { entregadorNome: string | null })[]> {
  const compartilham = await entregadoresQueCompartilham(
    db,
    tenantId,
    linhas.map((l) => l.entregadorId),
  );
  return linhas.map((l) => {
    const { entregadorId: _id, ...resto } = l;
    return { ...resto, entregadorNome: nomeDoEntregadorParaOCliente(l, compartilham) };
  });
}
