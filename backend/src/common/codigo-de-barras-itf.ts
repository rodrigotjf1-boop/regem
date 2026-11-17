// O CÓDIGO DE BARRAS DO BOLETO (M3a parte 4b): o "Intercalado 2 de 5" (ITF) dos 44 dígitos, o padrão da FEBRABAN para o
// boleto bancário e para a conta de arrecadação. Cada par de dígitos vira 5 barras (o primeiro dígito) intercaladas com 5
// espaços (o segundo); cada dígito tem 2 elementos largos e 3 estreitos. Começa com estreito-estreito-estreito-estreito
// (barra, espaço, barra, espaço) e termina com largo-estreito-estreito (barra, espaço, barra).
//
// Aqui só as larguras (em módulos: estreito = 1, largo = 3), a partir da barra; quem desenha (o PDF) multiplica pelo
// tamanho do módulo. O teste decodifica as larguras de volta para os dígitos.

/** Estreito (N) e largo (W) de cada dígito, na ordem dos 5 elementos. */
export const PADRAO_ITF: Record<string, string> = {
  '0': 'NNWWN',
  '1': 'WNNNW',
  '2': 'NWNNW',
  '3': 'WWNNN',
  '4': 'NNWNW',
  '5': 'WNWNN',
  '6': 'NWWNN',
  '7': 'NNNWW',
  '8': 'WNNWN',
  '9': 'NWNWN',
};
export const LARGO_ITF = 3;
const largura = (c: string) => (c === 'W' ? LARGO_ITF : 1);

/**
 * As larguras do código (barra, espaço, barra, …), em módulos. Só dígitos, em quantidade par (o boleto tem 44).
 * Fora disso, null (quem desenha não inventa barra).
 */
export function barrasItf(digitos: string): number[] | null {
  if (!/^\d+$/.test(digitos) || digitos.length % 2 !== 0) return null;
  const fora = [1, 1, 1, 1];
  for (let i = 0; i < digitos.length; i += 2) {
    const barras = PADRAO_ITF[digitos[i]];
    const espacos = PADRAO_ITF[digitos[i + 1]];
    for (let k = 0; k < 5; k++) fora.push(largura(barras[k]), largura(espacos[k]));
  }
  fora.push(LARGO_ITF, 1, 1);
  return fora;
}

/** O caminho de volta (para o teste e para conferir antes de desenhar): as larguras → os dígitos, ou null. */
export function lerBarrasItf(larguras: number[]): string | null {
  if (larguras.length < 7) return null;
  const inicio = larguras.slice(0, 4).join(',');
  const fim = larguras.slice(-3).join(',');
  if (inicio !== '1,1,1,1' || fim !== `${LARGO_ITF},1,1`) return null;
  const meio = larguras.slice(4, -3);
  if (meio.length % 10 !== 0) return null;
  const digitoDe = (padrao: string) => Object.keys(PADRAO_ITF).find((d) => PADRAO_ITF[d] === padrao) ?? null;
  let fora = '';
  for (let i = 0; i < meio.length; i += 10) {
    const par = meio.slice(i, i + 10);
    const a = digitoDe(par.filter((_, k) => k % 2 === 0).map((w) => (w === LARGO_ITF ? 'W' : 'N')).join(''));
    const b = digitoDe(par.filter((_, k) => k % 2 === 1).map((w) => (w === LARGO_ITF ? 'W' : 'N')).join(''));
    if (a == null || b == null) return null;
    fora += a + b;
  }
  return fora;
}
