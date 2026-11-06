import { BadRequestException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { entitlement } from '../db/schema';

// iFOOD PELO ORZUNI (pedido do dono, 04–05/11/2026; R1 da integração).
//
// O Regem guarda o preço NO iFood (produto e opção do catálogo) e se o produto está no cardápio do iFood (mig 369). O
// envio ao iFood, pela porta MCP do Orzuni, é o R2. Tudo nasce DESLIGADO: o servidor só grava os campos com este
// direito ligado na empresa, e a tela só os mostra assim.
//
// Quem liga é a DISTRIBUIÇÃO (nenhuma rota do lojista grava este direito). Ligar só numa empresa cujos servidores de
// loja já estão na versão que traz a mig 369 — o porquê está no cabeçalho da migration.

/** Nome do direito em `entitlement` (por empresa; sem linha = desligado). */
export const MODULO_IFOOD_PELO_ORZUNI = 'ifood_pelo_orzuni';

/** O direito está ligado nesta empresa? */
export async function ifoodPeloOrzuniLigado(db: any, tenantId: string): Promise<boolean> {
  const [e] = await db
    .select({ ativo: entitlement.ativo })
    .from(entitlement)
    .where(and(eq(entitlement.tenantId, tenantId), eq(entitlement.modulo, MODULO_IFOOD_PELO_ORZUNI)));
  return e?.ativo === true;
}

/** O maior preço que a coluna aceita com folga (numeric(12,2)); acima disso é erro de digitação. */
const PRECO_MAXIMO = 999_999.99;

/**
 * O preço no iFood que veio no pedido, pronto para gravar:
 *  • ausente (`undefined`) → `undefined` (quem chama não mexe no que está gravado);
 *  • `null` ou texto vazio → `null` (limpa: o Regem deixa de mexer no preço do iFood);
 *  • número (ou texto com vírgula) de zero para cima, com até 2 casas → o texto com 2 casas.
 * Qualquer outra coisa é recusada com o motivo (nada de gravar zero no lugar de um valor que não se entendeu).
 */
export function precoIfoodDoPedido(valor: unknown): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException('Preço no iFood inválido: informe um valor de zero para cima ou deixe em branco.');
  }
  if (n > PRECO_MAXIMO) {
    throw new BadRequestException('Preço no iFood acima de R$ 999.999,99: confira o valor digitado.');
  }
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new BadRequestException('Preço no iFood com mais de 2 casas decimais: use centavos (ex.: 34,90).');
  }
  return n.toFixed(2);
}
