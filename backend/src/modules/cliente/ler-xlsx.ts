import { inflateRawSync } from 'node:zlib';

// Leitor MÍNIMO de .xlsx (1ª planilha → linhas de texto), sem dependência externa.
//
// Por quê: a Anota Aí exporta clientes em Excel gerado pelo SheetJS (texto dentro da célula,
// `t="str"`); se o lojista abrir e salvar no Excel, os textos vão para `sharedStrings.xml`
// (`t="s"`). Os dois formatos são lidos. Um .xlsx é um ZIP de XML: lemos o diretório central,
// descompactamos só o que interessa (deflate nativo do Node) e extraímos as células.
// Proteções: teto de tamanho descompactado (arquivo "bomba") e de entradas.

const TETO_DESCOMPACTADO = 60 * 1024 * 1024; // 60 MB por arquivo interno
const TETO_ENTRADAS = 500;

function entradasZip(buf: Buffer): Map<string, { metodo: number; comprimido: number; offsetLocal: number; tamanho: number }> {
  // End of Central Directory: assinatura 0x06054b50, a partir do fim (comentário até 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Arquivo Excel inválido (não é um .xlsx).');
  const total = buf.readUInt16LE(eocd + 10);
  const inicio = buf.readUInt32LE(eocd + 16);
  if (total > TETO_ENTRADAS) throw new Error('Arquivo Excel com estrutura inesperada.');
  const out = new Map<string, { metodo: number; comprimido: number; offsetLocal: number; tamanho: number }>();
  let p = inicio;
  for (let n = 0; n < total; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Arquivo Excel corrompido.');
    const metodo = buf.readUInt16LE(p + 10);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28);
    const lenExtra = buf.readUInt16LE(p + 30);
    const lenComent = buf.readUInt16LE(p + 32);
    const offsetLocal = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    out.set(nome, { metodo, comprimido, offsetLocal, tamanho });
    p += 46 + lenNome + lenExtra + lenComent;
  }
  return out;
}

function lerEntrada(buf: Buffer, e: { metodo: number; comprimido: number; offsetLocal: number; tamanho: number }): string {
  const o = e.offsetLocal;
  if (buf.readUInt32LE(o) !== 0x04034b50) throw new Error('Arquivo Excel corrompido.');
  const ini = o + 30 + buf.readUInt16LE(o + 26) + buf.readUInt16LE(o + 28);
  const dados = buf.subarray(ini, ini + e.comprimido);
  if (e.tamanho > TETO_DESCOMPACTADO) throw new Error('Planilha grande demais.');
  if (e.metodo === 0) return dados.toString('utf8');
  if (e.metodo !== 8) throw new Error('Compressão do Excel não suportada.');
  return inflateRawSync(dados, { maxOutputLength: TETO_DESCOMPACTADO }).toString('utf8');
}

const entidade = (s: string) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

// Texto de um nó <si>/<is> (pode ter vários <t> em trechos formatados).
const textoRico = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => entidade(m[1])).join('');

const colunaIdx = (ref: string) => {
  const letras = (ref.match(/^[A-Z]+/) ?? [''])[0];
  let n = 0;
  for (const ch of letras) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
};

// Linhas da 1ª planilha como texto (células vazias = '').
export function lerXlsx(buf: Buffer): string[][] {
  const ent = entradasZip(buf);
  // 1ª planilha: a que o workbook lista primeiro; na prática sheet1.xml.
  const nomeSheet =
    [...ent.keys()].filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k)).sort()[0] ?? '';
  if (!nomeSheet) throw new Error('O Excel não tem planilha.');
  const compartilhados: string[] = [];
  const ss = ent.get('xl/sharedStrings.xml');
  if (ss) for (const m of lerEntrada(buf, ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) compartilhados.push(textoRico(m[1]));

  const xml = lerEntrada(buf, ent.get(nomeSheet)!);
  const linhas: string[][] = [];
  // `<row r="5"/>` (linha vazia) também existe — não pode "engolir" a linha seguinte.
  for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const linha: string[] = [];
    for (const c of (r[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const corpo = c[2] ?? '';
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) ?? [])[1];
      const tipo = (attrs.match(/\bt="([^"]+)"/) ?? [])[1];
      const v = (corpo.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/) ?? [])[1];
      let texto = '';
      if (tipo === 's') texto = compartilhados[Number(v)] ?? '';
      else if (tipo === 'inlineStr') texto = textoRico(corpo);
      else if (v != null) texto = entidade(v);
      const i = ref ? colunaIdx(ref) : linha.length;
      while (linha.length < i) linha.push('');
      linha[i] = texto;
    }
    linhas.push(linha);
  }
  return linhas;
}
