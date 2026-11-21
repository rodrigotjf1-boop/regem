import { BadRequestException, HttpStatus } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/error-codes';

// CÓDIGO PDV NA LISTA (Cadastros › Cardápio, "Mostrar código PDV"): a leitura do pedido da tela e a recusa por linha, sem
// banco. O código liga o pedido do iFood, da 99 e do totem ao item (V57): por isso cada troca leva o código que a tela
// leu (`de`) e nada se grava pela metade.

export const MAX_TROCAS_DE_CODIGO = 500;
export const MAX_CODIGO_PDV = 60;

export type TipoDoCodigo = 'produto' | 'opcao';
export interface TrocaDeCodigo {
  tipo: TipoDoCodigo;
  id: string;
  de: string | null;
  para: string | null;
}
export interface RecusaDeCodigo {
  tipo: TipoDoCodigo;
  id: string;
  motivo: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vazio e só espaços valem "sem código"; o que não é texto é recusado por quem chama. */
export const codigoLimpo = (v: unknown): string | null => (typeof v === 'string' ? v.trim() || null : null);

function textoOuNulo(v: unknown): boolean {
  return v === null || v === undefined || typeof v === 'string';
}

/**
 * O corpo `{ trocas: [{ tipo, id, de, para }] }`. Formato errado = 400 no pedido inteiro; o que é problema de UMA linha
 * (código longo, o mesmo código em dois produtos do pedido) volta em `recusas`, para a tela marcar a linha.
 * A linha em que `de` e `para` são iguais não é mudança e sai da lista.
 */
export function lerTrocasDeCodigo(corpo: unknown): { trocas: TrocaDeCodigo[]; recusas: RecusaDeCodigo[] } {
  const lista = (corpo as { trocas?: unknown } | null | undefined)?.trocas;
  if (!Array.isArray(lista)) throw new BadRequestException('Informe os códigos a trocar.');
  if (lista.length > MAX_TROCAS_DE_CODIGO) throw new BadRequestException(`Salve até ${MAX_TROCAS_DE_CODIGO} códigos de cada vez.`);

  const vistos = new Set<string>();
  const trocas: TrocaDeCodigo[] = [];
  const recusas: RecusaDeCodigo[] = [];
  for (const bruto of lista) {
    const l = (bruto ?? {}) as Record<string, unknown>;
    if ((l.tipo !== 'produto' && l.tipo !== 'opcao') || typeof l.id !== 'string' || !UUID.test(l.id) || !textoOuNulo(l.de) || !textoOuNulo(l.para))
      throw new BadRequestException('Código PDV inválido.');
    const chave = `${l.tipo}:${l.id.toLowerCase()}`;
    if (vistos.has(chave)) throw new BadRequestException('O mesmo item veio duas vezes.');
    vistos.add(chave);
    const de = codigoLimpo(l.de);
    const para = codigoLimpo(l.para);
    if (de === para) continue;
    if (para && para.length > MAX_CODIGO_PDV) {
      recusas.push({ tipo: l.tipo, id: l.id, motivo: `o código PDV vai até ${MAX_CODIGO_PDV} caracteres` });
      continue;
    }
    trocas.push({ tipo: l.tipo, id: l.id, de, para });
  }

  // Dois PRODUTOS do mesmo pedido com o mesmo código: o índice único recusaria um deles. Opção pode repetir entre produtos.
  const porCodigo = new Map<string, TrocaDeCodigo[]>();
  for (const t of trocas) {
    if (t.tipo === 'produto' && t.para) porCodigo.set(t.para, [...(porCodigo.get(t.para) ?? []), t]);
  }
  for (const [codigo, iguais] of porCodigo) {
    if (iguais.length > 1) for (const t of iguais) recusas.push({ tipo: t.tipo, id: t.id, motivo: `o código ${codigo} foi digitado em mais de um produto` });
  }
  return { trocas, recusas };
}

/** A recusa que a tela lê linha a linha (`details.recusas`); nada foi gravado. */
export function codigosRecusados(recusas: RecusaDeCodigo[]): AppError {
  const n = recusas.length;
  return new AppError({
    code: ErrorCodes.DATABASE_CONFLICT,
    statusCode: HttpStatus.CONFLICT,
    message: n === 1 ? `Nada foi salvo: ${recusas[0].motivo}.` : `Nada foi salvo: ${n} códigos precisam de ajuste.`,
    details: { recusas },
    isOperational: true,
  });
}
