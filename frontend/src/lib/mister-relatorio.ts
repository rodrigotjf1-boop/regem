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

/** O que a página do link para encaminhar recebe (mig 443): a foto do relatório, sem login. */
export type VistaDoRelatorioPublico = {
  empresa: string;
  plano: PlanoDoRelatorio;
  nomeDoPdf: string;
  comVenda: boolean;
  valeAte: string;
  /** dd/mm, no relógio da loja. */
  valeAteDia: string;
};

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
