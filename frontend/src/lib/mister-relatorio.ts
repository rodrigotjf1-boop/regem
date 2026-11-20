// O RELATÓRIO POR INSUMO DO MISTER (M3c): o plano que o servidor devolve — o MESMO do PDF (os textos, os números e as
// barras já escritos). A página logada (`/mister/relatorio`) e a do link para encaminhar (`/m/r/<código>`) só o desenham.

export type PlanoDoRelatorio = {
  cabecalho: string;
  gerado: string;
  titulo: string;
  numeros: { valor: string; rotulo: string }[];
  grafico: { titulo: string; barras: { rotulo: string; valor: number; texto: string }[]; linha: { valor: number; texto: string } | null; nota: string | null };
  deOnde: { produto: string; detalhe: string; valor: string }[];
  outros: string | null;
  fonte: string;
};

// ── Versão 5, M5e: o RESUMO do dia e da semana em arquivo e no link (o mesmo plano do PDF do resumo) ──
// Os gráficos são os planos da M5d.2 (`backend/.../grafico/plano-do-grafico.ts`): colunas, participação ou horizontais.

export type BarraDoPlano = { rotulo: string; rotulo2?: string; valor: number; texto: string; anterior?: number };
export type ParteDoPlano = { nome: string; valor: number; texto: string };
export type PlanoDoGrafico = {
  forma: 'colunas' | 'participacao' | 'horizontais';
  titulo: string;
  sub: string;
  kpi: string | null;
  delta: { texto: string; tom: 'bom' | 'ruim' | 'neutro' } | null;
  barras?: BarraDoPlano[];
  partes?: ParteDoPlano[];
  legenda?: string[];
  rodape: string;
};
export type PlanoDoResumo = {
  versao: 1;
  tipo: 'resumo_dia' | 'resumo_semana';
  empresa: string;
  loja: string;
  titulo: string;
  lidoEm: string;
  numeros: { valor: string; rotulo: string; nota: string | null; tom: 'bom' | 'ruim' | 'neutro' | null }[];
  abas: { id: 'hora' | 'dias' | 'canais' | 'produtos'; nome: string; grafico: PlanoDoGrafico }[];
  atencao: { oque: string; detalhe: string; valor: string }[];
  fonte: string;
  semValores: boolean;
};

/** O que a página do link recebe (mig 443; o resumo desde a 462): a foto do relatório, sem login. */
export type VistaDoRelatorioPublico = {
  empresa: string;
  nomeDoPdf: string;
  valeAte: string;
  /** dd/mm, no relógio da loja. */
  valeAteDia: string;
} & ({ tipo: 'insumo'; plano: PlanoDoRelatorio; comVenda: boolean } | { tipo: 'resumo'; plano: PlanoDoResumo });

/** Entrega ao navegador um arquivo que veio pronto da API (o PDF), com o nome dele. */
export function baixarBlob(blob: Blob, nome: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // O navegador ainda lê o endereço depois do clique: solta um pouco depois.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
