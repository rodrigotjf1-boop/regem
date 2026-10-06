import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

// MODELO MODERNO da etiqueta no servidor da loja (edge/escpos.mjs é ESM — roda num node à parte).
//
// O clássico empilhava tudo e nunca conferiu a altura: com seis linhas o QR passava do fim
// da etiqueta de 40 mm e saía cortado (ERR-156). Aqui a garantia é de conta: em qualquer
// tamanho de papel, NADA do desenho passa da largura nem da altura, e o QR não é invadido
// pelo texto. Quem confere que o QR lê de verdade é o emulador + decodificador, fora do CI.

type D = Record<string, string>;
const COMUM: D = { m: 'moderno', loja: 'Mister Burguer Steakhouse', produto: 'Kit blend', unidade: 'saco', manip: '27/08/2026', hora: '18:40', resp: 'Rodrigo O.', validade: '10/09/2026', status: 'FECHADO', codigo: '866855088746', cod: 'qr' };
const LONGA: D = { m: 'moderno', loja: 'Restaurante e Churrascaria do Centro Historico Ltda', produto: 'Molho barbecue defumado da casa com pimenta e mel', unidade: 'pote de 1 kg', manip: '05/10/2026', hora: '09:15', resp: 'Maria Aparecida S.', validade: '08/10/2026', status: 'EM USO', lote: 'LOTE-2026-10-A77', fornecedor: 'Distribuidora Alimentos', codigo: '386681712811', cod: 'qr' };

const cabecalho = (tam: string, d: unknown) => `@ETIQUETA:${tam};v=2;d=${Buffer.from(JSON.stringify(d)).toString('base64url')}`;
const corpo = (d: D) => [d.loja ?? 'Loja', `@B${d.produto}`, `Fabricacao: ${d.manip}`, `@BVALIDADE: ${d.validade}`, `@QR:${d.codigo}`];
const conteudo = (tam: string, d: D) => [cabecalho(tam, d), ...corpo(d)].join('\n');
const classico = (tam: string, d: D) => [`@ETIQUETA:${tam}`, ...corpo(d)].join('\n');

type Caso = { conteudo: string; linguagem: string | null; largura?: number };
function renderizar(casos: Caso[]): string[] {
  const mod = join(__dirname, '..', '..', '..', 'edge', 'escpos.mjs').replace(/\\/g, '/');
  const code = `import { renderEscpos } from 'file:///${mod.replace(/^\//, '')}';
    const casos = JSON.parse(process.env.CASOS);
    process.stdout.write(JSON.stringify(casos.map((c) => renderEscpos(c.conteudo, c.largura ?? 80, c.linguagem).toString('latin1'))));`;
  const saida = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, CASOS: JSON.stringify(casos) },
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(saida.toString());
}

// Lê do próprio ZPL onde cada coisa começa e termina.
type Campo = { x: number; y: number; h: number; texto: string; bloco: number };
function medir(zpl: string) {
  const W = Number(/\^PW(\d+)/.exec(zpl)?.[1]);
  const H = Number(/\^LL(\d+)/.exec(zpl)?.[1]);
  const caixas = [...zpl.matchAll(/\^FO(\d+),(\d+)\^GB(\d+),(\d+),\d+\^FS/g)].map((m) => ({ x: +m[1], y: +m[2], w: +m[3], h: +m[4] }));
  const campos: Campo[] = [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+(?:\^FR)?(?:\^FB(\d+),\d+,0,[LCR])?\^FD(.*?)\^FS/g)].map((m) => ({
    x: +m[1], y: +m[2], h: +m[3], bloco: m[4] ? +m[4] : 0, texto: m[5],
  }));
  const q = /\^FO(\d+),(\d+)\^BQN,2,(\d+)\^FDLA,(.*?)\^FS/.exec(zpl);
  // O QR do ZPL desce 10 pontos a partir do ^FO; versão 1 = 21 módulos.
  const qr = q ? { x: +q[1], y: +q[2] + 10, lado: 21 * +q[3], dado: q[4] } : null;
  return { W, H, caixas, campos, qr };
}
// A mesma métrica do desenho: largura média de um caractere da fonte 0 (fração da altura).
const larguraDe = (c: Campo) => c.texto.length * c.h * (/^[\d/: ]+$/.test(c.texto) ? 0.45 : c.texto === c.texto.toUpperCase() ? 0.54 : 0.47);

