// pdfkit é CommonJS — mesmo caso do cardapio-pdf.ts (require por causa do tsconfig
// sem esModuleInterop). Gera o "espelho de ponto" mensal CONSOLIDADO (todos os
// colaboradores) para encaminhar ao RH. Texto puro (sem imagens) — leve e rápido.
import PDFDocument = require('pdfkit');

/* eslint-disable @typescript-eslint/no-explicit-any */

const OURO = '#E2A340';
const TINTA = '#0F2230';
const CINZA = '#6B7A88';

const MESES = [
  '', 'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];
const DIAS_SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const TIPO_ABREV: Record<string, string> = {
  entrada: 'ent',
  saida: 'saí',
  intervalo_inicio: 'int↓',
  intervalo_fim: 'int↑',
};

function fmtMin(min: number) {
  const s = min < 0 ? '-' : '';
  const a = Math.abs(Math.round(min));
  return `${s}${Math.floor(a / 60)}h${String(a % 60).padStart(2, '0')}`;
}
function diaLabel(data: string) {
  const [y, m, d] = data.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} ${DIAS_SEM[wd]}`;
}
function horaBr(iso: string) {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export type EspelhoPdfColaborador = {
  nome: string;
  matricula?: string | null;
  funcao?: string | null;
  espelho: any; // saída de PontoService.espelho()
};
export type EspelhoPdfDados = {
  empresa: string;
  competencia: string; // YYYY-MM-01
  colaboradores: EspelhoPdfColaborador[];
};

// Retorna o Buffer do PDF do espelho de ponto mensal (todos os colaboradores).
export function gerarEspelhoPontoPdf(dados: EspelhoPdfDados): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) =>
    doc.on('end', () => resolve(Buffer.concat(chunks))),
  );

  const [ano, mes] = dados.competencia.split('-');
  const larg = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const x0 = doc.page.margins.left;

  // Cabeçalho do documento.
  doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(16).text(dados.empresa, { continued: false });
  doc.moveDown(0.2);
  doc.fillColor(OURO).fontSize(12).text(`Espelho de ponto · ${MESES[Number(mes)]}/${ano}`);
  doc.fillColor(CINZA).font('Helvetica').fontSize(8)
    .text(`Gerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · gestão de jornada (Portaria 671) — não substitui REP-P homologado.`);
  doc.moveDown(0.6);

  const linhaSep = () => {
    doc.moveTo(x0, doc.y).lineTo(x0 + larg, doc.y).strokeColor('#E2E8F0').lineWidth(1).stroke();
    doc.moveDown(0.4);
  };
  linhaSep();

  const garantirEspaco = (h: number) => {
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
  };

  for (const c of dados.colaboradores) {
    garantirEspaco(90);
    // Cabeçalho do colaborador.
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(11)
      .text(c.nome + (c.funcao ? `  ·  ${c.funcao}` : '') + (c.matricula ? `  ·  mat. ${c.matricula}` : ''));
    const e = c.espelho ?? {};
    doc.font('Helvetica').fontSize(8).fillColor(CINZA).text(
      `Trabalhado ${fmtMin(e.totalTrabalhadoMin || 0)}  ·  Esperado ${fmtMin(e.totalEsperadoMin || 0)}  ·  Saldo ${fmtMin(e.saldoMin || 0)}  ·  Extra ${fmtMin(e.totalExtraMin || 0)}  ·  Noturno ${fmtMin(e.totalNoturnoMin || 0)}`,
    );
    doc.moveDown(0.3);

    const dias: any[] = Array.isArray(e.dias) ? e.dias : [];
    if (!dias.length) {
      doc.font('Helvetica-Oblique').fontSize(8).fillColor(CINZA).text('Sem registros no período.');
      doc.moveDown(0.6);
      continue;
    }
    // Cabeçalho da tabela.
    const cols = [
      { t: 'Dia', w: 70 },
      { t: 'Esper.', w: 44 },
      { t: 'Trab.', w: 44 },
      { t: 'Saldo', w: 44 },
      { t: 'Marcações / ajustes', w: larg - 202 },
    ];
    const header = () => {
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(TINTA);
      let x = x0;
      for (const col of cols) {
        doc.text(col.t, x, doc.y, { width: col.w, continued: false });
        x += col.w;
      }
      doc.moveUp(1);
      doc.moveDown(0.2);
    };
    header();
    doc.font('Helvetica').fontSize(7.5);
    for (const d of dias) {
      garantirEspaco(16);
      const marc = (d.marcacoes ?? [])
        .map((m: any) => `${horaBr(m.hora)}${TIPO_ABREV[m.tipo] ? ` ${TIPO_ABREV[m.tipo]}` : ''}${m.desconsiderada ? ' (x)' : ''}`)
        .join('  ');
      const ajs = (d.ajustes ?? [])
        .map((a: any) => `[${a.tipo}${a.justificativa ? `: ${a.justificativa}` : ''}${a.atestadoRef ? ' +anexo' : ''}]`)
        .join(' ');
      const yLinha = doc.y;
      const cells = [
        diaLabel(d.data),
        fmtMin(d.esperadoMin || 0),
        fmtMin(d.trabalhadoMin || 0),
        fmtMin(d.saldoMin || 0),
        [marc, ajs].filter(Boolean).join('   ') || '—',
      ];
      let x = x0;
      doc.fillColor((d.saldoMin ?? 0) < 0 ? '#B4232B' : '#334155');
      cells.forEach((txt, i) => {
        doc.text(String(txt), x, yLinha, { width: cols[i].w });
        x += cols[i].w;
      });
      // Alinha o cursor ao final da célula mais alta (a de marcações pode quebrar).
      const alturaMarc = doc.heightOfString(String(cells[4]), { width: cols[4].w });
      doc.y = yLinha + Math.max(11, alturaMarc);
    }
    doc.moveDown(0.6);
    linhaSep();
  }

  // Rodapé de assinaturas.
  garantirEspaco(60);
  doc.moveDown(1);
  doc.fillColor(TINTA).font('Helvetica').fontSize(9);
  const meia = larg / 2;
  const yAss = doc.y + 24;
  doc.moveTo(x0, yAss).lineTo(x0 + meia - 20, yAss).strokeColor('#94A3B8').stroke();
  doc.moveTo(x0 + meia + 20, yAss).lineTo(x0 + larg, yAss).stroke();
  doc.text('Responsável RH', x0, yAss + 4, { width: meia - 20, align: 'center' });
  doc.text('Diretoria', x0 + meia + 20, yAss + 4, { width: meia - 20, align: 'center' });

  doc.end();
  return done;
}
