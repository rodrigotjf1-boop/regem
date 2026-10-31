// O TEXTO DO PEDIDO NA VIA IMPRESSA (segurança — ERR-334): a impressora lê MARCAS no começo de cada linha do conteúdo
// (`@GAVETA` abre a gaveta de dinheiro; `@QR:` imprime um QR; `@B`, `@C`, `@D`… mudam o estilo — `edge/escpos.mjs`).
// Texto que vem do pedido (nome e endereço do cliente, observação do item — de qualquer canal: cardápio online, robô,
// iFood, 99) entrava cru: uma quebra de linha seguida de "@GAVETA" virava o comando de abrir a gaveta no meio da
// impressão, e "@QR:…" imprimia o QR de quem fez o pedido. Todo texto de pedido passa por aqui antes de virar linha da
// via: sem caractere de controle (a quebra vira espaço) e sem "@" no começo.

// Os separadores de linha do Unicode montados por código (escritos como escape, viram o caractere ao gravar — ERR-023).
const CONTROLE = new RegExp(`[\\x00-\\x1f\\x7f${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');

export function textoNaVia(v: unknown): string {
  return String(v ?? '')
    .replace(CONTROLE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^@+\s*/, '');
}
