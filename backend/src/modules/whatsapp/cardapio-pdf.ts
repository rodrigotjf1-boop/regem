// pdfkit é CommonJS (`module.exports = PDFDocument`). Com o tsconfig do projeto
// (sem esModuleInterop), `import PDFDocument from 'pdfkit'` vira `pdfkit_1.default`
// (undefined) em runtime — mesmo caso do stripe. Por isso o import por require.
import PDFDocument = require('pdfkit');

/* eslint-disable @typescript-eslint/no-explicit-any */
// Gera um PDF resumido do cardápio para enviar ao cliente pelo WhatsApp.
// Formatação profissional: cabeçalho com logo + nome da empresa, itens agrupados
// por categoria, cada um com foto (miniatura), nome, resumo da descrição e preço.

export type CardapioPdfLoja = { nome: string; logoUrl?: string | null };
export type CardapioPdfItem = {
  nome: string;
  descricao?: string | null;
  precoVenda?: number | string | null;
  precoPromocional?: number | string | null;
  imagemUrl?: string | null;
};
export type CardapioPdfCategoria = { nome: string; itens: CardapioPdfItem[] };

const OURO = '#E2A340';
const TINTA = '#0F2230';
const CINZA = '#6B7A88';

const brl = (v: any) =>
  Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Baixa uma imagem e devolve o buffer (ou null se falhar). Timeout curto para não
// travar a geração por causa de uma foto lenta.
async function baixarImagem(url?: string | null): Promise<Buffer | null> {
  if (!url) return null;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') ?? '';
    if (!/image\/(png|jpe?g|webp)/i.test(ct)) return null; // pdfkit só PNG/JPEG
    if (/webp/i.test(ct)) return null; // pdfkit não lê webp
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function resumo(txt?: string | null, max = 90): string {
  const s = String(txt ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export async function gerarCardapioPdf(
  loja: CardapioPdfLoja,
  categorias: CardapioPdfCategoria[],
): Promise<Buffer> {
  // Pré-baixa as imagens em paralelo (logo + fotos) — mais rápido que baixar
  // durante o desenho, e falha graciosa (item sem foto só não mostra a miniatura).
  const logoBuf = await baixarImagem(loja.logoUrl);
  const fotos = new Map<string, Buffer | null>();
  await Promise.all(
    categorias.flatMap((c) =>
      c.itens.map(async (it) => {
        if (it.imagemUrl && !fotos.has(it.imagemUrl))
          fotos.set(it.imagemUrl, await baixarImagem(it.imagemUrl));
      }),
    ),
  );

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c as Buffer));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  const L = doc.page.margins.left;
  const R = doc.page.width - doc.page.margins.right;
  const W = R - L;

  // ===== Cabeçalho =====
  let y = 40;
  if (logoBuf) {
    try {
      doc.image(logoBuf, L, y, { fit: [56, 56] });
    } catch {
      /* logo inválida: ignora */
    }
  }
  const headX = logoBuf ? L + 68 : L;
  doc
    .fillColor(TINTA)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text(loja.nome || 'Cardápio', headX, y + 6, { width: R - headX });
  doc.fillColor(OURO).font('Helvetica').fontSize(11).text('Cardápio', headX, y + 34);
  y += 68;
  doc.moveTo(L, y).lineTo(R, y).lineWidth(2).strokeColor(OURO).stroke();
  y += 16;

  // ===== Categorias e itens =====
  const alturaItem = 58; // linha de item (miniatura 48 + respiro)
  const garantirEspaco = (h: number) => {
    if (y + h > doc.page.height - 50) {
      doc.addPage();
      y = 40;
    }
  };

  for (const cat of categorias) {
    if (!cat.itens.length) continue;
    garantirEspaco(30 + alturaItem);
    doc
      .fillColor(TINTA)
      .font('Helvetica-Bold')
      .fontSize(14)
      .text(cat.nome.toUpperCase(), L, y);
    y += 22;

    for (const it of cat.itens) {
      garantirEspaco(alturaItem);
      const foto = it.imagemUrl ? fotos.get(it.imagemUrl) : null;
      const textoX = foto ? L + 60 : L;
      const textoW = R - textoX - 70; // reserva a coluna do preço à direita

      if (foto) {
        try {
          doc.save();
          doc.roundedRect(L, y, 48, 48, 6).clip();
          doc.image(foto, L, y, { fit: [48, 48], align: 'center', valign: 'center' });
          doc.restore();
        } catch {
          /* foto inválida: segue sem */
        }
      }

      doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11.5).text(it.nome, textoX, y + 2, { width: textoW });
      const desc = resumo(it.descricao);
      if (desc)
        doc.fillColor(CINZA).font('Helvetica').fontSize(9).text(desc, textoX, doc.y, { width: textoW });

      // Preço (com promoção riscando o de/por), alinhado à direita da linha.
      const temPromo =
        it.precoPromocional != null && Number(it.precoPromocional) > 0 &&
        Number(it.precoPromocional) < Number(it.precoVenda);
      const precoY = y + 4;
      if (temPromo) {
        doc.fillColor(CINZA).font('Helvetica').fontSize(8)
          .text(brl(it.precoVenda), R - 70, precoY - 9, { width: 70, align: 'right' });
        doc.fillColor(OURO).font('Helvetica-Bold').fontSize(12)
          .text(brl(it.precoPromocional), R - 70, precoY + 1, { width: 70, align: 'right' });
      } else {
        doc.fillColor(OURO).font('Helvetica-Bold').fontSize(12)
          .text(brl(it.precoVenda), R - 70, precoY, { width: 70, align: 'right' });
      }

      y += alturaItem;
      doc.moveTo(L, y - 8).lineTo(R, y - 8).lineWidth(0.5).strokeColor('#E4E9EE').stroke();
    }
    y += 8;
  }

  // Rodapé em todas as páginas.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    doc
      .fillColor(CINZA)
      .font('Helvetica')
      .fontSize(8)
      .text(
        `${loja.nome} · Cardápio gerado pelo Regem`,
        L,
        doc.page.height - 34,
        { width: W, align: 'center' },
      );
  }

  doc.end();
  return done;
}