describe('etiqueta moderna (ZPL): nada passa do papel', () => {
  const larguras = [40, 45, 50, 60, 70, 80, 100, 120];
  const alturas = [25, 30, 35, 40, 50, 60, 100, 150];
  const tamanhos = larguras.flatMap((w) => alturas.map((h) => `${w}x${h}`));

  it.each([['comum', COMUM], ['com os textos mais compridos', LONGA]])('%s: em 64 tamanhos, tudo dentro da largura e da altura', (_n, d) => {
    const saidas = renderizar(tamanhos.map((t) => ({ conteudo: conteudo(t, d as D), linguagem: 'zpl' })));
    saidas.forEach((zpl, i) => {
      const m = medir(zpl);
      const [w, h] = tamanhos[i].split('x').map(Number);
      expect({ t: tamanhos[i], W: m.W, H: m.H }).toEqual({ t: tamanhos[i], W: w * 8, H: h * 8 });
      expect(m.qr).not.toBeNull();
      const fora: string[] = [];
      for (const c of m.caixas) if (c.x + c.w > m.W || c.y + c.h > m.H) fora.push(`caixa ${JSON.stringify(c)}`);
      for (const c of m.campos) {
        if (c.y + c.h > m.H) fora.push(`texto baixo demais: ${c.texto}`);
        if (c.bloco ? c.x + c.bloco > m.W : c.x + larguraDe(c) > m.W) fora.push(`texto largo demais: ${c.texto}`);
      }
      const qr = m.qr!;
      if (qr.x + qr.lado > m.W - 16 || qr.y + qr.lado > m.H) fora.push(`QR fora: ${JSON.stringify(qr)}`);
      // texto na mesma faixa de altura do QR termina antes dele (e o número fica embaixo)
      for (const c of m.campos) {
        const naAltura = c.y < qr.y + qr.lado && c.y + c.h > qr.y;
        if (naAltura && !c.bloco && c.x < qr.x && c.x + larguraDe(c) > qr.x - 8) fora.push(`texto invade o QR: ${c.texto}`);
      }
      expect({ t: tamanhos[i], fora }).toEqual({ t: tamanhos[i], fora: [] });
    });
  });

  it('60 x 40: produto na faixa preta, dia da semana, data, QR com o número e rodapé', () => {
    const [zpl] = renderizar([{ conteudo: conteudo('60x40', COMUM), linguagem: 'zpl' }]);
    expect(zpl).toContain('^FO8,8^GB464,60,60^FS'); // a faixa
    expect(zpl).toMatch(/\^A0N,44,44\^FR\^FDKIT BLEND\^FS/);
    expect(zpl).toMatch(/\^FR\^FB\d+,1,0,C\^FDQUI\^FS/); // 10/09/2026 é uma quinta
    expect(zpl).toMatch(/\^FD10\/09\/2026\^FS/);
    expect(zpl).toMatch(/\^BQN,2,4\^FDLA,866855088746\^FS/);
    expect(zpl).toMatch(/\^FB\d+,1,0,C\^FD866855088746\^FS/);
    expect(zpl).toMatch(/\^FR\^FB\d+,1,0,C\^FDFECHADO\^FS/);
    expect(zpl).toContain('^FDMister Burguer Steakhouse^FS');
    expect(zpl).toContain('^FDMANIPULADO^FS');
    expect(zpl).toContain('^FD27/08/2026 18:40^FS');
    expect(zpl).not.toMatch(/[^\x00-\x7f]/); // sem acento: igual em qualquer etiquetadora
  });

  it('dia da semana sai da data, sem depender do fuso da máquina', () => {
    const datas: [string, string][] = [['01/01/2026', 'QUI'], ['04/10/2026', 'DOM'], ['05/10/2026', 'SEG'], ['06/10/2026', 'TER'], ['29/02/2028', 'TER'], ['31/12/2026', 'QUI']];
    const saidas = renderizar(datas.map(([validade]) => ({ conteudo: conteudo('60x40', { ...COMUM, validade }), linguagem: 'zpl' })));
    saidas.forEach((zpl, i) => expect(zpl).toMatch(new RegExp(`\\^FR\\^FB\\d+,1,0,C\\^FD${datas[i][1]}\\^FS`)));
  });

  it('campo desligado não sai; "Sem código" tira o QR e o texto ganha a largura toda', () => {
    const enxuta: D = { m: 'moderno', produto: 'Queijo prato', manip: '06/10/2026', validade: '09/10/2026', codigo: '012345678905', cod: 'nenhum' };
    const [zpl] = renderizar([{ conteudo: conteudo('60x40', enxuta), linguagem: 'zpl' }]);
    expect(zpl).not.toContain('^BQ');
    expect(zpl).not.toContain('RESP.');
    expect(zpl).not.toContain('UNID.');
    expect(zpl).not.toContain('012345678905');
    expect(zpl).toContain('^FDQUEIJO PRATO^FS');
    expect(zpl).toContain('^FD06/10/2026^FS'); // sem hora
  });

  it('etiqueta maior que 60 x 40 é o mesmo desenho ampliado (letra e QR maiores)', () => {
    const [zpl] = renderizar([{ conteudo: conteudo('100x50', COMUM), linguagem: 'zpl' }]);
    expect(zpl).toMatch(/\^BQN,2,5\^FDLA,866855088746\^FS/);
    expect(zpl).toMatch(/\^A0N,55,55\^FR\^FDKIT BLEND\^FS/);
  });
});

