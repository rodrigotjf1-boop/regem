import { BadRequestException } from '@nestjs/common';

// Motivos de desperdício — LISTA FECHADA (decisão do dono em 07/10/2026, pela mesma razão das
// unidades de medida: em texto livre, "forno", "queimou" e "preparo" viram três motivos e o
// relatório por motivo não soma nada). A tela busca a lista em `GET /desperdicios/motivos`.
export const MOTIVOS_DESPERDICIO = ['Validade', 'Preparo', 'Queda', 'Transporte', 'Outro'] as const;
export type MotivoDesperdicio = (typeof MOTIVOS_DESPERDICIO)[number];

// Outras formas de dizer o mesmo: o que o próprio sistema já gravava ("validade", da perda por
// etiqueta) e os jeitos comuns de escrever.
const APELIDOS: Record<string, MotivoDesperdicio> = {
  vencido: 'Validade', vencida: 'Validade', vencimento: 'Validade', 'validade vencida': 'Validade',
  'erro de preparo': 'Preparo', queimou: 'Preparo', queimado: 'Preparo',
  quebra: 'Queda', quebrou: 'Queda', caiu: 'Queda', derramou: 'Queda',
  entrega: 'Transporte',
  outros: 'Outro',
};

const chave = (texto: string) =>
  texto.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

const POR_CHAVE = new Map<string, MotivoDesperdicio>([
  ...MOTIVOS_DESPERDICIO.map((m) => [chave(m), m] as [string, MotivoDesperdicio]),
  ...Object.entries(APELIDOS),
]);

/** O motivo da lista que corresponde ao texto; `null` se não há. */
export function normalizarMotivo(texto: unknown): MotivoDesperdicio | null {
  if (typeof texto !== 'string') return null;
  return POR_CHAVE.get(chave(texto)) ?? null;
}

/** Idem, recusando (400) o que não é da lista. */
export function exigirMotivo(texto: unknown): MotivoDesperdicio {
  const m = normalizarMotivo(texto);
  if (!m)
    throw new BadRequestException(
      `Motivo do desperdício desconhecido. Escolha um da lista: ${MOTIVOS_DESPERDICIO.join(', ')}.`,
    );
  return m;
}
