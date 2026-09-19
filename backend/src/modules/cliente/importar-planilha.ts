// Importação de clientes por PLANILHA (CSV) — hoje a base exportada da Anota Aí
// (Relatórios → Clientes → Exportar → CSV), nas três abas: potenciais, ativos e inativos.
//
// Colunas da Anota Aí (conferidas nas três exportações, set/2026):
//   Nome do Cliente · Número Telefone · Número Whatsapp · Quantidade de Pedidos ·
//   Dias de Inatividade (só em ativos/inativos)
// As colunas são achadas pelo TÍTULO (sem acento, sem caixa), não pela posição.
//
// Regras:
//  • Identidade = "Número Telefone". A coluna WhatsApp às vezes vem SEM o 9 (ex.: telefone
//    75 98370-8443, WhatsApp 557583708443) — usá-la faria o mesmo cliente não casar com o
//    que já está no Regem. Ela só é usada quando o telefone está vazio/inválido.
//  • Nome que não é nome ("cliente", ".", vazio, só símbolo/emoji) entra VAZIO — a campanha
//    usa saudação genérica em vez de "Olá cliente".

export type SegmentoImport = 'ativo' | 'inativo' | 'potencial';

export type LinhaImport = {
  nome: string;
  telefoneRaw: string;
  whatsappRaw: string;
  pedidos: number | null;
  diasInatividade: number | null;
};

const semAcento = (s: string) =>
  s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

// Divide uma linha CSV respeitando aspas ("a;b" e "" como aspas literal).
function dividir(linha: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') aspas = false;
      else cur += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

// Quebra em linhas sem cortar campo entre aspas que contenha quebra de linha.
function linhas(texto: string): string[] {
  const out: string[] = [];
  let cur = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"') aspas = !aspas;
    if (!aspas && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.trim() !== '');
}

const num = (s: string | undefined): number | null => {
  const d = String(s ?? '').replace(/[^\d-]/g, '');
  if (!d) return null;
  const n = Number(d);
  return Number.isFinite(n) ? n : null;
};

export function parseCsvClientes(texto: string): { linhas: LinhaImport[]; colunas: string[] } {
  const t = String(texto ?? '').replace(/^\uFEFF/, '');
  const ls = linhas(t);
  if (!ls.length) throw new Error('Arquivo vazio.');
  const cab = ls[0];
  const sep = (cab.match(/;/g)?.length ?? 0) > (cab.match(/,/g)?.length ?? 0) ? ';' : cab.includes('\t') && !cab.includes(',') ? '\t' : ',';
  return mapearTabela(ls.map((l) => dividir(l, sep)));
}

// Tabela j\u00E1 em c\u00E9lulas (CSV dividido ou Excel lido) \u2192 linhas de cliente. 1\u00AA linha = t\u00EDtulos.
export function mapearTabela(tabela: string[][]): { linhas: LinhaImport[]; colunas: string[] } {
  const semVazias = tabela.filter((l) => l.some((c) => String(c ?? '').trim() !== ''));
  if (!semVazias.length) throw new Error('Arquivo vazio.');
  const colunas = semVazias[0].map((c) => String(c ?? '').trim());
  const ls = semVazias;
  const idx = (...alvos: string[]) => colunas.findIndex((c) => alvos.some((a) => semAcento(c).includes(a)));
  const iNome = idx('nome');
  const iTel = idx('numero telefone', 'telefone', 'celular', 'fone');
  const iWa = idx('whatsapp');
  const iPed = idx('quantidade de pedidos', 'pedidos');
  const iDias = idx('dias de inatividade', 'inatividade');
  if (iTel < 0 && iWa < 0) {
    throw new Error('Não achei a coluna de telefone. Exporte a lista de clientes em CSV (títulos na 1ª linha).');
  }
  const out: LinhaImport[] = [];
  for (const c0 of ls.slice(1)) {
    const c = c0.map((x) => String(x ?? '').trim());
    out.push({
      nome: iNome >= 0 ? c[iNome] ?? '' : '',
      telefoneRaw: iTel >= 0 && iTel !== iWa ? c[iTel] ?? '' : '',
      whatsappRaw: iWa >= 0 ? c[iWa] ?? '' : '',
      pedidos: iPed >= 0 ? num(c[iPed]) : null,
      diasInatividade: iDias >= 0 ? num(c[iDias]) : null,
    });
  }
  return { linhas: out, colunas };
}

// Nome utilizável para saudação? "cliente", ".", vazio, só símbolo/emoji/número → não.
const GENERICOS = new Set(['cliente', 'clientes', 'consumidor', 'teste', 'sem nome', 'nao informado']);
export function nomeUtil(bruto: string): string {
  const n = String(bruto ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const letras = n.replace(/[^\p{L}]/gu, '');
  if (letras.length < 2) return '';
  if (GENERICOS.has(semAcento(n))) return '';
  return n;
}

// Segmento pelo NOME DO ARQUIVO da Anota Aí ("Clientes ativos - consulta gerada em …").
export function segmentoPeloArquivo(nomeArquivo: string): SegmentoImport | null {
  const s = semAcento(nomeArquivo ?? '');
  if (s.includes('inativ')) return 'inativo';
  if (s.includes('potencia')) return 'potencial';
  if (s.includes('ativo')) return 'ativo';
  return null;
}
