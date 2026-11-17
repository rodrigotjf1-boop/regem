// pdfkit é CommonJS: o import por require (o mesmo do `documento-pdf.ts`; sem esModuleInterop, o default vira undefined).
import PDFDocument = require('pdfkit');
import { FONTE_DO_RELATORIO, RelatorioDoInsumo } from './insumo-vendido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PDF DO RELATÓRIO POR INSUMO (M3c parte 2; versão 3 do protótipo, aba "Arquivos e links" › "PDF do relatório";
// decisão 6: "gráfico e PDF pelo código, sem IA"). Duas partes: o PLANO (puro — os textos, os números e as barras, que o
// teste confere) e o DESENHO (o pdfkit desenha só o que o plano diz). A IA escolhe o relatório e escreve a conversa; a
// soma, o gráfico e o PDF saem daqui, com os números da loja.

export interface PlanoDoPdfDoInsumo {
  cabecalho: string;
  gerado: string;
  titulo: string;
  numeros: Array<{ valor: string; rotulo: string }>;
  grafico: { titulo: string; barras: Array<{ rotulo: string; valor: number; texto: string }>; linha: { valor: number; texto: string } | null; nota: string | null };
  deOnde: Array<{ produto: string; detalhe: string; valor: string }>;
  outros: string | null;
  fonte: string;
}

const OURO = '#E2A340';
const TINTA = '#0F2230';
const CINZA = '#5B6B78';
const LINHA = '#D5DCE3';

/** 1234.5 → "1.234,5" (até 3 casas, sem zeros à direita). */
export const numero = (n: number) => (Number(n) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** A unidade no plural, como a pessoa fala ("unidades", "pacotes", "porções"); símbolo (kg, ml) não muda. */
export function pluralDaUnidade(unidade: string): string {
  const u = String(unidade ?? '').trim();
  if (/^(kg|g|gr|ml|l|un|mg)$/i.test(u)) return u;
  return /ão$/i.test(u) ? u.replace(/ão$/i, 'ões') : /[aeiou]$/i.test(u) ? `${u}s` : /r$/i.test(u) ? `${u}es` : u;
}

/** "212 unidades", "1 pacote", "11,9 kg". */
export function comUnidade(n: number, unidade: string): string {
  const u = String(unidade ?? '').trim();
  if (!u) return numero(n);
  return `${numero(n)} ${n === 1 ? u : pluralDaUnidade(u)}`;
}

const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Sao_Paulo' }).replace(/^24/, '00');
  return `${dia}, ${hora}`;
};

/** Mais de 62 dias: o gráfico vai por mês (as barras de um ano não caberiam). */
function agruparPorMes(pontos: RelatorioDoInsumo['serie']['pontos']): Array<{ rotulo: string; quantidade: number }> {
  const meses = new Map<string, number>();
  for (const p of pontos) {
    const k = String(p.dia ?? '').slice(0, 7);
    if (k) meses.set(k, (meses.get(k) ?? 0) + p.quantidade);
  }
  return [...meses.entries()].map(([k, q]) => ({ rotulo: `${k.slice(5, 7)}/${k.slice(2, 4)}`, quantidade: Math.round(q * 1000) / 1000 }));
}

/** "de 01/10 a 16/10" → "01/10 a 16/10" (para não sair "contra de", "média de de"). */
const semDe = (p: string) => p.replace(/^de /, '');

