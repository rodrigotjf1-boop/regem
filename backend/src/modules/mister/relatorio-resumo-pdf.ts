// pdfkit é CommonJS: o import por require (o mesmo do `relatorio-insumo-pdf.ts`).
import PDFDocument = require('pdfkit');
import type { PlanoDoGrafico } from './grafico/plano-do-grafico';
import type { PlanoDoResumo } from './grafico/plano-do-resumo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PDF DO RESUMO DO DIA E DA SEMANA (versão 5, M5e; protótipo `mockups/regem-mister-ouve-ve-mostra.html`, aba "Arquivo e
// link" › "PDF do resumo"): o cabeçalho, os números grandes, os gráficos e os pontos de atenção — o MESMO plano da
// página do link (decisão 8: os dois mostram o mesmo conteúdo). O desenho segue o da imagem da conversa (M5d): azul-
// marinho, a maior em dourado, o período anterior em cinza claro ao lado, a grade leve.

const OURO = '#D4952F';
const MARINHO = '#2F4A60';
const ANTERIOR = '#C9D3DC';
const TINTA = '#0F2230';
const CINZA = '#5B6B78';
const LINHA = '#D5DCE3';
const GRADE = '#E6ECF1';
const VERDE = '#0E7C66';
const VERMELHO = '#B42318';
/** As cores das partes (canais), na ordem — as mesmas da imagem. */
const CORES_DAS_PARTES = ['#2F4A60', '#D4952F', '#5B87A6', '#8FA9BC', '#B9C7D2', '#DCE3E9'];

type Doc = InstanceType<typeof PDFDocument>;

/** As colunas: o anterior (claro) à esquerda, o atual à direita; o valor em cima quando cabe; o rótulo em 1 ou 2 linhas. */
function colunas(doc: Doc, g: PlanoDoGrafico, L: number, y: number, W: number, altura: number): void {
  const barras = g.barras ?? [];
  const comAnterior = barras.some((b) => b.anterior !== undefined);
  const base = y + altura;
  const maior = Math.max(1, ...barras.map((b) => Math.max(b.valor, b.anterior ?? 0)));
  const n = Math.max(1, barras.length);
  const passo = W / n;
  const larg = Math.max(2, Math.min(30, passo * (comAnterior ? 0.36 : 0.62)));
  for (const f of [1 / 3, 2 / 3]) doc.moveTo(L, base - (altura - 14) * f).lineTo(L + W, base - (altura - 14) * f).lineWidth(0.5).strokeColor(GRADE).stroke();
  doc.moveTo(L, base).lineTo(L + W, base).lineWidth(0.8).strokeColor(LINHA).stroke();
  const iMaior = barras.reduce((m, b, i, todas) => (b.valor > todas[m].valor ? i : m), 0);
  const fonte = n > 16 ? 6 : 7.5;
  const cabe = barras.every((b) => b.texto.length * fonte * 0.55 <= passo - 2);
  barras.forEach((b, i) => {
    const meio = L + i * passo + passo / 2;
    const xAtual = comAnterior ? meio + 1 : meio - larg / 2;
    if (comAnterior && (b.anterior ?? 0) > 0) {
      const ha = ((b.anterior ?? 0) / maior) * (altura - 14);
      doc.roundedRect(meio - larg - 1, base - ha, larg, ha, Math.min(2, ha / 2)).fillColor(ANTERIOR).fill();
    }
    const h = (b.valor / maior) * (altura - 14);
    if (h > 0) doc.roundedRect(xAtual, base - h, larg, h, Math.min(2, h / 2)).fillColor(i === iMaior ? OURO : MARINHO).fill();
    if (cabe || i === iMaior)
      doc.fillColor(TINTA).font('Helvetica').fontSize(fonte).text(b.texto, meio - passo / 2 - 6, base - h - fonte - 3, { width: passo + 12, align: 'center' });
    if (n <= 24 || i % Math.ceil(n / 24) === 0) {
      doc.fillColor(CINZA).font('Helvetica').fontSize(fonte).text(b.rotulo, meio - passo / 2 - 6, base + 3, { width: passo + 12, align: 'center' });
      if (b.rotulo2) doc.text(b.rotulo2, meio - passo / 2 - 6, base + 3 + fonte + 1, { width: passo + 12, align: 'center' });
    }
  });
}

/** Participação e mais vendidos: uma linha por parte — o nome, a barra do tamanho dela e o valor (com a % na participação). */
function linhasDeBarras(doc: Doc, g: PlanoDoGrafico, L: number, y: number, W: number): number {
  const partes = g.partes ?? [];
  const soma = partes.reduce((s, p) => s + p.valor, 0) || 1;
  const maior = Math.max(1, ...partes.map((p) => p.valor));
  const nomeW = W * 0.34;
  const valorW = W * 0.24;
  const barraW = W - nomeW - valorW - 12;
  partes.forEach((p, i) => {
    const cor = g.forma === 'participacao' ? CORES_DAS_PARTES[i % CORES_DAS_PARTES.length] : i === 0 ? OURO : MARINHO;
    doc.fillColor(TINTA).font('Helvetica').fontSize(9).text(p.nome, L, y + 1, { width: nomeW - 6, lineBreak: false, ellipsis: true });
    const w = Math.max(2, (p.valor / maior) * barraW);
    doc.roundedRect(L + nomeW, y + 1, w, 10, 2).fillColor(cor).fill();
    const extra = g.forma === 'participacao' ? ` · ${Math.round((p.valor / soma) * 100)}%` : '';
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(`${p.texto}${extra}`, L + nomeW + barraW + 12, y + 1, { width: valorW, align: 'right', lineBreak: false });
    y += 17;
  });
  return y;
}

