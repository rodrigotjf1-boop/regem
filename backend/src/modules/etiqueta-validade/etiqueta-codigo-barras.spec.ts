import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// CÓDIGO DE BARRAS DA ETIQUETA CABE NO MODELO (edge/escpos.mjs é ESM — roda num node à parte).
//
// Etiqueta real de 27/08/2026: papel de 60 mm, modelo 40x40, etiquetadora ZPL. As barras
// Code128 do código de 12 dígitos precisavam de 334 pontos e o modelo dava 320 (^PW320):
// saíram sem a parada e o leitor de mesa não leu nenhuma. A largura é conta fechada —
// (início + símbolos + verificador) × 11 módulos + parada de 13, a 2 pontos por módulo.

const CODIGO = '866855088746';
const MARGEM = 20; // 10 módulos de branco de cada lado
const conteudo = (tamanho: string, linhaCodigo: string) =>
  [`@ETIQUETA:${tamanho}`, 'Loja Teste', '@BKit blend', 'Fabricacao: 27/08/2026', '@BVALIDADE: 10/09/2026', linhaCodigo].join('\n');

type Caso = { conteudo: string; linguagem: string | null };
function renderizar(casos: Caso[]): string[] {
  const mod = join(__dirname, '..', '..', '..', 'edge', 'escpos.mjs').replace(/\\/g, '/');
  const code = `import { renderEscpos } from 'file:///${mod.replace(/^\//, '')}';
    const casos = JSON.parse(process.env.CASOS);
    process.stdout.write(JSON.stringify(casos.map((c) => renderEscpos(c.conteudo, 80, c.linguagem).toString('latin1'))));`;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, CASOS: JSON.stringify(casos) },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(saida.toString());
}
const linhaDoCodigo = (zpl: string) => zpl.split('\n').find((l) => /\^B[CEQ]/.test(l)) ?? '';

// Onde as barras começam e terminam, lido da própria linha ZPL.
function medir(linha: string) {
  const x = Number(/\^FO(\d+),/.exec(linha)?.[1]);
  const qr = /\^BQN,2,(\d+)/.exec(linha);
  if (qr) return { tipo: 'qr', x, fim: x + 21 * Number(qr[1]) };
  const dado = /\^FD(.*)\^FS/.exec(linha)?.[1] ?? '';
  const compacto = dado.startsWith('>;');
  const simbolos = compacto ? (dado.length - 2) / 2 : dado.length;
  return { tipo: compacto ? 'c128c' : 'c128b', x, fim: x + ((simbolos + 2) * 11 + 13) * 2 };
}

describe('etiqueta ZPL: o código de barras cabe na largura do modelo', () => {
  it('modelo de 40 mm: Code128 sai compactado, centralizado e com margem branca dos dois lados', () => {
    const [zpl] = renderizar([{ conteudo: conteudo('40x40', `@BARCODE:code128:${CODIGO}`), linguagem: 'zpl' }]);
    const linha = linhaDoCodigo(zpl);
    expect(linha).toMatch(new RegExp(`^\\^FO\\d+,\\d+\\^BY2\\^BCN,60,Y,N,N\\^FD>;${CODIGO}\\^FS$`));
    const m = medir(linha);
    expect(m.fim - m.x).toBe(202);
    expect(m.x).toBeGreaterThanOrEqual(MARGEM);
    expect(m.fim + MARGEM).toBeLessThanOrEqual(320);
  });

  it('modelo em que as barras já cabiam (50 e 60 mm): a linha sai IGUAL à de sempre', () => {
    const saidas = renderizar(
      ['50x30', '60x40', '100x50'].map((t) => ({ conteudo: conteudo(t, `@BARCODE:code128:${CODIGO}`), linguagem: 'zpl' })),
    );
    for (const zpl of saidas) {
      expect(linhaDoCodigo(zpl)).toMatch(new RegExp(`^\\^FO14,\\d+\\^BY2\\^BCN,60,Y,N,N\\^FD${CODIGO}\\^FS$`));
    }
  });

  it('em qualquer largura de 10 a 120 mm o código termina dentro do modelo, com margem', () => {
    const larguras = Array.from({ length: 111 }, (_, i) => i + 10);
    const saidas = renderizar(
      larguras.map((w) => ({ conteudo: conteudo(`${w}x40`, `@BARCODE:code128:${CODIGO}`), linguagem: 'zpl' })),
    );
    saidas.forEach((zpl, i) => {
      const W = larguras[i] * 8;
      const m = medir(linhaDoCodigo(zpl));
      expect({ mm: larguras[i], dentro: m.fim + (m.tipo === 'qr' ? 0 : MARGEM) <= W }).toEqual({ mm: larguras[i], dentro: true });
      if (m.tipo === 'c128c') expect(m.x).toBeGreaterThanOrEqual(MARGEM);
    });
  });

  it('nem compactado cabe (etiqueta estreita, ou código que não é só dígitos) → QR', () => {
    const [estreita, comLetras] = renderizar([
      { conteudo: conteudo('25x25', `@BARCODE:code128:${CODIGO}`), linguagem: 'zpl' },
      { conteudo: conteudo('40x40', '@BARCODE:code128:ABC123XYZ789'), linguagem: 'zpl' },
    ]);
    expect(linhaDoCodigo(estreita)).toMatch(new RegExp(`\\^BQN,2,5\\^FDLA,${CODIGO}\\^FS$`));
    expect(linhaDoCodigo(comLetras)).toMatch(/\^BQN,2,5\^FDLA,ABC123XYZ789\^FS$/);
  });

  it('EAN-13 e QR do modelo não mudam', () => {
    const [ean, qr] = renderizar([
      { conteudo: conteudo('40x40', `@BARCODE:ean13:${CODIGO}`), linguagem: 'zpl' },
      { conteudo: conteudo('40x40', `@QR:${CODIGO}`), linguagem: 'zpl' },
    ]);
    expect(linhaDoCodigo(ean)).toMatch(new RegExp(`^\\^FO14,\\d+\\^BY2\\^BEN,60,Y,N\\^FD${CODIGO}\\^FS$`));
    expect(linhaDoCodigo(qr)).toMatch(new RegExp(`^\\^FO14,\\d+\\^BQN,2,5\\^FDLA,${CODIGO}\\^FS$`));
  });
});

describe('etiqueta em EPL e em bobina: nada muda', () => {
  it('EPL segue no Code128 que escolhe o subconjunto sozinho; bobina segue em {B', () => {
    const [epl, bobina] = renderizar([
      { conteudo: conteudo('40x40', `@BARCODE:code128:${CODIGO}`), linguagem: 'epl' },
      { conteudo: conteudo('40x40', `@BARCODE:code128:${CODIGO}`), linguagem: null },
    ]);
    expect(epl.split('\n').find((l) => l.startsWith('B'))).toMatch(new RegExp(`^B14,\\d+,0,1,2,4,60,N,"${CODIGO}"$`));
    expect(bobina).toContain(`\x1dk\x49\x0e{B${CODIGO}`);
  });
});
