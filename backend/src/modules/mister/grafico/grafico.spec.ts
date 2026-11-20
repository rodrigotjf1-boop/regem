import { inflateSync } from 'node:zlib';
import { ASSINATURA_PNG, Tela, crc32, rgb } from './tela';
import { TAMANHO_DA_IMAGEM, imagemDoGrafico, valeAImagem } from './grafico-do-insumo';

// A IMAGEM DO GRÁFICO DO MISTER (M3c parte 3): a tela de pixels, as letras do atlas e o PNG feitos aqui, sem biblioteca de
// imagem. Os testes LEEM o PNG de volta (os pedaços, o CRC de cada um e os pixels) — o que vale é o arquivo que sai.

/** Lê o PNG: a largura, a altura e os pixels RGB (a tela só grava o filtro "nenhum"). Confere o CRC de cada pedaço. */
function lerPng(b: Buffer): { largura: number; altura: number; px: Buffer } {
  expect(b.subarray(0, 8).equals(ASSINATURA_PNG)).toBe(true);
  let i = 8;
  let largura = 0;
  let altura = 0;
  const idat: Buffer[] = [];
  const tipos: string[] = [];
  while (i < b.length) {
    const n = b.readUInt32BE(i);
    const tipo = b.toString('ascii', i + 4, i + 8);
    const dados = b.subarray(i + 8, i + 8 + n);
    expect(b.readUInt32BE(i + 8 + n)).toBe(crc32(b.subarray(i + 4, i + 8 + n)));
    tipos.push(tipo);
    if (tipo === 'IHDR') {
      largura = dados.readUInt32BE(0);
      altura = dados.readUInt32BE(4);
      expect([dados[8], dados[9]]).toEqual([8, 2]); // 8 bits, RGB
    }
    if (tipo === 'IDAT') idat.push(dados);
    i += 12 + n;
  }
  expect(tipos).toEqual(['IHDR', 'IDAT', 'IEND']);
  const cru = inflateSync(Buffer.concat(idat));
  const px = Buffer.alloc(largura * altura * 3);
  for (let y = 0; y < altura; y++) {
    expect(cru[y * (largura * 3 + 1)]).toBe(0);
    cru.copy(px, y * largura * 3, y * (largura * 3 + 1) + 1, (y + 1) * (largura * 3 + 1));
  }
  return { largura, altura, px };
}
const pixel = (p: { largura: number; px: Buffer }, x: number, y: number) => [...p.px.subarray((y * p.largura + x) * 3, (y * p.largura + x) * 3 + 3)];

describe('a tela e o PNG', () => {
  it('o CRC do formato (o do pedaço IEND é conhecido)', () => {
    expect(crc32(Buffer.from('IEND', 'ascii'))).toBe(0xae426082);
  });
  it('o fundo, um retângulo e as letras saem no PNG, e o PNG se lê de volta', () => {
    const t = new Tela(60, 40, '#FFFFFF');
    t.retangulo(10, 10, 5, 5, '#E2A340');
    const w = t.texto('8', 30, 5, { tamanho: 'texto', cor: '#0F2230' });
    expect(w).toBeGreaterThan(5);
    const p = lerPng(t.png());
    expect([p.largura, p.altura]).toEqual([60, 40]);
    expect(pixel(p, 0, 0)).toEqual([255, 255, 255]);
    expect(pixel(p, 12, 12)).toEqual(rgb('#E2A340'));
    // O "8" pintou pixels escuros na área dele (e nada fora da tela quebrou).
    let escuros = 0;
    for (let y = 0; y < 40; y++) for (let x = 28; x < 30 + w + 2; x++) if (pixel(p, x, y)[0] < 128) escuros++;
    expect(escuros).toBeGreaterThan(10);
  });
  it('medir e caber: o texto longo ganha "…" e cabe', () => {
    const t = new Tela(10, 10);
    expect(t.medir('', 'texto')).toBe(0);
    expect(t.medir('MMMM', 'titulo')).toBeGreaterThan(t.medir('MMMM', 'pequeno'));
    const cortado = t.caber('Carne 56 g · de 01/11 a 16/11 contra 01/10 a 16/10', 'texto', 120);
    expect(cortado.endsWith('…')).toBe(true);
    expect(t.medir(cortado, 'texto')).toBeLessThanOrEqual(120);
    // A letra que o atlas não tem sai como "?" (sem quebrar).
    expect(t.medir('漢', 'texto')).toBe(t.medir('?', 'texto'));
  });
});

describe('a imagem do gráfico do insumo', () => {
  const g = {
    titulo: 'Carne 56 g · hoje (16/11), até 22:40',
    numeros: [{ valor: '212 unidades', rotulo: 'Loja Centro' }],
    cabecalho: 'Burger da Praça · Loja Centro',
    grafico: {
      titulo: 'x',
      barras: [
        { rotulo: '18h', valor: 12, texto: '12' },
        { rotulo: '19h', valor: 71, texto: '71' },
      ],
      linha: null,
      nota: null,
    },
  };
  it('só com duas barras ou mais e alguma venda', () => {
    expect(valeAImagem(g)).toBe(true);
    expect(valeAImagem({ grafico: { ...g.grafico, barras: g.grafico.barras.slice(0, 1) } })).toBe(false);
    expect(valeAImagem({ grafico: { ...g.grafico, barras: g.grafico.barras.map((b) => ({ ...b, valor: 0 })) } })).toBe(false);
  });
  it('o PNG no tamanho da conversa, com a faixa dourada no topo e a barra mais alta dourada', () => {
    const p = lerPng(imagemDoGrafico(g));
    expect([p.largura, p.altura]).toEqual([TAMANHO_DA_IMAGEM.largura, TAMANHO_DA_IMAGEM.altura]);
    expect(pixel(p, 500, 2)).toEqual(rgb('#E2A340'));
    // A segunda barra (a de 71) fica na metade direita, logo acima da base.
    const base = TAMANHO_DA_IMAGEM.altura - 74;
    expect(pixel(p, Math.round(40 + 1.5 * ((TAMANHO_DA_IMAGEM.largura - 80) / 2)), base - 20)).toEqual(rgb('#E2A340'));
    // Versão 5 (M5d.1): as outras barras em azul-marinho (a de 12, na metade esquerda) — o mesmo desenho da página e do PDF.
    expect(pixel(p, Math.round(40 + 0.5 * ((TAMANHO_DA_IMAGEM.largura - 80) / 2)), base - 10)).toEqual(rgb('#2F4A60'));
  });
  it('com a linha da média e muitas barras, também sai (a legenda numa linha própria)', () => {
    const muitas = Array.from({ length: 31 }, (_, i) => ({ rotulo: String(i + 1).padStart(2, '0'), valor: 50 + i, texto: String(50 + i) }));
    const p = lerPng(imagemDoGrafico({ ...g, grafico: { ...g.grafico, barras: muitas, linha: { valor: 60, texto: 'média de 01/10 a 31/10: 60 por dia' } } }));
    expect(p.largura).toBe(TAMANHO_DA_IMAGEM.largura);
  });
});
