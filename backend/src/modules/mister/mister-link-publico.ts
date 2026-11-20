import { dataNoFuso } from '../../common/data';
import type { PlanoDoPdfDoInsumo } from './relatorio-insumo-pdf';
import type { PlanoDoResumo } from './grafico/plano-do-resumo';

// M3c — O LINK PARA ENCAMINHAR um relatório a quem NÃO tem usuário no Regem (a contabilidade, um sócio). Versão 3 do
// protótipo `mockups/regem-mister.html`, decisão 7: "só quando o presidente pede: link só de leitura, que vale 7 dias e
// fica na auditoria". As regras puras; o serviço (`mister-link-publico.service.ts`) grava e confere.
//
// O que o link mostra é uma FOTO do relatório (o plano do PDF, como estava quando o presidente pediu): quem tem o link
// nunca lê dado vivo da loja. Só o resumo (sha256) do código fica no banco.

/** Quantos dias o link vale. */
export const VALIDADE_DO_LINK_DIAS = 7;
/** Links vivos por empresa ao mesmo tempo (um teto contra o descuido, não uma cota de uso). */
export const TETO_DE_LINKS_VIVOS = 20;

/** O código do link: 24 bytes em base64url (32 letras), como o link com PIN — noutro caminho de página. */
export const ehCodigoPublico = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9_-]{32}$/.test(c);

/** O endereço da página que abre sem login. */
export const enderecoDoLinkPublico = (baseDoApp: string, codigo: string): string => `${String(baseDoApp).replace(/\/+$/, '')}/m/r/${codigo}`;

/** dd/mm de um instante, no relógio da loja. */
export function diaMesDe(d: Date): string {
  const iso = dataNoFuso(d);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

/** O instante em que um link criado em `agora` vence. */
export const venceEm = (agora: Date): Date => new Date(agora.getTime() + VALIDADE_DO_LINK_DIAS * 86_400_000);

/** A linha que o Regem escreve no fim da resposta do Mister (o link nunca passa pela IA). */
export const linhaDoLinkNaConversa = (url: string, vence: Date): string => `Link para encaminhar (só leitura, vale até ${diaMesDe(vence)}): ${url}`;

export const TEXTOS_DO_LINK_PUBLICO = {
  /** A mesma frase para código torto, vencido, cancelado ou de quem perdeu o acesso: a página não diz qual. */
  naoVale: 'Este link não vale mais. Peça outro a quem mandou.',
  soPresidente: 'Só o presidente pede link para encaminhar a quem não tem usuário no Regem.',
  desligado: 'O link para quem não tem usuário ainda não está ligado no Regem. Dá para mandar o relatório em PDF e encaminhar o arquivo.',
  semVenda: 'Não houve venda deste insumo no período: não há o que mandar no link.',
  teto: `Sua empresa já tem ${TETO_DE_LINKS_VIVOS} links valendo. Peça para cancelar os links antigos e peça este de novo.`,
  falhou: 'Não consegui criar o link agora.',
} as const;

/** O que a página pública recebe: o relatório por insumo (M3c) ou o resumo do dia/da semana (versão 5, M5e). */
export type VistaDoLinkPublico = {
  empresa: string;
  nomeDoPdf: string;
  valeAte: string;
  valeAteDia: string;
} & (
  | {
      tipo: 'insumo';
      plano: PlanoDoPdfDoInsumo;
      /** O relatório tem venda (as barras e o "de onde saiu" aparecem). */
      comVenda: boolean;
    }
  | { tipo: 'resumo'; plano: PlanoDoResumo }
);

const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/**
 * O plano guardado tem a forma do plano do PDF? O que sai pela porta pública é só o que a página sabe desenhar: uma linha
 * com outra forma (um formato antigo, um dado torto) NÃO abre — a página diz que o link não vale.
 */
export function ehPlanoDoRelatorio(p: unknown): p is PlanoDoPdfDoInsumo {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const x = p as Record<string, any>;
  if (!texto(x.cabecalho, 600) || !texto(x.gerado, 300) || !texto(x.titulo, 600) || !texto(x.fonte, 800)) return false;
  if (x.outros !== null && !texto(x.outros, 400)) return false;
  if (!Array.isArray(x.numeros) || x.numeros.length > 12 || !x.numeros.every((n: any) => n && texto(n.valor, 80) && texto(n.rotulo, 400))) return false;
  if (!Array.isArray(x.deOnde) || x.deOnde.length > 200 || !x.deOnde.every((d: any) => d && texto(d.produto, 400) && texto(d.detalhe, 200) && texto(d.valor, 80))) return false;
  const g = x.grafico;
  if (!g || typeof g !== 'object' || !texto(g.titulo, 200)) return false;
  if (g.nota !== null && !texto(g.nota, 300)) return false;
  if (g.linha !== null && !(g.linha && Number.isFinite(g.linha.valor) && texto(g.linha.texto, 200))) return false;
  return Array.isArray(g.barras) && g.barras.length <= 400 && g.barras.every((b: any) => b && texto(b.rotulo, 40) && Number.isFinite(b.valor) && texto(b.texto, 80));
}

/** O relatório tem alguma venda no gráfico? */
export const planoTemVenda = (p: PlanoDoPdfDoInsumo): boolean => p.grafico.barras.some((b) => b.valor > 0);
