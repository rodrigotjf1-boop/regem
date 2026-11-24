import { linkSeguro, type BoletimDoRamo } from '../pulso/pulso.regras';
import { buscarNoGuia, GUIA_DE_USO, quemAbre, type SecaoDoGuia } from './mister-guia-de-uso';
import type { ResultadoDaFerramenta } from './mister-ferramentas.service';

// O LINK PARA ABRIR NO REGEM (`abrir_no_regem`). Pedido do dono em 24/11/2026, depois de o Mister responder "por aqui eu não
// consigo puxar o link": "a ideia do acesso ao Mister do WhatsApp é o presidente ter acesso completo aos recursos Regem".
//
// A IA continua sem escrever endereço (o filtro de saída tira qualquer link do texto dela: um nome de produto ou um
// recado não consegue plantar um). Ela só diz O QUE abrir: o assunto da tela ou os ids das notícias. O ENDEREÇO sai daqui:
//   • a tela: a seção do guia de uso (a `rota` que a spec do guia confere contra o menu do `shell.tsx`), só se esta pessoa
//     abre a tela pela mesma régua da consulta `como_usar_o_regem`;
//   • a notícia: o `link` que o boletim guardou (já conferido como https na entrada, e de novo aqui), achado pelo id.
// O agente escreve as linhas no fim da resposta, depois do filtro de saída, como o "Ver no Regem" dos relatórios.

/** Um link que vai no fim da resposta: o que abre e o endereço. NÃO vai ao modelo. */
export interface LinkParaAbrir {
  rotulo: string;
  url: string;
}

/** No máximo cinco links numa resposta (as notícias de um assunto cabem; mais que isso vira lista, não resposta). */
export const LINKS_PARA_ABRIR_MAX = 5;
/** O título da notícia na linha do link, cortado. */
export const ROTULO_DO_LINK_MAX = 90;

/**
 * Relatórios › Notícias do ramo: a tela existe no menu, mas o guia ainda não tem o "como faço" dela (todo assunto do guia
 * precisa da imagem da tela feita pelos roteiros). Entra só na busca do link; a spec confere caminho, rota, permissão e
 * módulo contra a linha do menu.
 */
export const TELA_DAS_NOTICIAS: SecaoDoGuia = {
  id: 'noticias-do-ramo',
  titulo: 'Notícias do ramo: o boletim do dia',
  caminho: ['Relatórios', 'Notícias do ramo'],
  rota: '/noticias-do-ramo',
  perm: 'noticias_ramo',
  modulo: 'noticias_ramo',
  palavras: ['noticias', 'noticias do ramo', 'boletim', 'boletim do ramo', 'tendencias', 'novidades do setor'],
  passos: [],
  botoes: [],
};

/** As telas que o link acha: o guia inteiro e as que ainda não têm o "como faço". */
export const TELAS_PARA_ABRIR: SecaoDoGuia[] = [...GUIA_DE_USO, TELA_DAS_NOTICIAS];

/** Quem pede o link: se abre cada tela (a régua do menu) e se vê as notícias. */
export interface QuemPedeOLink {
  abre: (s: SecaoDoGuia) => boolean;
  veNoticias: boolean;
}

const recusa = (erro: string): ResultadoDaFerramenta => ({ ok: false, dados: { erro } });

