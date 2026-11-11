import { BadRequestException } from '@nestjs/common';

// O PREÇO NUM APP (iFood, 99) que veio no pedido — a mesma regra para os dois (mig 369 e 401). O rótulo entra no motivo
// da recusa ("Preço no iFood", "Preço na 99").

/** O maior preço que a coluna aceita com folga (numeric(12,2)); acima disso é erro de digitação. */
const PRECO_MAXIMO = 999_999.99;

/**
 * O preço no app, pronto para gravar:
 *  • ausente (`undefined`) → `undefined` (quem chama não mexe no que está gravado);
 *  • `null` ou texto vazio → `null` (limpa: o Regem deixa de mexer no preço de lá);
 *  • número (ou texto com vírgula) de zero para cima, com até 2 casas → o texto com 2 casas.
 * Qualquer outra coisa é recusada com o motivo (nada de gravar zero no lugar de um valor que não se entendeu).
 */
export function precoDoAppDoPedido(valor: unknown, rotulo: string): string | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  const n = typeof valor === 'number' ? valor : typeof valor === 'string' ? Number(valor.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0) {
    throw new BadRequestException(`${rotulo} inválido: informe um valor de zero para cima ou deixe em branco.`);
  }
  if (n > PRECO_MAXIMO) {
    throw new BadRequestException(`${rotulo} acima de R$ 999.999,99: confira o valor digitado.`);
  }
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new BadRequestException(`${rotulo} com mais de 2 casas decimais: use centavos (ex.: 34,90).`);
  }
  return n.toFixed(2);
}
