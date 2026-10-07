import { deflateRawSync } from 'node:zlib';

// Escritor MÍNIMO de planilha (Excel .xlsx e CSV), sem dependência externa — o par do leitor
// `modules/cliente/ler-xlsx.ts`. Uma planilha só; a 1ª linha é o cabeçalho (sai em negrito).
// Texto vai DENTRO da célula (`inlineStr`), número vai como número: o Excel soma e ordena.

export type Celula = string | number | null | undefined;

// ── ZIP (um .xlsx é um ZIP de XML) ────────────────────────────────────────────────────────
// CRC-32 à mão: o `zlib.crc32` só existe a partir do Node 20.15/22.2 e a imagem é node:20.
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DATA_DOS = 0x21; // 01/01/1980 — data fixa: o mesmo conteúdo gera o mesmo arquivo
function zip(arquivos: { nome: string; conteudo: string }[]): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, 'utf8');
    const dados = Buffer.from(a.conteudo, 'utf8');
    const comprimido = deflateRawSync(dados);
    const crc = crc32(dados);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versão para extrair
    local.writeUInt16LE(0x0800, 6); // nomes em UTF-8
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt16LE(DATA_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    partes.push(local, nome, comprimido);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(DATA_DOS, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comprimido.length, 20);
    c.writeUInt32LE(dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nome);
    offset += 30 + nome.length + comprimido.length;
  }
  const diretorio = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(diretorio.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, diretorio, fim]);
}

// ── XLSX ──────────────────────────────────────────────────────────────────────────────────
// Caractere de controle não existe em XML 1.0: o Excel recusa o arquivo inteiro por um só.
// eslint-disable-next-line no-control-regex
const SEM_CONTROLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const xml = (s: string) =>
  s
    .replace(SEM_CONTROLE, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function coluna(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const CABECALHO_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Monta um .xlsx de uma planilha. `linhas[0]` é o cabeçalho. `larguras` em caracteres. */
export function escreverXlsx(
  linhas: Celula[][],
  opts: { planilha?: string; larguras?: number[] } = {},
): Buffer {
  const nomePlanilha = xml((opts.planilha ?? 'Planilha').replace(/[[\]:*?/\\]/g, ' ').slice(0, 31));
  const corpo = linhas
    .map((linha, r) => {
      const celulas = linha
        .map((v, c) => {
          const ref = `${coluna(c)}${r + 1}`;
          const estilo = r === 0 ? ' s="1"' : '';
          if (v === null || v === undefined || v === '') return '';
          if (typeof v === 'number')
            return Number.isFinite(v) ? `<c r="${ref}"${estilo}><v>${v}</v></c>` : '';
          return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${celulas}</row>`;
    })
    .join('');
  const cols = opts.larguras?.length
    ? `<cols>${opts.larguras
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';
  return zip([
    {
      nome: '[Content_Types].xml',
      conteudo:
        CABECALHO_XML +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        '</Types>',
    },
    {
      nome: '_rels/.rels',
      conteudo:
        CABECALHO_XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/>` +
        '</Relationships>',
    },
    {
      nome: 'xl/workbook.xml',
      conteudo:
        CABECALHO_XML +
        `<workbook xmlns="${NS}" xmlns:r="${REL}">` +
        `<sheets><sheet name="${nomePlanilha}" sheetId="1" r:id="rId1"/></sheets>` +
        '</workbook>',
    },
    {
      nome: 'xl/_rels/workbook.xml.rels',
      conteudo:
        CABECALHO_XML +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
        `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>` +
        '</Relationships>',
    },
    {
      // Dois estilos de célula: 0 = normal, 1 = negrito (cabeçalho).
      nome: 'xl/styles.xml',
      conteudo:
        CABECALHO_XML +
        `<styleSheet xmlns="${NS}">` +
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '</styleSheet>',
    },
    {
      nome: 'xl/worksheets/sheet1.xml',
      conteudo: CABECALHO_XML + `<worksheet xmlns="${NS}">${cols}<sheetData>${corpo}</sheetData></worksheet>`,
    },
  ]);
}

// ── CSV ───────────────────────────────────────────────────────────────────────────────────
// Como o Excel em português abre com dois cliques: `;` de separador, vírgula decimal, BOM para
// os acentos e CRLF. Texto que começa com = + - @ ganha um apóstrofo na frente: sem ele o
// Excel EXECUTA o texto como fórmula (injeção por CSV) — nome de produto é dado digitado.
export function escreverCsv(linhas: Celula[][]): Buffer {
  const campo = (v: Celula): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v).replace('.', ',') : '';
    const texto = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
    return /[";\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
  };
  const texto = linhas.map((l) => l.map(campo).join(';')).join('\r\n') + '\r\n';
  return Buffer.from('﻿' + texto, 'utf8');
}
