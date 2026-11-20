import type { PlanoDoPdfDoInsumo } from '../relatorio-insumo-pdf';
import { Tela } from './tela';

// A IMAGEM DO GRÁFICO NA CONVERSA (M3c parte 3; conversa 15 da versão 3 do protótipo; decisão 6: "gráfico e PDF pelo
// código, sem IA"). O MESMO plano do PDF (o título, os números e as barras): a conversa e o PDF mostram os mesmos números.

/** O que a imagem mostra: o título, os números grandes, as barras e quem é (a empresa e a loja). */
export type GraficoDaConversa = Pick<PlanoDoPdfDoInsumo, 'titulo' | 'numeros' | 'grafico' | 'cabecalho'>;

// Versão 5 (M5d.1, protótipo "Gráficos"): o mesmo desenho da página e do PDF — as barras em azul-marinho, a MAIOR em
// dourado, a grade leve atrás.
const OURO = '#E2A340';
const MARINHO = '#2F4A60';
const TINTA = '#0F2230';
const CINZA = '#5B6B78';
const LINHA = '#D5DCE3';
const GRADE = '#E6ECF1';
export const TAMANHO_DA_IMAGEM = { largura: 1000, altura: 620 } as const;

/** Vale mandar a imagem: pelo menos duas barras e alguma coisa vendida (uma barra só não é gráfico). */
export function valeAImagem(g: Pick<GraficoDaConversa, 'grafico'>): boolean {
  return g.grafico.barras.length >= 2 && g.grafico.barras.some((b) => b.valor > 0);
}

export function imagemDoGrafico(g: GraficoDaConversa): Buffer {
  const { largura: W, altura: H } = TAMANHO_DA_IMAGEM;
  const M = 40;
  const t = new Tela(W, H, '#FFFFFF');
  t.retangulo(0, 0, W, 6, OURO);

  // O título e os números ("212 unidades · 11,9 kg · +18%").
  let y = 24;
  t.texto(t.caber(g.titulo, 'titulo', W - 2 * M), M, y, { tamanho: 'titulo', cor: TINTA });
  y += t.alturaDaLinha('titulo') + 2;
  t.texto(t.caber(g.numeros.map((n) => n.valor).join('  ·  '), 'texto', W - 2 * M), M, y, { tamanho: 'texto', cor: CINZA });
  y += t.alturaDaLinha('texto') + 8;
  // A legenda da linha da média (o outro período), numa linha própria: nunca por cima das barras.
  if (g.grafico.linha) {
    const meio = y + Math.round(t.alturaDaLinha('pequeno') / 2);
    t.linhaH(M, M + 34, meio, TINTA, 2, [8, 5]);
    t.texto(t.caber(g.grafico.linha.texto, 'pequeno', W - 2 * M - 44), M + 44, y, { tamanho: 'pequeno', cor: TINTA });
    y += t.alturaDaLinha('pequeno') + 6;
  }

  // As barras: o valor em cima (todos, quando cabem; senão só o maior), o rótulo embaixo (pulando quando não cabem).
  const barras = g.grafico.barras;
  const n = Math.max(1, barras.length);
  const topo = y + t.alturaDaLinha('texto') + 6;
  const base = H - 74;
  const maior = Math.max(1, ...barras.map((b) => b.valor), g.grafico.linha?.valor ?? 0);
  const passo = (W - 2 * M) / n;
  const larg = Math.max(3, Math.min(72, passo * 0.62));
  const tamValor = n <= 12 ? 'texto' : 'pequeno';
  const todosCabem = barras.every((b) => t.medir(b.texto, tamValor) <= passo - 2);
  const iMaior = barras.reduce((m, b, i) => (b.valor > barras[m].valor ? i : m), 0);
  const maiorRotulo = Math.max(1, ...barras.map((b) => t.medir(b.rotulo, 'pequeno')));
  const pulo = Math.max(1, Math.ceil((maiorRotulo + 10) / passo));
  for (const f of [1 / 3, 2 / 3]) t.linhaH(M, W - M, base - (base - topo) * f, GRADE, 1);
  t.linhaH(M, W - M, base, LINHA, 2);
  barras.forEach((b, i) => {
    const h = (b.valor / maior) * (base - topo);
    const x = M + i * passo + (passo - larg) / 2;
    if (h > 0) t.retangulo(x, base - h, larg, Math.max(1, h), i === iMaior ? OURO : MARINHO);
    if (todosCabem || i === iMaior) t.texto(b.texto, x + larg / 2, base - h - t.alturaDaLinha(tamValor) - 2, { tamanho: tamValor, cor: TINTA, alinhar: 'centro' });
    if (i % pulo === 0) t.texto(b.rotulo, x + larg / 2, base + 8, { tamanho: 'pequeno', cor: CINZA, alinhar: 'centro' });
  });
  if (g.grafico.linha) t.linhaH(M, W - M, base - (g.grafico.linha.valor / maior) * (base - topo), TINTA, 2, [10, 6]);

  // O rodapé: de quem é, e a marca.
  t.texto(t.caber(g.cabecalho, 'pequeno', W * 0.62), M, H - 36, { tamanho: 'pequeno', cor: CINZA });
  t.texto('REGEM · Mister', W - M, H - 36, { tamanho: 'pequeno', cor: OURO, alinhar: 'dir' });
  return t.png();
}
