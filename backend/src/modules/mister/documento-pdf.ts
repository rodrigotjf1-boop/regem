// pdfkit é CommonJS: o import por require (o mesmo do `cardapio-pdf.ts`; sem esModuleInterop, o default vira undefined).
import PDFDocument = require('pdfkit');
import { barrasItf } from '../../common/codigo-de-barras-itf';
import { recebedorDoPix } from '../../common/documento-por-foto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PDF DO BOLETO LANÇADO PELO MISTER (M3a parte 4b; versão 3 do protótipo, aba "Arquivos e links" › "PDF do boleto
// lançado"): o que foi lido e de onde veio cada campo (código, IA, conversa, cadastro), a linha digitável e o CÓDIGO DE
// BARRAS desenhado (ITF, para pagar pela câmera do aplicativo do banco com o PDF aberto no computador). O Mister não
// paga: entrega o que é preciso para pagar no banco. Tudo do código do Regem, com os números da loja — nada da IA.

export type OrigemNoPdf = 'codigo' | 'ia' | 'pessoa' | 'cadastro' | null;
export interface PdfDoDocumento {
  empresa: string;
  /** Primeiro nome de quem mandou a foto. */
  quem: string | null;
  /** Quando o documento chegou (ISO). */
  criadoEm: string;
  tipo: 'boleto' | 'conta';
  beneficiario: string | null;
  fornecedor: string | null;
  valorCentavos: number | null;
  vencimento: string | null;
  linhaDigitavel: string | null;
  codigoDeBarras: string | null;
  /** O Pix copia e cola impresso no boleto (CRC conferido), quando tinha. */
  pix?: string | null;
  origem: { valor: OrigemNoPdf; vencimento: OrigemNoPdf };
  /** A situação da conta a pagar, como a tela mostra (lançado, pago, …). */
  situacao: string;
}

const OURO = '#E2A340';
const TINTA = '#0F2230';
const CINZA = '#5B6B78';
const NOME_DA_ORIGEM: Record<string, string> = { codigo: 'código', ia: 'IA', pessoa: 'conversa', cadastro: 'cadastro' };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataLonga = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}, ${DIAS[new Date(`${iso}T12:00:00Z`).getUTCDay()]}`;
const quando = (iso: string) => {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const hora = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  return `${dia}, ${hora}`;
};

/** O nome do arquivo: "boleto-distribuidora-sabor-2026-11-25.pdf" (sem acento nem espaço). */
export function nomeDoPdf(d: Pick<PdfDoDocumento, 'tipo' | 'beneficiario' | 'vencimento'>): string {
  const base = String(d.beneficiario ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return [d.tipo === 'conta' ? 'conta' : 'boleto', base || null, d.vencimento].filter(Boolean).join('-') + '.pdf';
}

export function gerarPdfDoDocumento(d: PdfDoDocumento): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: nomeDoPdf(d), Author: 'Regem · Mister' } });
  const pedacos: Buffer[] = [];
  doc.on('data', (c) => pedacos.push(c as Buffer));
  const pronto = new Promise<Buffer>((ok) => doc.on('end', () => ok(Buffer.concat(pedacos))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;
  let y = 48;

  // O cabeçalho: REGEM, a empresa e de onde veio.
  doc.fillColor(OURO).font('Helvetica-Bold').fontSize(11).text('REGEM', L, y, { characterSpacing: 2 });
  doc.fillColor(TINTA).font('Helvetica').fontSize(11).text(`${d.empresa} · contas a pagar`, L + 62, y, { width: W - 62 });
  y += 18;
  doc
    .fillColor(CINZA)
    .fontSize(9)
    .text(`Lançado por foto em ${quando(d.criadoEm)}${d.quem ? ` por ${d.quem}` : ''}, pelo Mister. Situação: ${d.situacao}.`, L, y, { width: W });
  y += 22;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(1.5).strokeColor(OURO).stroke();
  y += 16;

  // O título.
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(`${d.tipo === 'conta' ? 'Conta' : 'Boleto'} · ${d.beneficiario ?? 'sem nome lido'}`, L, y, { width: W });
  y = doc.y + 14;

  // Os campos, cada um com a origem.
  const campo = (rotulo: string, valor: string, origem: OrigemNoPdf, mono = false) => {
    doc.fillColor(CINZA).font('Helvetica').fontSize(10).text(rotulo, L, y + 2, { width: 130 });
    doc
      .fillColor(TINTA)
      .font(mono ? 'Courier' : 'Helvetica-Bold')
      .fontSize(mono ? 10 : 12)
      .text(valor, L + 135, y, { width: W - 135 - 70 });
    const fim = doc.y;
    if (origem && NOME_DA_ORIGEM[origem]) {
      const t = NOME_DA_ORIGEM[origem];
      doc.font('Helvetica-Bold').fontSize(8);
      const lw = doc.widthOfString(t) + 12;
      doc.roundedRect(R - lw, y + 1, lw, 14, 7).fillColor('#EDF0F4').fill();
      doc.fillColor(CINZA).text(t, R - lw, y + 4, { width: lw, align: 'center' });
    }
    y = Math.max(fim, y + 16) + 8;
    doc.moveTo(L, y - 4).lineTo(R, y - 4).lineWidth(0.5).strokeColor('#D7DDE3').stroke();
  };
  campo('Valor', d.valorCentavos != null ? reais(d.valorCentavos) : 'não lido', d.origem.valor);
  campo('Vencimento', d.vencimento ? dataLonga(d.vencimento) : 'não lido', d.origem.vencimento);
  campo('Beneficiário', d.beneficiario ?? 'não lido', d.beneficiario ? 'ia' : null);
  campo('Fornecedor no Regem', d.fornecedor ?? 'não cadastrado', d.fornecedor ? 'cadastro' : null);
  if (d.linhaDigitavel) campo('Linha digitável', d.linhaDigitavel, 'codigo', true);
  // O Pix impresso no boleto, transcrito pela IA e conferido pelo CRC16 (o QR a IA não lê).
  if (d.pix) {
    // Rodada 7, MIS-F-07: para quem vai o Pix, ao lado do código.
    if (recebedorDoPix(d.pix)) campo('Pix para', recebedorDoPix(d.pix)!, 'ia');
    campo('Pix copia e cola', d.pix, 'ia', true);
  }

  // O código de barras (ITF), desenhado: estreito = 1 módulo, largo = 3.
  const barras = d.codigoDeBarras ? barrasItf(d.codigoDeBarras) : null;
  if (barras) {
    y += 10;
    const total = barras.reduce((s, x) => s + x, 0);
    const modulo = Math.min(0.9, W / total);
    const altura = 46;
    let x = L;
    barras.forEach((largura, i) => {
      if (i % 2 === 0) doc.rect(x, y, largura * modulo, altura).fillColor('#000000').fill();
      x += largura * modulo;
    });
    y += altura + 6;
    doc.fillColor(CINZA).font('Courier').fontSize(8).text(d.codigoDeBarras!, L, y, { width: W });
    y = doc.y + 12;
  }

  // A legenda.
  doc
    .fillColor(CINZA)
    .font('Helvetica')
    .fontSize(8.5)
    .text(
      '"código" = lido do código de barras, sem IA, conferido pelo dígito verificador; "IA" = lido da foto pela IA; ' +
        '"conversa" = dito ao Mister; "cadastro" = do cadastro do Regem. O Mister não paga: pague no banco com a linha ' +
        'digitável ou o código de barras e toque em "Já paguei" na conversa.',
      L,
      y,
      { width: W },
    );
  doc.end();
  return pronto;
}