export function planoDoPdfDoInsumo(r: RelatorioDoInsumo, o: { empresa: string; pedidoPor: string; geradoEm: string }): PlanoDoPdfDoInsumo {
  const periodo = r.ateAs ? `${r.periodo}, até ${r.ateAs}` : r.periodo;
  const titulo = `${r.insumo.nome} · ${periodo}${r.comparado ? ` contra ${semDe(r.comparado.periodo)}` : ''}`;
  const numeros: PlanoDoPdfDoInsumo['numeros'] = [{ valor: comUnidade(r.total, r.insumo.unidade), rotulo: r.loja }];
  if (r.kg != null && !/^kg$/i.test(r.insumo.unidade)) numeros.push({ valor: `${numero(Math.round(r.kg * 10) / 10)} kg`, rotulo: 'pela ficha técnica' });
  else if (r.cercaDeUnidades != null) numeros.push({ valor: `cerca de ${numero(r.cercaDeUnidades)}`, rotulo: 'unidades, pelo peso do nome' });
  if (r.comparado)
    numeros.push({
      valor: r.comparado.diferencaPct == null ? '—' : `${r.comparado.diferencaPct > 0 ? '+' : ''}${r.comparado.diferencaPct}%`,
      rotulo: `contra ${semDe(r.comparado.periodo)} (${numero(r.comparado.total)})`,
    });
  else if (r.semanas)
    numeros.push({ valor: `${r.semanas.diferencaPct > 0 ? '+' : ''}${r.semanas.diferencaPct}%`, rotulo: `contra a média das ${r.semanas.contra} (${numero(r.semanas.media)})` });

  const porMes = r.serie.por === 'dia' && r.serie.pontos.length > 62;
  const pontos = porMes ? agruparPorMes(r.serie.pontos) : r.serie.pontos;
  const barras = pontos.map((p) => ({
    rotulo: r.serie.por === 'hora' || porMes ? p.rotulo : p.rotulo.slice(0, 2), // por dia, só o número do dia ("01")
    valor: p.quantidade,
    texto: numero(Math.round(p.quantidade * 10) / 10),
  }));
  const linha =
    r.comparado && r.serie.por === 'dia' && !porMes && r.comparado.dias > 0
      ? { valor: r.comparado.total / r.comparado.dias, texto: `média de ${semDe(r.comparado.periodo)}: ${numero(Math.round((r.comparado.total / r.comparado.dias) * 10) / 10)} por dia` }
      : null;
  const unidadeCurta = pluralDaUnidade(r.insumo.unidade);
  return {
    cabecalho: `${o.empresa} · ${r.loja}`,
    gerado: `Gerado em ${quando(o.geradoEm)} pelo Mister, a pedido de ${String(o.pedidoPor).split(' ')[0]}`,
    titulo,
    numeros,
    grafico: {
      titulo: `${r.insumo.nome} por ${porMes ? 'mês' : r.serie.por === 'hora' ? 'hora' : 'dia'} (${unidadeCurta})`,
      barras,
      linha,
      nota: r.ateAs ? `Hoje vai até ${r.ateAs}.` : null,
    },
    deOnde: r.deOndeSaiu.map((x) => ({
      produto: x.produto,
      detalhe: x.porUnidade === 1 ? `${numero(x.vendidos)} vendidos` : `${numero(x.porUnidade)} por unidade, ${numero(x.vendidos)} vendidos`,
      valor: numero(x.quantidade),
    })),
    outros: r.outros != null ? `Outros (adicionais, outros produtos, a embalagem do delivery): ${numero(r.outros)}` : null,
    fonte: `Fonte: ${FONTE_DO_RELATORIO}`,
  };
}

