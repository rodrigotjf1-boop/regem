// Rateio proporcional de um valor entre várias linhas.
//
// Usado onde a SOMA DAS PARTES TEM DE FECHAR EXATAMENTE com o valor original:
//  • NFC-e — a SEFAZ valida que `total/ICMSTot/vDesc` é o somatório dos `det/prod/vDesc`
//    e o mesmo para `vFrete`. Um centavo de diferença rejeita a nota.
//  • Margem por produto — o desconto do pedido precisa cair sobre os itens para o
//    lucro por produto parar de mentir.
//
// A conta é feita em CENTAVOS (inteiros). Rateio em float acumula resíduo e a soma
// não fecha — é exatamente o erro que a SEFAZ rejeita.

// Distribui `totalCentavos` entre as linhas, proporcionalmente a `bases`.
// Garantias:
//  • devolve um inteiro por linha, todos >= 0;
//  • `soma(resultado) === Math.round(totalCentavos)` SEMPRE;
//  • erro máximo de 1 centavo por linha (método do maior resto);
//  • determinístico — as mesmas entradas dão sempre a mesma saída.
// Bases zeradas/negativas/inválidas pesam 0; se NENHUMA base for positiva, divide igual.
export function ratearCentavos(bases: number[], totalCentavos: number): number[] {
  const n = bases.length;
  if (n === 0) return [];
  const alvo = Math.max(0, Math.round(Number(totalCentavos) || 0));
  if (alvo === 0) return new Array(n).fill(0);

  const pesos = bases.map((b) => {
    const v = Number(b);
    return Number.isFinite(v) && v > 0 ? v : 0;
  });
  const soma = pesos.reduce((a, b) => a + b, 0);

  // Parte exata (fracionária) de cada linha; o piso soma menos que o alvo e a
  // diferença (sempre < n centavos) vai para quem tem o maior resto.
  const exatos =
    soma > 0 ? pesos.map((p) => (alvo * p) / soma) : new Array(n).fill(alvo / n);
  const partes = exatos.map((e) => Math.floor(e));
  let resto = alvo - partes.reduce((a, b) => a + b, 0);

  const ordem = exatos
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    // Desempate por peso e depois por índice: sem isso, duas linhas iguais poderiam
    // trocar de lugar entre execuções e o XML deixaria de ser reproduzível.
    .sort((a, b) => b.frac - a.frac || pesos[b.i] - pesos[a.i] || a.i - b.i);
  for (let k = 0; resto > 0; k++, resto--) partes[ordem[k % n].i] += 1;
  return partes;
}

// Mesma coisa em REAIS: aceita e devolve valores com 2 casas. `soma(resultado)`
// bate com `arredondar(total, 2)` — a conversão para centavos é o que garante isso.
export function ratearReais(bases: number[], total: number): number[] {
  return ratearCentavos(
    bases.map((b) => Math.round((Number(b) || 0) * 100)),
    Math.round((Number(total) || 0) * 100),
  ).map((c) => c / 100);
}
