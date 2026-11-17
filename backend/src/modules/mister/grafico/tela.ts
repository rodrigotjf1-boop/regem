import { deflateSync, inflateSync } from 'node:zlib';
import { BYTES_DA_FONTE, DADOS_DA_FONTE, INDICE_DA_FONTE } from './fonte-do-grafico';

// UMA TELA DE PIXELS E O PNG DELA (M3c parte 3): o gráfico do Mister vira imagem SEM biblioteca de imagem no backend —
// retângulos, linhas, as letras da Figtree (o atlas de `fonte-do-grafico.ts`) e o PNG montado aqui (o `zlib` do Node e
// o CRC do formato). Só desenha o que o código manda: nunca lê imagem de fora (nenhuma entrada de terceiro a decodificar).

export type Tamanho = 'titulo' | 'texto' | 'pequeno';

/** "#E2A340" → [226, 163, 64]. */
export function rgb(cor: string): [number, number, number] {
  const h = /^#?([0-9a-f]{6})$/i.exec(cor)?.[1] ?? '000000';
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

let fonte: Buffer | null = null;
/** A transparência de todas as letras, descomprimida uma vez (na primeira imagem). */
function bytesDaFonte(): Buffer {
  if (!fonte) {
    fonte = inflateSync(Buffer.from(DADOS_DA_FONTE, 'base64'));
    if (fonte.length !== BYTES_DA_FONTE) throw new Error('o atlas de letras do gráfico está corrompido');
  }
  return fonte;
}

export class Tela {
  readonly px: Uint8Array;

  constructor(
    readonly largura: number,
    readonly altura: number,
    fundo = '#FFFFFF',
  ) {
    this.px = new Uint8Array(largura * altura * 3);
    const [r, g, b] = rgb(fundo);
    for (let i = 0; i < this.px.length; i += 3) {
      this.px[i] = r;
      this.px[i + 1] = g;
      this.px[i + 2] = b;
    }
  }

  /** Mistura a cor no pixel com a transparência `a` (0–255). Fora da tela, nada. */
  private ponto(x: number, y: number, c: [number, number, number], a = 255): void {
    if (x < 0 || y < 0 || x >= this.largura || y >= this.altura || a <= 0) return;
    const i = (y * this.largura + x) * 3;
    if (a >= 255) {
      this.px[i] = c[0];
      this.px[i + 1] = c[1];
      this.px[i + 2] = c[2];
      return;
    }
    const k = a / 255;
    this.px[i] = Math.round(this.px[i] * (1 - k) + c[0] * k);
    this.px[i + 1] = Math.round(this.px[i + 1] * (1 - k) + c[1] * k);
    this.px[i + 2] = Math.round(this.px[i + 2] * (1 - k) + c[2] * k);
  }

  retangulo(x: number, y: number, w: number, h: number, cor: string): void {
    const c = rgb(cor);
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.largura, Math.round(x + w));
    const y1 = Math.min(this.altura, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) this.ponto(xx, yy, c);
  }

  /** Uma linha na horizontal; `tracejado` = [traço, vão] em pixels. */
  linhaH(x0: number, x1: number, y: number, cor: string, espessura = 1, tracejado?: [number, number]): void {
    const c = rgb(cor);
    for (let x = Math.round(x0); x < Math.round(x1); x++) {
      if (tracejado && (x - Math.round(x0)) % (tracejado[0] + tracejado[1]) >= tracejado[0]) continue;
      for (let k = 0; k < espessura; k++) this.ponto(x, Math.round(y) + k, c);
    }
  }

  /** A largura do texto no tamanho (o avanço de cada letra; a que não existe no atlas conta como "?"). */
  medir(texto: string, tamanho: Tamanho): number {
    const f = INDICE_DA_FONTE[tamanho];
    let w = 0;
    for (const ch of texto) w += (f.glifos[ch] ?? f.glifos['?'])[0];
    return Math.ceil(w);
  }

  /** A altura de uma linha do tamanho. */
  alturaDaLinha(tamanho: Tamanho): number {
    return INDICE_DA_FONTE[tamanho].altura;
  }

  /** O texto cortado com "…" para caber em `largura`. */
  caber(texto: string, tamanho: Tamanho, largura: number): string {
    if (this.medir(texto, tamanho) <= largura) return texto;
    let t = texto;
    while (t.length > 1 && this.medir(`${t}…`, tamanho) > largura) t = t.slice(0, -1);
    return `${t.trimEnd()}…`;
  }

  /**
   * Escreve o texto com o TOPO da linha em `y`. `alinhar` diz a que ponto `x` se refere (o começo, o meio ou o fim do
   * texto). Devolve a largura escrita.
   */
  texto(texto: string, x: number, y: number, o: { tamanho: Tamanho; cor: string; alinhar?: 'esq' | 'centro' | 'dir' }): number {
    const f = INDICE_DA_FONTE[o.tamanho];
    const bytes = bytesDaFonte();
    const c = rgb(o.cor);
    const w = this.medir(texto, o.tamanho);
    let caneta = o.alinhar === 'centro' ? x - w / 2 : o.alinhar === 'dir' ? x - w : x;
    for (const ch of texto) {
      const [avanco, larg, pos] = f.glifos[ch] ?? f.glifos['?'];
      // O navegador desenhou cada letra 1 pixel à direita (a sobra da borda): volta 1 aqui.
      const x0 = Math.round(caneta) - 1;
      for (let yy = 0; yy < f.altura; yy++)
        for (let xx = 0; xx < larg; xx++) {
          const a = bytes[pos + yy * larg + xx];
          if (a) this.ponto(x0 + xx, Math.round(y) + yy, c, a);
        }
      caneta += avanco;
    }
    return w;
  }

  /** O PNG da tela (cor RGB de 8 bits, sem transparência). */
  png(): Buffer {
    const linha = this.largura * 3;
    const cru = Buffer.alloc((linha + 1) * this.altura);
    for (let y = 0; y < this.altura; y++) {
      cru[y * (linha + 1)] = 0; // filtro "nenhum"
      Buffer.from(this.px.buffer, this.px.byteOffset + y * linha, linha).copy(cru, y * (linha + 1) + 1);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.largura, 0);
    ihdr.writeUInt32BE(this.altura, 4);
    ihdr[8] = 8; // bits por canal
    ihdr[9] = 2; // RGB
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    return Buffer.concat([ASSINATURA_PNG, pedaco('IHDR', ihdr), pedaco('IDAT', deflateSync(cru, { level: 9 })), pedaco('IEND', Buffer.alloc(0))]);
  }
}

export const ASSINATURA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** O CRC-32 do PNG (o mesmo do zlib/gzip). */
export function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = TABELA_CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pedaco(tipo: string, dados: Buffer): Buffer {
  const cab = Buffer.alloc(8);
  cab.writeUInt32BE(dados.length, 0);
  cab.write(tipo, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cab.subarray(4), dados])), 0);
  return Buffer.concat([cab, dados, crc]);
}