/** O nome do arquivo: "carne-56-g-2026-11-17.pdf" (sem acento nem espaço). */
export function nomeDoPdfDoInsumo(r: Pick<RelatorioDoInsumo, 'insumo'>, de: string, ate: string): string {
  const base = String(r.insumo.nome ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'insumo'}-${de === ate ? de : `${de}-a-${ate}`}.pdf`;
}

export function gerarPdfDoInsumo(p: PlanoDoPdfDoInsumo, titulo = 'relatorio.pdf'): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: titulo, Author: 'Regem · Mister' } });
  const pedacos: Buffer[] = [];
  doc.on('data', (c) => pedacos.push(c as Buffer));
  const pronto = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(pedacos))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  let y = 48;

  // O cabeçalho: REGEM, a empresa e a loja, e quem pediu.
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(11).text('REGEM', L, y, { characterSpacing: 2 });
  doc.fillColor(TINTA).font('Helvetica').fontSize(11).text(p.cabecalho, L + 62, y, { width: W - 62 });
  y += 18;
  doc.fillColor(CINZA).fontSize(9).text(p.gerado, L, y, { width: W });
  y += 18;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(OURO).stroke();
  y += 14;
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(15).text(p.titulo, L, y, { width: W });
  y = doc.y + 12;

  // Os números grandes, lado a lado.
  const col = W / Math.max(1, p.numeros.length);
  let maiorY = y;
  p.numeros.forEach((n, i) => {
    const x = L + i * col;
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(18).text(n.valor, x, y, { width: col - 12 });
    doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(n.rotulo, x, doc.y + 2, { width: col - 12 });
    maiorY = Math.max(maiorY, doc.y);
  });
  y = maiorY + 18;

  // O gráfico de barras: o valor escrito em cima de cada barra (até 31), o rótulo embaixo; a linha da média, tracejada.
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10).text(p.grafico.titulo, L, y, { width: W });
  y = doc.y + 8;
  const altura = 170;
  const base = y + altura;
  const maior = Math.max(1, ...p.grafico.barras.map((b) => b.valor), p.grafico.linha?.valor ?? 0);
  const n = Math.max(1, p.grafico.barras.length);
  const passo = W / n;
  const larg = Math.max(2, Math.min(36, passo * 0.68));
  doc.moveTo(L, base).lineTo(R, base).lineWidth(0.8).strokeColor(LINHA).stroke();
  p.grafico.barras.forEach((b, i) => {
    const h = (b.valor / maior) * (altura - 16);
    const x = L + i * passo + (passo - larg) / 2;
    if (h > 0) doc.rect(x, base - h, larg, h).fillColor(OURO).fill();
    if (n <= 31) doc.fillColor(TINTA).font('Helvetica').fontSize(n > 20 ? 6 : 8).text(b.texto, x - 8, base - h - 10, { width: larg + 16, align: 'center' });
    if (n <= 31 || i % Math.ceil(n / 31) === 0) doc.fillColor(CINZA).font('Helvetica').fontSize(n > 20 ? 6 : 8).text(b.rotulo, x - 8, base + 4, { width: larg + 16, align: 'center' });
  });
  if (p.grafico.linha) {
    const ly = base - (p.grafico.linha.valor / maior) * (altura - 16);
    doc.moveTo(L, ly).lineTo(R, ly).lineWidth(1).dash(4, { space: 3 }).strokeColor(TINTA).stroke().undash();
    doc.fillColor(TINTA).font('Helvetica').fontSize(8).text(p.grafico.linha.texto, L, ly - 11, { width: W, align: 'right' });
  }
  y = base + 18;
  if (p.grafico.nota) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(p.grafico.nota, L, y, { width: W });
    y = doc.y + 4;
  }

  // De onde saiu: cada produto, o detalhe e quanto usou.
  y += 10;
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11).text('De onde saiu', L, y, { width: W });
  y = doc.y + 6;
  if (!p.deOnde.length) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(10).text('Nenhuma venda deste insumo no período.', L, y, { width: W });
    y = doc.y + 6;
  }
  for (const d of p.deOnde) {
    doc.fillColor(TINTA).font('Helvetica').fontSize(10).text(d.produto, L, y, { width: W * 0.45 });
    doc.fillColor(CINZA).fontSize(9).text(d.detalhe, L + W * 0.45, y + 1, { width: W * 0.35 });
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(10).text(d.valor, L + W * 0.8, y, { width: W * 0.2, align: 'right' });
    y = Math.max(doc.y, y + 14) + 4;
    doc.moveTo(L, y - 2).lineTo(R, y - 2).lineWidth(0.5).strokeColor(LINHA).stroke();
  }
  if (p.outros) {
    doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(p.outros, L, y + 2, { width: W });
    y = doc.y + 4;
  }

  doc.fillColor(CINZA).font('Helvetica').fontSize(8).text(p.fonte, L, Math.max(y + 16, doc.page.height - 90), { width: W });
  // Uma página: o desenho cabe em A4 (o "de onde saiu" tem no máximo 6 linhas).
  doc.end();
  return pronto;
}