/** Um gráfico com o título, o número principal e a comparação; devolve onde terminou. */
function grafico(doc: Doc, g: PlanoDoGrafico, L: number, y: number, W: number): number {
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(g.titulo, L, y, { width: W * 0.6 });
  if (g.kpi) doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10.5).text(g.kpi, L + W * 0.6, y, { width: W * 0.4, align: 'right' });
  y = doc.y + 1;
  if (g.delta) {
    doc.fillColor(g.delta.tom === 'bom' ? VERDE : g.delta.tom === 'ruim' ? VERMELHO : CINZA).font('Helvetica').fontSize(8.5).text(g.delta.texto, L, y, { width: W, align: 'right' });
    y = doc.y;
  }
  y += 8;
  if (g.forma === 'colunas') {
    const altura = 120;
    colunas(doc, g, L, y, W, altura);
    y += altura + ((g.barras ?? []).some((b) => b.rotulo2) ? 24 : 16);
    if (g.legenda?.length && (g.barras ?? []).some((b) => b.anterior !== undefined)) {
      const itens: Array<[string, string]> = [
        [MARINHO, g.legenda[0]],
        [ANTERIOR, g.legenda[1] ?? 'o período anterior'],
        [OURO, g.legenda[2] ?? 'o maior'],
      ];
      let x = L;
      for (const [cor, t] of itens) {
        doc.rect(x, y + 2, 7, 7).fillColor(cor).fill();
        doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(t, x + 10, y + 1, { lineBreak: false });
        x += 14 + doc.widthOfString(t) + 14;
      }
      y += 14;
    }
  } else y = linhasDeBarras(doc, g, L, y, W);
  return y + 6;
}

export function gerarPdfDoResumo(p: PlanoDoResumo, titulo = 'resumo.pdf'): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 44, info: { Title: titulo, Author: 'Regem · Mister' } });
  const pedacos: Buffer[] = [];
  doc.on('data', (c) => pedacos.push(c as Buffer));
  const pronto = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(pedacos))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  const fundo = () => doc.page.height - doc.page.margins.bottom - 14;
  let y = 44;
  /** Quebra a página quando o próximo bloco não cabe. */
  const caber = (altura: number) => {
    if (y + altura > fundo()) {
      doc.addPage();
      y = doc.page.margins.top;
    }
  };

  // O cabeçalho: REGEM · MISTER, a empresa, o título e quando foi lido.
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(10).text('REGEM · MISTER', L, y, { characterSpacing: 1.5 });
  doc.fillColor(TINTA).font('Helvetica').fontSize(10).text(p.loja && p.loja !== p.empresa ? `${p.empresa} · ${p.loja}` : p.empresa, L + 120, y, { width: W - 120, align: 'right' });
  y += 16;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(OURO).stroke();
  y += 12;
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(16).text(p.titulo, L, y, { width: W });
  y = doc.y + 2;
  doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(`Gerado com os números lidos em ${p.lidoEm}`, L, y, { width: W });
  y = doc.y + 14;

  // Os números grandes, lado a lado (até 5).
  const col = W / Math.max(1, p.numeros.length);
  let maiorY = y;
  p.numeros.forEach((n, i) => {
    const x = L + i * col;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(16).text(n.valor, x, y, { width: col - 10 });
    doc.fillColor(CINZA).font('Helvetica').fontSize(8.5).text(n.rotulo, x, doc.y + 1, { width: col - 10 });
    if (n.nota) doc.fillColor(n.tom === 'bom' ? VERDE : n.tom === 'ruim' ? VERMELHO : CINZA).fontSize(8).text(n.nota, x, doc.y + 1, { width: col - 10 });
    maiorY = Math.max(maiorY, doc.y);
  });
  y = maiorY + 16;

  // Os gráficos, um embaixo do outro (o que não cabe vai para a página seguinte).
  for (const a of p.abas) {
    const alto = a.grafico.forma === 'colunas' ? 200 : 50 + (a.grafico.partes?.length ?? 0) * 17;
    caber(alto);
    y = grafico(doc, a.grafico, L, y, W);
    y += 8;
  }

  // Os pontos de atenção: o quê, o detalhe e o valor.
  if (p.atencao.length) {
    caber(40 + Math.min(4, p.atencao.length) * 18);
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11).text('Pontos de atenção', L, y, { width: W });
    y = doc.y + 6;
    doc.fillColor(CINZA).font('Helvetica-Bold').fontSize(8);
    doc.text('O quê', L, y, { width: W * 0.2 });
    doc.text('Detalhe', L + W * 0.2, y, { width: W * 0.6 });
    doc.text('Valor', L + W * 0.8, y, { width: W * 0.2, align: 'right' });
    y += 13;
    for (const a of p.atencao) {
      caber(20);
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(a.oque, L, y, { width: W * 0.2 - 6 });
      doc.fillColor(TINTA).font('Helvetica').fontSize(9).text(a.detalhe, L + W * 0.2, y, { width: W * 0.6 - 6 });
      const fim = doc.y;
      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(9).text(a.valor, L + W * 0.8, y, { width: W * 0.2, align: 'right' });
      y = Math.max(fim, doc.y, y + 12) + 4;
      doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(LINHA).stroke();
    }
  }

  caber(30);
  doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(p.fonte, L, Math.max(y + 12, fundo()), { width: W });
  doc.end();
  return pronto;
}
