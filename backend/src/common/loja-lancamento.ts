import { BadRequestException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Lançar estoque exige saber DE QUAL LOJA (decisão do dono: separação total por loja).
//
// Numa empresa de duas lojas, a sessão só chega sem loja no caso do presidente com
// "todas as lojas" selecionado — e um lançamento feito assim não tem dono: ajustaria o
// saldo de qual das duas? Em vez de adivinhar, recusa e pede para escolher a loja.
//
// Numa empresa de uma loja só, a sessão também chega sem loja (o UnidadeUnicaInterceptor
// zera o filtro), e aí não há ambiguidade: devolve null e o gatilho da mig 253 grava a
// única loja.
export async function exigirLojaParaLancar(
  db: any,
  tenantId: string,
  unidadeId: string | null | undefined,
): Promise<string | null> {
  if (unidadeId) return unidadeId;
  const r: any = await db.execute(
    sql`select count(*)::int as n from unidade where tenant_id = ${tenantId} and deleted_at is null`,
  );
  if (Number((r.rows ?? r)[0]?.n ?? 0) > 1)
    throw new BadRequestException(
      'Escolha a loja para lançar estoque — cada loja tem o próprio estoque.',
    );
  return null;
}
