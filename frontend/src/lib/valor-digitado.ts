// O VALOR EM REAIS QUE A PESSOA DIGITA (pt-BR). Antes, as telas do caixa liam com `Number(texto.replace(',', '.')) || 0`:
// "1.200,00" virava NaN e então R$ 0,00 (o troco da abertura sumia, o contado no fechamento contava zero) e "1.200" virava
// R$ 1,20 (C-05 da revisão de 24/11/2026). Aqui o texto vazio volta `null` e o que não é valor volta `NaN`: quem chama
// decide (recusa com aviso) — nunca vira zero calado.
//
// Aceita: "1.200,50", "1200,5", "1200.50", "1.200" (ponto de milhar), "12.500.000", "R$ 30", "0".
// Recusa (NaN): "1,200,50", "12a", "1.20.0", ".", ",".

/** O valor em reais com 2 casas; `null` = campo vazio; `NaN` = texto que não é um valor. */
export function lerValorDigitado(texto: string | number | null | undefined): number | null {
  if (typeof texto === 'number') return Number.isFinite(texto) ? Math.round(texto * 100) / 100 : NaN;
  const s = String(texto ?? '')
    .replace(/R\$/gi, '')
    .replace(/\s+/g, '');
  if (!s) return null;
  let normal: string;
  if (s.includes(',')) normal = s.replace(/\./g, '').replace(',', '.'); // vírgula = decimal; ponto = milhar
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, ''); // "1.200": ponto de milhar
  else normal = s; // "12.50" (a tela que preenche com toFixed) ou "1200"
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return NaN;
  return Math.round(Number(normal) * 100) / 100;
}

/** O valor digitado é um valor válido e não negativo (vazio não conta como válido). */
export const valorDigitadoValido = (v: number | null): v is number => v !== null && Number.isFinite(v) && v >= 0;
