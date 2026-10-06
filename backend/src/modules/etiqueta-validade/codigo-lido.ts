// O que o LEITOR entrega nem sempre é o texto que foi gravado na etiqueta.
//
// O código nasce com 12 dígitos. Em Code128 e QR o leitor devolve os mesmos 12. No
// modelo "Barras (EAN-13)" a IMPRESSORA acrescenta o dígito verificador: o leitor
// devolve 13 dígitos e a busca, que comparava o texto inteiro, respondia "não
// encontrado" em toda leitura. E EAN-13 que começa com zero muitos leitores entregam
// como UPC-A — 12 dígitos, sem o zero da frente e com o verificador no fim.
//
// Aqui fica a regra única: do que foi lido saem os códigos que podem estar gravados,
// do mais provável para o menos. Quem busca procura por todos e fica com o primeiro.

/** Dígito verificador EAN-13 dos 12 primeiros dígitos (pesos 1,3,1,3…). */
export function verificadorEan13(doze: string): string {
  let soma = 0;
  for (let i = 0; i < 12; i++) soma += Number(doze[i]) * (i % 2 === 0 ? 1 : 3);
  return String((10 - (soma % 10)) % 10);
}

/** Códigos que podem estar gravados para o texto que o leitor (ou o teclado) entregou. */
export function candidatosCodigoLido(bruto: unknown): string[] {
  const lido = String(bruto ?? '').trim();
  if (!lido) return [];
  const candidatos = [lido];
  // EAN-13 inteiro: os 12 primeiros são o código gravado.
  if (/^\d{13}$/.test(lido) && verificadorEan13(lido.slice(0, 12)) === lido[12]) {
    candidatos.push(lido.slice(0, 12));
  }
  // UPC-A: EAN-13 de um código que começa com zero, entregue sem o zero.
  if (/^\d{12}$/.test(lido)) {
    const comZero = `0${lido.slice(0, 11)}`;
    if (verificadorEan13(comZero) === lido[11]) candidatos.push(comZero);
  }
  return candidatos;
}

/** Entre as etiquetas achadas, a do candidato mais provável (o texto exato vence). */
export function escolherPorCodigoLido<T extends { codigo: string | null }>(
  candidatos: string[],
  achadas: T[],
): T | null {
  for (const c of candidatos) {
    const e = achadas.find((a) => a.codigo === c);
    if (e) return e;
  }
  return null;
}