const cortar = (t: string, max: number): string => (t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`);

/** O pedido do modelo, conferido: o assunto da tela e os ids das notícias (sem repetir, no máximo cinco). */
export function pedidoDoLink(en: Record<string, unknown>): { tela: string; noticias: string[] } | { erro: string } {
  const tela = typeof en.tela === 'string' ? en.tela.trim().slice(0, 200) : '';
  const lista = Array.isArray(en.noticias) ? en.noticias : en.noticias === undefined || en.noticias === null ? [] : null;
  if (lista === null) return { erro: 'Mande "noticias" como uma lista de ids.' };
  const ids = [...new Set(lista.map((i) => (typeof i === 'string' || typeof i === 'number' ? String(i).trim() : '')))];
  if (ids.some((i) => !/^[A-Za-z0-9_-]{1,40}$/.test(i))) return { erro: 'Os ids das notícias são os que noticias_do_ramo trouxe, como vieram.' };
  if (ids.length > LINKS_PARA_ABRIR_MAX) return { erro: `No máximo ${LINKS_PARA_ABRIR_MAX} notícias por resposta.` };
  if (!tela && !ids.length) return { erro: 'Diga a "tela" (o assunto, como a pessoa disse) ou os "noticias" (os ids que noticias_do_ramo trouxe).' };
  return { tela, noticias: ids };
}

/** As notícias das cópias do boletim, pelo id (a primeira vez que aparece, da cópia mais nova). */
function noticiasPeloId(copias: BoletimDoRamo[]): Map<string, { titulo: string; link: string }> {
  const achadas = new Map<string, { titulo: string; link: string }>();
  for (const b of copias) for (const n of [...(b.destaques ?? []), ...(b.novidades ?? []), ...(b.mais ?? [])]) if (!achadas.has(n.id)) achadas.set(n.id, n);
  return achadas;
}

/**
 * Monta a resposta de `abrir_no_regem` (sem IA, sem banco: quem chama já leu as cópias do boletim, ou passa `null` quando
 * não pediu notícia). O modelo recebe só o que vai abaixo, nunca o endereço.
 */
export function montarLinks(
  pedido: { tela: string; noticias: string[] },
  quem: QuemPedeOLink,
  base: string,
  copias: BoletimDoRamo[] | null,
): ResultadoDaFerramenta {
  const links: LinkParaAbrir[] = [];
  const vaiAbaixo: string[] = [];
  if (pedido.tela) {
    const achada = buscarNoGuia(pedido.tela, TELAS_PARA_ABRIR)[0];
    if (!achada) return recusa('Não achei essa tela no Regem. Pergunte à pessoa o nome da tela como aparece no menu, ou use como_usar_o_regem.');
    const onde = achada.caminho.join(' › ');
    if (!quem.abre(achada)) return recusa(`O perfil desta pessoa não abre ${onde}: abre ${quemAbre(achada)}.`);
    links.push({ rotulo: onde, url: `${base.replace(/\/+$/, '')}${achada.rota}` });
    vaiAbaixo.push(`a tela ${onde}`);
  }
  const naoAchei: string[] = [];
  if (pedido.noticias.length) {
    if (!quem.veNoticias) return recusa('O perfil desta pessoa no Regem não dá acesso às Notícias do ramo. Quem muda o perfil é o presidente.');
    if (!copias) return recusa('Não há boletim para o ramo desta empresa.');
    const porId = noticiasPeloId(copias);
    for (const id of pedido.noticias) {
      const n = porId.get(id);
      const url = n ? linkSeguro(n.link) : null;
      if (!n || !url) {
        naoAchei.push(id);
        continue;
      }
      if (links.length >= LINKS_PARA_ABRIR_MAX) break;
      links.push({ rotulo: cortar(n.titulo, ROTULO_DO_LINK_MAX), url });
    }
    const quantas = links.length - (pedido.tela ? 1 : 0);
    if (quantas) vaiAbaixo.push(quantas === 1 ? 'o link da notícia' : `os links de ${quantas} notícias`);
  }
  if (!links.length) return recusa('Não achei essas notícias no boletim dos últimos 30 dias. Consulte noticias_do_ramo de novo e use os ids que vierem.');
  return {
    ok: true,
    abrir: links,
    dados: {
      vaiAbaixo: vaiAbaixo.join(' e '),
      siga: 'O Regem escreve os links no fim da sua resposta. Diga em uma frase o que vai abaixo, sem escrever endereço nenhum.',
      ...(naoAchei.length ? { naoAchei: `Não achei ${naoAchei.length === 1 ? 'uma das notícias' : `${naoAchei.length} das notícias`} no boletim: diga isso.` } : {}),
    },
  };
}

/** As linhas que o agente escreve no fim da resposta: o que abre e, na linha de baixo, o endereço (o WhatsApp deixa tocar). */
export function linhasParaAbrir(links: LinkParaAbrir[]): string {
  return links
    .slice(0, LINKS_PARA_ABRIR_MAX)
    .map((l) => `🔗 ${l.rotulo}\n${l.url}`)
    .join('\n\n');
}
