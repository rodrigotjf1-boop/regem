/* eslint-disable @typescript-eslint/no-explicit-any */

// O que é DINHEIRO na resposta de uma ficha técnica: o custo e tudo o que se calcula dele
// (com o preço de venda à vista, o CMV, o markup e a margem devolvem o custo na conta).
const CAMPOS_DE_CUSTO = [
  'custoTotal',
  'custoPorcao',
  'cmv',
  'precoSugerido',
  'markup',
  'margem',
  'custoTotalDelivery',
  'custoPorcaoDelivery',
  'cmvDelivery',
  'margemDelivery',
] as const;

/**
 * A mesma ficha, sem o custo — para quem não tem a permissão "Fichas técnicas".
 * O que identifica e monta a receita continua (nome, rendimento, porção, ingredientes e
 * quantidades): produtos e ordens de produção escolhem a ficha por essa lista.
 * `custoOculto` diz à tela que o custo não veio — ela não pode mostrar "R$ 0,00" nem "sem preço".
 */
export function fichaSemCusto<T extends Record<string, any>>(ficha: T) {
  const fora: Record<string, any> = { ...ficha, custoOculto: true };
  for (const campo of CAMPOS_DE_CUSTO) fora[campo] = null;
  if (Array.isArray(ficha.ingredientes))
    fora.ingredientes = ficha.ingredientes.map((i: any) => ({ ...i, custoUnitario: null }));
  return fora;
}
