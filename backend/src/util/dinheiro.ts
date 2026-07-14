// Dinheiro em CENTAVOS (inteiros) — evita o erro de ponto flutuante do float
// (ex.: 0.1 + 0.2 !== 0.3). Toda conta interna do pedido/caixa roda em centavos;
// converte para reais só na FRONTEIRA (resposta da API ou coluna numeric do banco).

/** Reais (number ou string do banco) → centavos inteiros. Arredonda ao centavo. */
export function paraCentavos(reais: number | string | null | undefined): number {
  const n = typeof reais === 'string' ? Number(reais) : reais ?? 0;
  if (!Number.isFinite(n as number)) return 0;
  return Math.round((n as number) * 100);
}

/** Centavos inteiros → reais (number com 2 casas). */
export function paraReais(centavos: number): number {
  return Math.round(centavos) / 100;
}

/** Soma valores JÁ em centavos (arredonda cada parcela por segurança). */
export function somarCentavos(...centavos: number[]): number {
  return centavos.reduce((acc, c) => acc + Math.round(c || 0), 0);
}

/** Percentual sobre um valor em centavos. `percentual` em % (ex.: 10 = 10%). */
export function percentualCentavos(centavos: number, percentual: number): number {
  return Math.round((Math.round(centavos) * percentual) / 100);
}

/** Formata centavos como "R$ 12,34" (pt-BR). Útil em textos/impressão. */
export function formatarReais(centavos: number): string {
  return paraReais(centavos).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
