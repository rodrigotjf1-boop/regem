// R3 — TRADUTOR: catálogo do Regem → formato que o totem GoGeM já consome.
//
// Por que existe: o app do totem fala UM contrato (o do GoGeM) e não muda ao entrar no
// modo edge. Quem se adapta é o servidor. Este arquivo é a única peça que conhece os dois
// formatos, e é PURO (sem banco, sem Nest) para ser testável linha a linha.
//
// A forma de saída foi conferida contra o consumidor real (kiosk,
// `data/catalog/catalog_models.dart`): `MenuSnapshot.fromPublicadoJson` lê
// `{versao, snapshot:{categorias,produtos}}`, e cada modelo tem o seu `fromJson`.
import { paraCentavos } from '../../util/dinheiro';

/** Canais que, pausados no Regem, tiram o item do totem. */
const CANAIS_DO_TOTEM = ['gogem', 'totem'];

export type CatalogoRegem = {
  geradoEm?: string;
  categorias: any[];
  produtos: any[];
};

export type SnapshotGogem = {
  versao: number;
  snapshot: {
    categorias: {
      id: string;
      nome: string;
      ordem: number;
      imagemUrl: string | null;
      emoji: string | null;
      cor: string | null;
    }[];
    produtos: {
      id: string;
      categoriaId: string | null;
      nome: string;
      descricao: string;
      precoCentavos: number;
      disponivel: boolean;
      imagemUrl: string | null;
      selo: string | null;
      externalRefs: { sistema: string; codigo_pdv: string }[];
      upsell: string[];
      grupos: {
        id: string;
        nome: string;
        min: number;
        max: number;
        obrigatorio: boolean;
        opcoes: {
          id: string;
          nome: string;
          precoCentavosDelta: number;
          imagemUrl: string | null;
          externalRefs: { sistema: string; codigo_pdv: string }[];
        }[];
      }[];
    }[];
  };
  aparencia: unknown;
};

/** De-para do Regem no formato que o `ExternalRef.listFrom` do totem lê. */
function refDoRegem(codigo: unknown) {
  const c = (codigo ?? '').toString().trim();
  return c ? [{ sistema: 'regem', codigo_pdv: c }] : [];
}

/**
 * Monta o snapshot do totem a partir do catálogo do Regem.
 *
 * Regras de recorte (e o motivo de cada uma):
 *  • produto SEM `codigo` (de-para PDV) fica de fora — a venda volta por `codigoPdv`;
 *    sem ele o cliente montaria um pedido que o Regem recusaria na hora de lançar;
 *  • produto inativo ou fora do balcão fica de fora (o totem é autoatendimento de balcão);
 *  • esgotado ou com o canal do totem pausado ENTRA, mas como `disponivel:false` — o app
 *    mostra esgotado em vez de sumir com o item do cardápio;
 *  • categoria inativa (e a que sobrou sem produto) fica de fora.
 */
export function catalogoParaGogem(
  catalogo: CatalogoRegem,
  aparencia: unknown,
  versao: number,
): SnapshotGogem {
  const produtos = (catalogo.produtos ?? [])
    .filter((p) => {
      const codigo = (p?.codigo ?? '').toString().trim();
      return !!codigo && p?.ativo !== false && p?.disponivelBalcao !== false;
    })
    .map((p) => {
      const pausados = Array.isArray(p.canaisPausados)
        ? p.canaisPausados.map((c: unknown) => String(c).toLowerCase())
        : [];
      const disponivel =
        p.pausadoEstoque !== true &&
        !pausados.some((c: string) => CANAIS_DO_TOTEM.includes(c));
      return {
        id: String(p.id),
        categoriaId: p.categoriaId ? String(p.categoriaId) : null,
        nome: String(p.nome ?? ''),
        descricao: String(p.descricao ?? ''),
        precoCentavos: paraCentavos(p.precoVenda),
        disponivel,
        imagemUrl: p.imagem ? String(p.imagem) : null,
        selo: null,
        externalRefs: refDoRegem(p.codigo),
        upsell: [] as string[],
        grupos: (p.grupos ?? []).map((g: any) => {
          const opcoes = (g.opcoes ?? []).map((o: any) => ({
            id: String(o.id),
            nome: String(o.nome ?? ''),
            precoCentavosDelta: paraCentavos(o.precoDelta),
            imagemUrl: null,
            externalRefs: refDoRegem(o.codigoPdv),
          }));
          return {
            id: String(g.id),
            nome: String(g.nome ?? ''),
            min: Number(g.min) || 0,
            // `max` nulo no Regem = sem limite. O totem espera um inteiro, então o teto
            // real é o número de opções do grupo (nunca dá para escolher mais que isso).
            max: g.max == null ? opcoes.length || 1 : Number(g.max),
            obrigatorio: g.obrigatorio === true,
            opcoes,
          };
        }),
      };
    });

  const comProduto = new Set(produtos.map((p) => p.categoriaId).filter(Boolean));
  const categorias = (catalogo.categorias ?? [])
    .filter((c) => c?.ativo !== false && comProduto.has(String(c.id)))
    .map((c) => ({
      id: String(c.id),
      nome: String(c.nome ?? ''),
      ordem: Number(c.ordem) || 0,
      imagemUrl: c.imagemRef ? String(c.imagemRef) : null,
      // O Regem não tem emoji nem cor por categoria; o totem trata ausente como padrão.
      emoji: null,
      cor: null,
    }))
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome));

  return { versao, snapshot: { categorias, produtos }, aparencia };
}
