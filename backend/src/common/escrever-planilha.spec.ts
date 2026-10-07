import { inflateRawSync } from 'node:zlib';
import { lerXlsx } from '../modules/cliente/ler-xlsx';
import { escreverCsv, escreverXlsx } from './escrever-planilha';

// Escritor de planilha (Excel e CSV). O .xlsx é conferido de três jeitos: o leitor do próprio
// projeto lê de volta o que foi escrito; o ZIP é aberto à mão (assinaturas, tamanhos e CRC de
// cada parte, como um descompactador faria); e as partes obrigatórias do formato estão lá.

const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const byte of b) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
};

/** Abre o ZIP como um descompactador: confere cada cabeçalho e devolve as partes em texto. */
function abrirZip(buf: Buffer): Record<string, string> {
  const fim = buf.length - 22;
  expect(buf.readUInt32LE(fim)).toBe(0x06054b50);
  const total = buf.readUInt16LE(fim + 10);
  let p = buf.readUInt32LE(fim + 16);
  expect(p + buf.readUInt32LE(fim + 12)).toBe(fim); // o diretório termina onde começa o fim
  const partes: Record<string, string> = {};
  for (let n = 0; n < total; n++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const crc = buf.readUInt32LE(p + 16);
    const comprimido = buf.readUInt32LE(p + 20);
    const tamanho = buf.readUInt32LE(p + 24);
    const lenNome = buf.readUInt16LE(p + 28);
    const local = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + lenNome);
    // o cabeçalho local repete nome, CRC e tamanhos
    expect(buf.readUInt32LE(local)).toBe(0x04034b50);
    expect(buf.readUInt32LE(local + 14)).toBe(crc);
    expect(buf.readUInt32LE(local + 18)).toBe(comprimido);
    expect(buf.readUInt32LE(local + 22)).toBe(tamanho);
    expect(buf.toString('utf8', local + 30, local + 30 + lenNome)).toBe(nome);
    const dados = inflateRawSync(buf.subarray(local + 30 + lenNome, local + 30 + lenNome + comprimido));
    expect(dados.length).toBe(tamanho);
    expect(crc32(dados)).toBe(crc);
    partes[nome] = dados.toString('utf8');
    p += 46 + lenNome;
  }
  expect(p).toBe(fim);
  return partes;
}

describe('escrever planilha', () => {
  const LINHAS = [
    ['Produto', 'Unidade', 'Estoque mínimo', 'Custo médio'],
    ['Açúcar refinado 1 kg', 'pacote', 12, 4.89],
    ['Molho "da casa" <picante> & doce', 'pote', 0.5, null],
    ['', 'kg', 3, 23.060345],
    ['=SOMA(A1:A9)', 'unidade', 0, 0],
  ];

  it('o que escreve, o leitor do projeto lê igual (texto, número, vazio e caracteres do XML)', () => {
    const lido = lerXlsx(escreverXlsx(LINHAS, { planilha: 'Produtos', larguras: [38, 12, 16, 14] }));
    expect(lido).toEqual([
      ['Produto', 'Unidade', 'Estoque mínimo', 'Custo médio'],
      ['Açúcar refinado 1 kg', 'pacote', '12', '4.89'],
      ['Molho "da casa" <picante> & doce', 'pote', '0.5'],
      ['', 'kg', '3', '23.060345'],
      ['=SOMA(A1:A9)', 'unidade', '0', '0'],
    ]);
  });

  it('o ZIP é válido (tamanho e CRC de cada parte) e tem as partes que o formato exige', () => {
    const partes = abrirZip(escreverXlsx(LINHAS));
    expect(Object.keys(partes).sort()).toEqual(
      ['[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml'].sort(),
    );
    // número vai como número (o Excel soma) e texto vai dentro da célula, com o XML escapado
    const folha = partes['xl/worksheets/sheet1.xml'];
    expect(folha).toContain('<c r="C2"><v>12</v></c>');
    expect(folha).toContain('<c r="A3" t="inlineStr"><is><t xml:space="preserve">Molho &quot;da casa&quot; &lt;picante&gt; &amp; doce</t></is></c>');
    expect(folha).toContain('<c r="A1" s="1" t="inlineStr">'); // cabeçalho em negrito
    expect(folha).not.toContain('r="A4"'); // célula vazia não é escrita
    // toda parte citada no [Content_Types] e nos relacionamentos existe
    for (const alvo of ['/xl/workbook.xml', '/xl/worksheets/sheet1.xml', '/xl/styles.xml'])
      expect(partes['[Content_Types].xml']).toContain(`PartName="${alvo}"`);
    expect(partes['_rels/.rels']).toContain('Target="xl/workbook.xml"');
    expect(partes['xl/_rels/workbook.xml.rels']).toContain('Target="worksheets/sheet1.xml"');
    expect(partes['xl/_rels/workbook.xml.rels']).toContain('Target="styles.xml"');
    // o estilo 1 (negrito) que o cabeçalho usa existe
    expect(partes['xl/styles.xml']).toContain('<cellXfs count="2">');
  });

  it('caractere de controle some (um só invalida o arquivo no Excel) e o nome da planilha é saneado', () => {
    const buf = escreverXlsx([['Produto'], ['Pão\u0000 de\u0008 queijo\u001F']], {
      planilha: 'Produtos/2026: [teste] *?' + 'x'.repeat(40),
    });
    expect(lerXlsx(buf)).toEqual([['Produto'], ['Pão de queijo']]);
    const nome = /<sheet name="([^"]*)"/.exec(abrirZip(buf)['xl/workbook.xml'])?.[1] ?? '';
    expect(nome).toHaveLength(31);
    expect(nome).not.toMatch(/[[\]:*?/\\]/);
  });

  it('coluna depois da Z vira AA, AB…', () => {
    const linha = Array.from({ length: 28 }, (_, i) => `c${i}`);
    const folha = abrirZip(escreverXlsx([linha]))['xl/worksheets/sheet1.xml'];
    expect(folha).toContain('<c r="Z1"');
    expect(folha).toContain('<c r="AA1"');
    expect(folha).toContain('<c r="AB1"');
  });

  it('o mesmo conteúdo gera o mesmo arquivo, byte a byte', () => {
    expect(escreverXlsx(LINHAS).equals(escreverXlsx(LINHAS))).toBe(true);
  });

  it('CSV: ponto e vírgula, vírgula decimal, BOM, CRLF e aspas onde precisa', () => {
    const texto = escreverCsv([
      ['Produto', 'Custo médio'],
      ['Açúcar; refinado', 4.89],
      ['Molho "da casa"', null],
      ['Linha\nquebrada', 1000.5],
    ]).toString('utf8');
    expect(texto.charCodeAt(0)).toBe(0xfeff);
    expect(texto.slice(1)).toBe(
      'Produto;Custo médio\r\n"Açúcar; refinado";4,89\r\n"Molho ""da casa""";\r\n"Linha\nquebrada";1000,5\r\n',
    );
  });

  it('CSV: texto que o Excel executaria como fórmula ganha apóstrofo; número negativo não', () => {
    const campos = escreverCsv([['=1+1', '+55 21', '-oferta', '@comando', -3.5, 'normal']])
      .toString('utf8')
      .slice(1)
      .trim()
      .split(';');
    expect(campos).toEqual(["'=1+1", "'+55 21", "'-oferta", "'@comando", '-3,5', 'normal']);
  });
});
