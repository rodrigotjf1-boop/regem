import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { ArquivoIbptInvalido, lerArquivosIbpt, lerCsvIbpt, lerZip } from './ibpt-arquivo';

// Leitura da tabela do IBPT como ela vem do site: um CSV por UF (Windows-1252, `;`, descrição
// entre aspas), normalmente dentro de um ZIP. Formato conferido nos arquivos reais (base da skill
// `cupom-fiscal`, §5.7).

const CAB = 'codigo;ex;tipo;descricao;nacionalfederal;importadosfederal;estadual;municipal;vigenciainicio;vigenciafim;chave;versao;fonte';

// CSV em Windows-1252 — a descrição tem acento e o `…` (0x85), que só existe nessa codificação.
function csv(linhas: string[], opcoes: { versao?: string; chave?: string; ini?: string; fim?: string } = {}) {
  const v = opcoes.versao ?? '26.2.B';
  const k = opcoes.chave ?? 'C44399';
  const cauda = `${opcoes.ini ?? '20/09/2026'};${opcoes.fim ?? '31/10/2026'};${k};${v};IBPT/empresometro.com.br`;
  const texto = [CAB, ...linhas.map((l) => `${l};${cauda}`)].join('\r\n') + '\r\n';
  const buf = Buffer.from(texto, 'latin1');
  return Buffer.from(buf.map((b) => (b === 0x7e ? 0x85 : b))); // "~" → "…" (0x85)
}

const LINHAS = [
  '21069090;;0;"Preparações alimentícias; outras~";13.45;36.08;20.00;0.00',
  '19059090;01;0;"Pão do tipo comum";4.20;4.20;0.00;0.00',
  '19059090;;0;"Outros produtos de padaria";13.45;21.70;20.00;0.00',
  '22021000;;0;"Águas, incluídas as águas minerais";17.05;20.10;18.00;0.00',
  '010101000;;1;"Serviço (NBS) — ignorado";10.00;10.00;0.00;2.00',
  '0101;;2;"Item da LC 116 — ignorado";10.00;10.00;0.00;5.00',
];

// ZIP de verdade: CRC32, deflate ou guardado, e opcionalmente tamanhos no "data descriptor"
// (bit 3) — é assim que alguns compactadores gravam, e aí só o diretório central tem os tamanhos.
const TAB_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = TAB_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function zip(entradas: { nome: string; dados: Buffer; guardado?: boolean }[], descritor = false) {
  const locais: Buffer[] = [];
  const centrais: Buffer[] = [];
  let off = 0;
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8');
    const comp = e.guardado ? e.dados : deflateRawSync(e.dados);
    const crc = crc32(e.dados);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(descritor ? 0x0808 : 0x0800, 6);
    lh.writeUInt16LE(e.guardado ? 0 : 8, 8);
    lh.writeUInt32LE(descritor ? 0 : crc, 14);
    lh.writeUInt32LE(descritor ? 0 : comp.length, 18);
    lh.writeUInt32LE(descritor ? 0 : e.dados.length, 22);
    lh.writeUInt16LE(nome.length, 26);
    const dd = Buffer.alloc(descritor ? 16 : 0);
    if (descritor) {
      dd.writeUInt32LE(0x08074b50, 0);
      dd.writeUInt32LE(crc, 4);
      dd.writeUInt32LE(comp.length, 8);
      dd.writeUInt32LE(e.dados.length, 12);
    }
    locais.push(lh, nome, comp, dd);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(descritor ? 0x0808 : 0x0800, 8);
    ch.writeUInt16LE(e.guardado ? 0 : 8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(e.dados.length, 24);
    ch.writeUInt16LE(nome.length, 28);
    ch.writeUInt32LE(off, 42);
    centrais.push(ch, nome);
    off += 30 + nome.length + comp.length + dd.length;
  }
  const central = Buffer.concat(centrais);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(entradas.length, 8);
  fim.writeUInt16LE(entradas.length, 10);
  fim.writeUInt32LE(central.length, 12);
  fim.writeUInt32LE(off, 16);
  return Buffer.concat([...locais, central, fim]);
}