describe('etiqueta moderna: quando NÃO sai, sai o clássico — nunca erro', () => {
  it('papel menor que 40 x 25, EPL, carga estragada ou de outro modelo → igual ao clássico', () => {
    const iguais: [Caso, Caso][] = [
      [{ conteudo: conteudo('33x22', COMUM), linguagem: 'zpl' }, { conteudo: classico('33x22', COMUM), linguagem: 'zpl' }],
      [{ conteudo: conteudo('60x20', COMUM), linguagem: 'zpl' }, { conteudo: classico('60x20', COMUM), linguagem: 'zpl' }],
      [{ conteudo: conteudo('60x40', COMUM), linguagem: 'epl' }, { conteudo: classico('60x40', COMUM), linguagem: 'epl' }],
      [{ conteudo: [`@ETIQUETA:60x40;v=2;d=isto-nao-e-json`, ...corpo(COMUM)].join('\n'), linguagem: 'zpl' }, { conteudo: classico('60x40', COMUM), linguagem: 'zpl' }],
      [{ conteudo: [cabecalho('60x40', { ...COMUM, m: 'outro' }), ...corpo(COMUM)].join('\n'), linguagem: 'zpl' }, { conteudo: classico('60x40', COMUM), linguagem: 'zpl' }],
      [{ conteudo: [cabecalho('60x40', { ...COMUM, validade: '2026-09-10' }), ...corpo(COMUM)].join('\n'), linguagem: 'zpl' }, { conteudo: classico('60x40', COMUM), linguagem: 'zpl' }],
      [{ conteudo: [cabecalho('60x40', { ...COMUM, produto: '   ' }), ...corpo(COMUM)].join('\n'), linguagem: 'zpl' }, { conteudo: classico('60x40', COMUM), linguagem: 'zpl' }],
      [{ conteudo: [cabecalho('60x40', { ...COMUM, m: 'outro' }), ...corpo(COMUM)].join('\n'), linguagem: null }, { conteudo: classico('60x40', COMUM), linguagem: null }],
    ];
    const saidas = renderizar(iguais.flat());
    for (let i = 0; i < saidas.length; i += 2) expect({ caso: i / 2, igual: saidas[i] === saidas[i + 1] }).toEqual({ caso: i / 2, igual: true });
  });

  it('caractere de comando do ZPL (^ e ~) nos dados não vira comando', () => {
    const [zpl] = renderizar([{ conteudo: conteudo('60x40', { ...COMUM, produto: 'Kit^XZ~blend', resp: '^FDx', loja: '~JR' }), linguagem: 'zpl' }]);
    expect(zpl.match(/\^XZ/g)).toHaveLength(1);
    expect(zpl).not.toContain('~');
  });
});

describe('etiqueta moderna em bobina (ESC/POS)', () => {
  it('mesma informação, empilhada: produto e validade em letra dupla, QR e o número', () => {
    const [b80, b58] = renderizar([
      { conteudo: conteudo('60x40', COMUM), linguagem: null, largura: 80 },
      { conteudo: conteudo('60x40', LONGA), linguagem: 'escpos', largura: 58 },
    ]);
    const dupla = '\x1d\x21\x11';
    expect(b80).toContain(`${dupla}KIT BLEND\n`);
    expect(b80).toContain('MANIPULADO 27/08/2026 18:40\n');
    expect(b80).toContain('RESP. Rodrigo O.\n');
    expect(b80).toContain('UNID. saco\n');
    expect(b80).toContain(`${dupla}QUI 10/09/2026\n`);
    expect(b80).toContain('\x1d(k'); // QR
    expect(b80).toContain('866855088746\n');
    expect(b80).toContain('FECHADO - Mister Burguer Steakhouse\n');
    expect(b58).toContain('LOTE LOTE-2026-10-A77');
    expect(b58).toContain(`${dupla}QUI 08/10/2026\n`);
    // nenhuma linha passa da largura do papel (32 colunas em 58 mm; letra dupla = metade)
    for (const linha of b58.split('\n')) expect(linha.replace(/[\x00-\x1f]|\x1d.|\x1b../g, '').length).toBeLessThanOrEqual(48);
  });
});
