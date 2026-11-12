import { createHash } from 'node:crypto';
import { montarChaveIdempotencia } from '../../dms/integracao-dms';

// "MANDAR ESTA FOTO AO iFOOD" (R3 F6b; protótipo `mockups/regem-conciliacao-ifood.html`, decisão 16). A porta do Orzuni
// (contrato 1.3.0, `item_foto_definir`, permissão `catalogo.escrever`) recebe a foto em data-URI JPEG ou PNG, de até 8 MB
// (acima disso recusa com `imagem_grande` antes de chamar o iFood); a medida mínima quem confere é o iFood, e o Orzuni
// pediu que o Regem confira ANTES de mandar: quadrada (1:1) e com 300 px de lado ou mais. A medida sai dos próprios bytes
// do arquivo (o cabeçalho do PNG e o marcador SOF do JPEG) — nunca do tipo que o servidor da foto diz.

/** O maior arquivo que vai ao iFood (bytes da imagem, antes do base64): o "até 8 MB" da porta, contado por baixo. */
export const LIMITE_FOTO_IFOOD = 8_000_000;
/** O menor lado que o Regem manda (o recomendado pelo Orzuni/iFood). */
export const LADO_MINIMO_IFOOD = 300;
/** Quadrada = a diferença entre os lados até 2% do maior (uma foto cortada a 800 × 805 serve). */
export const FOLGA_QUADRADA = 0.02;
/** A permissão da ferramenta da foto, pedida num cliente próprio (só ela). */
export const PERMISSOES_DA_FOTO: readonly string[] = ['catalogo.escrever'];

export type MedidaDaImagem = { tipo: 'jpeg' | 'png'; largura: number; altura: number };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Os marcadores SOF do JPEG (início do quadro, com a medida): C0–CF, menos C4 (tabela), C8 (reservado) e CC (aritmética).
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/** O tipo e a medida da imagem, lidos dos bytes; `null` quando não é JPEG nem PNG (ou o arquivo está cortado). */
export function medidaDaImagem(b: Buffer): MedidaDaImagem | null {
  if (b.length >= 24 && b.subarray(0, 8).equals(PNG) && b.toString('latin1', 12, 16) === 'IHDR') {
    const largura = b.readUInt32BE(16);
    const altura = b.readUInt32BE(20);
    return largura > 0 && altura > 0 ? { tipo: 'png', largura, altura } : null;
  }
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let m = b[i + 1];
    // Bytes de preenchimento (FF FF …) antes do marcador.
    while (m === 0xff && i + 2 < b.length) {
      i++;
      m = b[i + 1];
    }
    // Marcadores sem tamanho: RST0–RST7, TEM e um SOI repetido.
    if ((m >= 0xd0 && m <= 0xd7) || m === 0x01 || m === 0xd8) {
      i += 2;
      continue;
    }
    if (m === 0xd9 || m === 0xda) return null; // fim da imagem ou começo dos dados sem ter achado a medida
    const tam = b.readUInt16BE(i + 2);
    if (tam < 2) return null;
    if (SOF.has(m)) {
      if (i + 9 > b.length) return null;
      const altura = b.readUInt16BE(i + 5);
      const largura = b.readUInt16BE(i + 7);
      return largura > 0 && altura > 0 ? { tipo: 'jpeg', largura, altura } : null;
    }
    i += 2 + tam;
  }
  return null;
}

export function ehQuadrada(largura: number, altura: number): boolean {
  return Math.abs(largura - altura) <= FOLGA_QUADRADA * Math.max(largura, altura);
}

/** O que impede a foto de ir ao iFood (a frase da tela), ou `null` quando ela serve. */
export function problemaDaFoto(m: MedidaDaImagem | null, bytes: number): string | null {
  if (bytes > LIMITE_FOTO_IFOOD) return `A foto tem ${(bytes / 1_000_000).toFixed(1).replace('.', ',')} MB e o iFood aceita até 8 MB: use uma menor.`;
  if (!m) return 'A foto do Regem não é JPG nem PNG: o iFood só aceita esses dois. Troque a foto do produto.';
  if (!ehQuadrada(m.largura, m.altura))
    return `A foto tem ${m.largura} × ${m.altura} px e o iFood pede foto quadrada: corte-a (ex.: 800 × 800) e troque a do produto.`;
  if (Math.min(m.largura, m.altura) < LADO_MINIMO_IFOOD)
    return `A foto tem ${m.largura} × ${m.altura} px e o iFood pede ${LADO_MINIMO_IFOOD} px de lado ou mais: use uma maior.`;
  return null;
}

/** O data-URI que a porta pede (`data:image/jpeg;base64,…` ou png). */
export function dataUriDaFoto(m: MedidaDaImagem, b: Buffer): string {
  return `data:image/${m.tipo};base64,${b.toString('base64')}`;
}

/**
 * A chave de idempotência do envio: o produto e o CONTEÚDO da foto. Mandar a mesma foto de novo (o clique repetido, a
 * resposta que não chegou) leva a mesma chave — a porta não grava duas vezes; uma foto nova é outra chave.
 */
export function chaveDaFoto(produtoId: string, b: Buffer): string {
  return montarChaveIdempotencia('regem-foto-ifood', produtoId, createHash('sha256').update(b).digest('hex'));
}

/** O maior data-URI aceito no pedido: 8 MB de imagem em base64 (~1,37×) e o cabeçalho. */
const LIMITE_DATA_URI = Math.ceil((LIMITE_FOTO_IFOOD * 4) / 3) + 64;
const DATA_URI = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/;

/**
 * A foto ENQUADRADA que a tela manda (R3 F6c): quando a foto do Regem não serve ao iFood como está (retangular, WEBP…),
 * o navegador corta o quadrado do centro e manda a cópia em data-URI — só para o iFood (a foto do Regem não muda).
 * Ausente → `undefined` (vale a foto do produto, baixada como está). Os bytes ainda passam por `problemaDaFoto`.
 */
export function fotoDoPedido(v: unknown): Buffer | undefined | { erro: string } {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || v.length > LIMITE_DATA_URI) return { erro: 'A foto enquadrada passa de 8 MB: o iFood não aceita.' };
  const m = DATA_URI.exec(v);
  if (!m) return { erro: 'A foto enquadrada não veio como JPG ou PNG.' };
  return Buffer.from(m[2], 'base64');
}