describe('arquivo da tabela do IBPT', () => {
  it('lê o CSV do site: só NCM, exceção de TIPI, percentuais, vigência, chave e fonte', () => {
    const t = lerCsvIbpt('TabelaIBPTaxRJ26.2.B.csv', csv(LINHAS), 1);
    expect(t).toMatchObject({
      uf: 'RJ', versao: '26.2.B', chave: 'C44399', fonte: 'IBPT/empresometro.com.br',
      vigenciaInicio: '2026-09-20', vigenciaFim: '2026-10-31',
    });
    expect(t.linhas).toHaveLength(4); // NBS e LC 116 ficam de fora
    expect(t.linhas.find((l) => l.ncm === '21069090')).toEqual({
      ncm: '21069090', ex: '', nacionalFederal: 13.45, importadosFederal: 36.08, estadual: 20, municipal: 0,
    });
    expect(t.linhas.filter((l) => l.ncm === '19059090').map((l) => l.ex).sort()).toEqual(['', '01']);
  });

  it('recusa o que não é a tabela como veio: nome, cabeçalho, versões misturadas, NCM torto, arquivo cortado', () => {
    const erro = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        expect(e).toBeInstanceOf(ArquivoIbptInvalido);
        return (e as Error).message;
      }
      throw new Error('deveria recusar');
    };
    expect(erro(() => lerCsvIbpt('tabela.csv', csv(LINHAS), 1))).toContain('TabelaIBPTax<UF><versão>.csv');
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxXX26.2.B.csv', csv(LINHAS), 1))).toContain('não é uma UF');
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxRJ26.2.A.csv', csv(LINHAS), 1))).toContain('versão 26.2.A');
    const semCab = Buffer.from(csv(LINHAS).toString('latin1').replace('codigo;ex', 'ncm;ex'), 'latin1');
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxRJ26.2.B.csv', semCab, 1))).toContain('cabeçalho');
    const misturado = Buffer.concat([csv(LINHAS.slice(0, 2)), Buffer.from(`21011200;;0;"Café";9.25;12.00;12.00;0.00;20/09/2026;31/10/2026;OUTRA;26.2.B;IBPT\r\n`, 'latin1')]);
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxRJ26.2.B.csv', misturado, 1))).toContain('diferente das outras linhas');
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxRJ26.2.B.csv', csv(['2106909;;0;"x";1;1;1;0']), 1))).toContain('8 dígitos');
    expect(erro(() => lerCsvIbpt('TabelaIBPTaxRJ26.2.B.csv', csv(LINHAS)))).toContain('parece cortado');
  });

  it('ZIP do site: CSVs em pasta, deflate e guardado, tamanhos no fim, ZIP dentro de ZIP — cartaz e manual ignorados', () => {
    const rj = csv(LINHAS);
    const sp = csv(LINHAS, { chave: 'A906AF' });
    const interno = zip([{ nome: 'TabelaIBPTaxSP26.2.B.csv', dados: sp, guardado: true }]);
    const externo = zip(
      [
        { nome: 'Tabelas/', dados: Buffer.alloc(0), guardado: true },
        { nome: 'Tabelas/TabelaIBPTaxRJ26.2.B.csv', dados: rj },
        { nome: 'Cartazes/cartaz.pdf', dados: Buffer.from('%PDF-1.4 cartaz') },
        { nome: 'Outras/outras-ufs.zip', dados: interno },
      ],
      true,
    );
    expect(lerZip(externo).map((e) => e.nome)).toContain('Tabelas/TabelaIBPTaxRJ26.2.B.csv');
    const tabelas = lerArquivosIbpt([{ nome: 'TabelaIBPTax26.2.B.zip', dados: externo }], 1);
    expect(tabelas.map((t) => `${t.uf} ${t.chave}`).sort()).toEqual(['RJ C44399', 'SP A906AF']);
    expect(tabelas.every((t) => t.linhas.length === 4)).toBe(true);
    // CSVs soltos também servem.
    expect(lerArquivosIbpt([{ nome: 'TabelaIBPTaxRJ26.2.B.csv', dados: rj }], 1)).toHaveLength(1);
  });

  it('envio sem tabela ou com ZIP estragado é recusado com o motivo', () => {
    expect(() => lerArquivosIbpt([{ nome: 'manual.pdf', dados: Buffer.from('%PDF') }], 1)).toThrow('Nenhuma tabela do IBPT');
    expect(() => lerArquivosIbpt([{ nome: 'x.zip', dados: Buffer.from('nao e zip') }], 1)).toThrow(ArquivoIbptInvalido);
  });

  // Um ZIP feito por compactador de verdade (o tar do Windows), além do nosso: é o formato que a
  // pessoa vai mandar quando refizer o ZIP à mão. Pelo caminho completo: o `tar` do PATH pode ser o
  // GNU do Git, que lê `C:` como servidor remoto (ERR-077).
  const tarWin = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  const temTar = process.platform === 'win32' && spawnSync(tarWin, ['--version']).status === 0;
  (temTar ? it : it.skip)('ZIP feito pelo tar do Windows é lido igual', () => {
    const dir = mkdtempSync(join(tmpdir(), 'regem-ibpt-'));
    try {
      writeFileSync(join(dir, 'TabelaIBPTaxRJ26.2.B.csv'), csv(LINHAS));
      const destino = join(dir, 'tabela.zip');
      const r = spawnSync(tarWin, ['-a', '-c', '-f', destino, '-C', dir, 'TabelaIBPTaxRJ26.2.B.csv']);
      expect(r.status).toBe(0);
      const [t] = lerArquivosIbpt([{ nome: 'tabela.zip', dados: readFileSync(destino) }], 1);
      expect(t).toMatchObject({ uf: 'RJ', versao: '26.2.B' });
      expect(t.linhas).toHaveLength(4);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
