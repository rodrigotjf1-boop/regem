// Nome comercial e marcas do produto do estoque (mig 311).
//
// O `nome` do produto é o da ficha técnica, da contagem e dos relatórios ("Fatia de queijo
// cheddar"). Na COMPRA aparece o nome comercial — como o produto é comprado ("Barra de queijo
// cheddar fatiado") — e, quando o produto tem duas ou mais marcas, quem gera a lista escolhe uma.
// O estoque, o custo e a ficha continuam um só: a marca só acompanha o pedido.
//
// As regras daqui espelham as do servidor (`estoque/produto-nome.ts` e `compras.service.ts`): a
// tela só não oferece o que ele recusaria.

type ComNome = { nome?: string | null; nomeComercial?: string | null } | null | undefined;
type ComMarcas = { marcas?: unknown } | null | undefined;

export const MARCAS_MAX = 20;
export const MARCA_MAX = 60;

const limpo = (t: unknown): string => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '');

/** Chave de comparação, a mesma do servidor: sem acento, minúscula, pontuação vira espaço. */
export function chaveDaMarca(t: unknown): string {
  return limpo(t)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O nome que aparece na compra: o comercial, quando o produto tem; senão o nome do produto. */
export function nomeDeCompra(i: ComNome): string {
  return limpo(i?.nomeComercial) || limpo(i?.nome);
}

/** O nome do produto (o da ficha), para vir embaixo do comercial — só quando os dois diferem. */
export function nomeDeApoio(i: ComNome): string {
  const comercial = limpo(i?.nomeComercial);
  const nome = limpo(i?.nome);
  return comercial && chaveDaMarca(comercial) !== chaveDaMarca(nome) ? nome : '';
}

/** As marcas cadastradas do produto (lista limpa; produto antigo, sem o campo, não tem nenhuma). */
export function marcasDe(i: ComMarcas): string[] {
  return Array.isArray(i?.marcas) ? (i!.marcas as unknown[]).map(limpo).filter(Boolean) : [];
}

/** Acrescenta uma marca digitada: sem vazia, sem repetida ("Marca Alfa" = "marca alfa") e no limite. */
export function juntarMarca(lista: string[], nova: string): string[] {
  const nome = limpo(nova).slice(0, MARCA_MAX).trim();
  const chave = chaveDaMarca(nome);
  if (!chave || lista.length >= MARCAS_MAX || lista.some((m) => chaveDaMarca(m) === chave)) return lista;
  return [...lista, nome];
}

/**
 * A marca que vale para a linha da compra: sem marca cadastrada, nenhuma; com uma só, ela; com
 * duas ou mais, a escolhida — se for uma das cadastradas. '' = ainda falta escolher (ou não há).
 */
export function marcaDaLinha(marcas: string[], escolhida?: string | null): string {
  if (!marcas.length) return '';
  if (marcas.length === 1) return marcas[0];
  const chave = chaveDaMarca(escolhida);
  return (chave && marcas.find((m) => chaveDaMarca(m) === chave)) || '';
}

/** Produto com duas ou mais marcas e nenhuma escolhida: o servidor recusa a lista. */
export function faltaMarca(marcas: string[], escolhida?: string | null): boolean {
  return marcas.length >= 2 && !marcaDaLinha(marcas, escolhida);
}

/** Onde a busca procura: nome do produto, nome comercial e marcas. */
export function textoDeBusca(i: (ComNome & ComMarcas) | null | undefined): string {
  return [limpo(i?.nome), limpo(i?.nomeComercial), ...marcasDe(i)].filter(Boolean).join(' ');
}

/** Marcas já usadas em outros produtos (sugestões do cadastro), sem repetir, em ordem alfabética. */
export function marcasConhecidas(itens: ComMarcas[]): string[] {
  const vistas = new Map<string, string>();
  for (const i of itens) for (const m of marcasDe(i)) if (!vistas.has(chaveDaMarca(m))) vistas.set(chaveDaMarca(m), m);
  return [...vistas.values()].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

/** As marcas que podem ser a 2ª opção do pedido: as do produto, menos a 1ª. */
export function outrasMarcas(marcas: string[], primeira?: string | null): string[] {
  const chave = chaveDaMarca(primeira);
  return marcas.filter((m) => chaveDaMarca(m) !== chave);
}

/**
 * A 2ª opção de marca que vale para a linha da compra ("se faltar a 1ª, pode vir esta"): só em
 * produto com duas ou mais marcas, com a 1ª já escolhida, e diferente dela. '' = sem 2ª opção.
 */
export function segundaMarcaDaLinha(marcas: string[], primeira?: string | null, segunda?: string | null): string {
  if (marcas.length < 2 || !marcaDaLinha(marcas, primeira)) return '';
  const chave = chaveDaMarca(segunda);
  return (chave && outrasMarcas(marcas, primeira).find((m) => chaveDaMarca(m) === chave)) || '';
}

/** Quanto faltou do pedido: 0 quando veio tudo ou a mais. Tira a sujeira da conta (10 − 9,7 = 0,3). */
export function quantoFaltou(pedida: unknown, recebida: unknown): number {
  const falta = Math.round(((Number(pedida) || 0) - (Number(recebida) || 0)) * 1e6) / 1e6;
  return falta > 0 ? falta : 0;
}

/** O que foi pedido, em texto: "Marca: Alfa · 2ª opção: Beta". '' quando o item não tem marca. */
export function textoDaMarcaPedida(i: { marca?: string | null; marcaAlternativa?: string | null } | null | undefined): string {
  const marca = limpo(i?.marca);
  const segunda = limpo(i?.marcaAlternativa);
  return [marca ? `Marca: ${marca}` : '', segunda ? `2ª opção: ${segunda}` : ''].filter(Boolean).join(' · ');
}
