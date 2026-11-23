import { semAcento, type Situacao } from '@/components/ui/lista';

// NOTÍCIAS DO RAMO (fase N1; protótipo `mockups/regem-noticias-do-ramo.html`). O que a tela calcula e formata: os filtros
// e as datas. O dia vem no fuso da loja; a notícia chega com a hora em UTC.

export type NoticiaDoRamo = {
  id: string;
  titulo: string;
  link: string;
  categoria: string;
  categoriaNome: string;
  publicadoEm: string;
  emDiscussao: boolean;
  aviso: string | null;
  credito: string;
};
export type IndicadorDoRamo = {
  id: string;
  nome: string;
  valor: number;
  unidade: string;
  referencia: string;
  acumulado12Meses: number | null;
  mudou: boolean;
  credito: string;
};
export type BoletimDoRamo = {
  dia: string;
  mensagem: string | null;
  indicadores: IndicadorDoRamo[];
  destaques: NoticiaDoRamo[];
  novidades: NoticiaDoRamo[];
  mais: NoticiaDoRamo[];
};
export type RespostaDoBoletim = { semNuvem: boolean; dia: string | null; dias: string[]; boletim: BoletimDoRamo | null };

const DE_NOVIDADE = new Set(['tendencias', 'tecnologia', 'plataformas']);
const ORDEM_DOS_ASSUNTOS = ['impostos', 'trabalho', 'governo', 'economia'];

export const todasAsNoticias = (b: BoletimDoRamo): NoticiaDoRamo[] => [...b.destaques, ...b.novidades, ...b.mais];

/** As fichas de filtro: um assunto por categoria que veio no dia, as novidades juntas e o que ainda está em discussão. */
export function situacoesDoBoletim(lista: NoticiaDoRamo[]): Situacao<NoticiaDoRamo>[] {
  const fichas: Situacao<NoticiaDoRamo>[] = [];
  for (const c of ORDEM_DOS_ASSUNTOS) {
    const uma = lista.find((n) => n.categoria === c);
    if (uma) fichas.push({ rotulo: uma.categoriaNome, filtro: (n) => n.categoria === c });
  }
  if (lista.some((n) => DE_NOVIDADE.has(n.categoria))) fichas.push({ rotulo: 'Novidades e tendências', filtro: (n) => DE_NOVIDADE.has(n.categoria) });
  if (lista.some((n) => n.emDiscussao)) fichas.push({ rotulo: 'Em discussão', filtro: (n) => n.emDiscussao, tom: 'aviso' });
  return fichas;
}

export const passaNaBusca = (n: NoticiaDoRamo, termo: string): boolean => {
  const t = semAcento(termo.trim());
  return !t || semAcento(`${n.titulo} ${n.credito} ${n.categoriaNome}`).includes(t);
};

/** "dom, 23/11/2026". O meio-dia em UTC não muda de dia em nenhum fuso. */
export function diaPorExtenso(dia: string): string {
  return new Date(`${dia}T12:00:00Z`)
    .toLocaleDateString('pt-BR', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })
    .replace('.,', ',');
}

/** "20/11 11:05", na hora da loja. */
export const quandoPublicou = (iso: string): string =>
  new Date(iso)
    .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(', ', ' ');

const numero = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const valorDoIndicador = (i: IndicadorDoRamo): string => (i.unidade.startsWith('%') ? `${numero(i.valor)}%` : `${numero(i.valor)} ${i.unidade}`);

const referenciaCurta = (r: string): string => {
  if (/^\d{4}-\d{2}$/.test(r)) return `${r.slice(5)}/${r.slice(0, 4)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(r)) return `${r.slice(8)}/${r.slice(5, 7)}`;
  return r;
};

/** "no mês · 10/2026 · 12 meses: 5,68%". */
export const detalheDoIndicador = (i: IndicadorDoRamo): string =>
  [i.unidade.replace(/^%\s*/, ''), referenciaCurta(i.referencia), i.acumulado12Meses !== null ? `12 meses: ${numero(i.acumulado12Meses)}%` : null]
    .filter(Boolean)
    .join(' · ');
