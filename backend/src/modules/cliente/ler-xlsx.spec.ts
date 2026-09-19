import { deflateRawSync } from 'node:zlib';
import { lerXlsx } from './ler-xlsx';
import { mapearTabela } from './importar-planilha';

// Leitor de .xlsx sem dependência. Os arquivos são MONTADOS aqui (ZIP + XML), nos dois
// formatos que existem na prática:
//  • SheetJS (como a Anota Aí exporta): texto na célula (t="str"), sem sharedStrings;
//  • Excel (arquivo aberto e salvo de novo): textos em sharedStrings (t="s").
// Conferido também, fora do repositório, com as exportações reais da Anota Aí (set/2026):
// Excel e CSV dos inativos deram os mesmos 9.999 contatos.

function zip(arquivos: Record<string, string>, comprimir = true): Buffer {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let offset = 0;
  for (const [nome, conteudo] of Object.entries(arquivos)) {
    const bruto = Buffer.from(conteudo, 'utf8');
    const dados = comprimir ? deflateRawSync(bruto) : bruto;
    const nomeB = Buffer.from(nome, 'utf8');
    const l = Buffer.alloc(30);
    l.writeUInt32LE(0x04034b50, 0);
    l.writeUInt16LE(comprimir ? 8 : 0, 8);
    l.writeUInt32LE(dados.length, 18);
    l.writeUInt32LE(bruto.length, 22);
    l.writeUInt16LE(nomeB.length, 26);
    locais.push(l, nomeB, dados);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(comprimir ? 8 : 0, 10);
    c.writeUInt32LE(dados.length, 20);
    c.writeUInt32LE(bruto.length, 24);
    c.writeUInt16LE(nomeB.length, 28);
    c.writeUInt32LE(offset, 42);
    centrais.push(c, nomeB);
    offset += 30 + nomeB.length + dados.length;
  }
  const dir = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(Object.keys(arquivos).length, 8);
  fim.writeUInt16LE(Object.keys(arquivos).length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...locais, dir, fim]);
}

const planilha = (linhas: string) =>
  `<?xml version="1.0"?><worksheet><dimension ref="A1:E3"/><cols><col min="1" max="1"/></cols><sheetData>${linhas}</sheetData></worksheet>`;

describe('leitor de Excel (.xlsx) sem dependência', () => {
  it('formato SheetJS (Anota Aí): texto na célula, número puro, célula vazia, linha vazia', () => {
    const xml = planilha(
      '<row r="1"><c r="A1" t="str"><v>Nome do Cliente</v></c><c r="B1" t="str"><v>Número Telefone</v></c>' +
        '<c r="C1" t="str"><v>Número Whatsapp</v></c><c r="D1" t="str"><v>Quantidade de Pedidos</v></c>' +
        '<c r="E1" t="str"><v>Dias de Inatividade</v></c></row>' +
        '<row r="2"><c r="A2" t="str"><v xml:space="preserve">Ana &amp; Cia </v></c><c r="B2" t="str"><v>21900000001</v></c>' +
        '<c r="C2" t="str"><v></v></c><c r="D2"><v>12</v></c><c r="E2"><v>30</v></c></row>' +
        '<row r="3"/>' +
        '<row r="4"><c r="A4" t="str"><v>Bruno</v></c><c r="B4" t="str"><v>21900000002</v></c>' +
        '<c r="C4" t="str"><v>5521900000002</v></c><c r="D4"><v>1</v></c><c r="E4"><v>45</v></c></row>',
    );
    const buf = zip({ '[Content_Types].xml': '<Types/>', 'xl/worksheets/sheet1.xml': xml });
    const { linhas, colunas } = mapearTabela(lerXlsx(buf));
    expect(colunas).toHaveLength(5);
    expect(linhas).toEqual([
      { nome: 'Ana & Cia', telefoneRaw: '21900000001', whatsappRaw: '', pedidos: 12, diasInatividade: 30 },
      { nome: 'Bruno', telefoneRaw: '21900000002', whatsappRaw: '5521900000002', pedidos: 1, diasInatividade: 45 },
    ]);
  });

  it('formato Excel (salvo de novo): sharedStrings, texto rico, célula pulada e arquivo sem compressão', () => {
    const ss =
      '<sst><si><t>Nome do Cliente</t></si><si><t>Número Telefone</t></si>' +
      '<si><r><t>Jo</t></r><r><t>ão</t></r></si></sst>';
    const xml = planilha(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
        // A2 ausente → a coluna do telefone continua sendo a B.
        '<row r="2"><c r="B2"><v>21900000003</v></c></row>' +
        '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3"><v>21900000004</v></c></row>',
    );
    const buf = zip({ 'xl/sharedStrings.xml': ss, 'xl/worksheets/sheet1.xml': xml }, false);
    const { linhas } = mapearTabela(lerXlsx(buf));
    expect(linhas.map((l) => [l.nome, l.telefoneRaw])).toEqual([
      ['', '21900000003'],
      ['João', '21900000004'],
    ]);
  });

  it('não é Excel → erro claro', () => {
    expect(() => lerXlsx(Buffer.from('PK não é zip de verdade'))).toThrow(/Excel/);
  });
});
