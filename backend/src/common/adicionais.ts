// Adicionais (opções) escolhidos num item vendido — as duas regras que precisam ser UMA só em
// todo caminho de venda (balcão, mesa, cardápio, canal):
//
//  1. Repetição. "+1 fatia de bacon" duas vezes são DUAS fatias: dois preços, duas baixas. Só vale
//     onde a etapa permite (`complemento.regra = 'varias_com_repeticao'`); fora dela, uma vez.
//  2. Texto. "+ 2x Bacon · sem Cebola" para o cupom e a cozinha. O pedido do NOSSO cardápio já
//     escreve as escolhas na descrição do item ("X-Burger (2x Bacon, Sem cebola)"): ali o texto
//     não é repetido.

export const REGRA_COM_REPETICAO = 'varias_com_repeticao';

export type Escolha = { tipo?: string | null; nome: string };

// Quantas vezes cada opção foi escolhida, na ordem em que aparece pela primeira vez.
// `permiteRepetir(id)` = a etapa daquela opção aceita repetição; se não, a opção conta uma vez.
export function vezesPorOpcao(
  ids: (string | null | undefined)[],
  permiteRepetir: (id: string) => boolean,
): Map<string, number> {
  const vezes = new Map<string, number>();
  for (const id of ids ?? []) {
    if (!id) continue;
    vezes.set(id, (vezes.get(id) ?? 0) + 1);
  }
  for (const [id, n] of vezes) if (n > 1 && !permiteRepetir(id)) vezes.set(id, 1);
  return vezes;
}

// "2x Bacon" — o rótulo que o cardápio escreve na descrição do item e o cupom imprime.
export function rotuloDaEscolha(nome: string, vezes: number): string {
  return vezes > 1 ? `${vezes}x ${nome}` : nome;
}

// Junta as repetições da mesma escolha (mesmo tipo e nome), na ordem em que aparecem.
export function agruparEscolhas(comps: Escolha[]): { tipo: string; nome: string; vezes: number }[] {
  const grupos = new Map<string, { tipo: string; nome: string; vezes: number }>();
  for (const c of comps ?? []) {
    const tipo = c.tipo === 'remover' ? 'remover' : 'adicionar';
    const nome = String(c.nome ?? '');
    const chave = `${tipo}\u0000${nome}`;
    const g = grupos.get(chave);
    if (g) g.vezes += 1;
    else grupos.set(chave, { tipo, nome, vezes: 1 });
  }
  return [...grupos.values()];
}

// A descrição do item JÁ traz as escolhas? Verdade só quando ela termina com a lista exata das
// escolhas gravadas, no formato do cardápio — "Produto (2x Bacon, Sem cebola)". A ordem não
// importa (a do banco não é garantida); a lista, sim: uma escolha a mais ou a menos e o texto
// volta a ser escrito.
export function descricaoTrazEscolhas(descricao: string | null | undefined, comps: Escolha[]): boolean {
  const grupos = agruparEscolhas(comps);
  if (!grupos.length) return false;
  const texto = String(descricao ?? '').trimEnd();
  if (!texto.endsWith(')')) return false;
  const rotulos = grupos.map((g) => rotuloDaEscolha(g.nome, g.vezes));
  const esperado = rotulos.join(', ');
  // A lista ocupa o fim da descrição, logo depois de " (": acha-se o parêntese pelo tamanho dela.
  const inicio = texto.length - 1 - esperado.length;
  if (inicio < 2 || texto.slice(inicio - 2, inicio) !== ' (') return false;
  const partes = (s: string) => s.split(', ').sort().join('\u0000');
  return partes(texto.slice(inicio, texto.length - 1)) === partes(esperado);
}

// Texto das escolhas para o cupom e para a cozinha: "+ 2x Bacon · sem Cebola".
// Com `descricao`, devolve null quando ela já traz as escolhas (pedido do nosso cardápio).
export function textoDasEscolhas(comps: Escolha[], descricao?: string | null): string | null {
  const grupos = agruparEscolhas(comps);
  if (!grupos.length) return null;
  if (descricao != null && descricaoTrazEscolhas(descricao, comps)) return null;
  return grupos
    .map((g) => `${g.tipo === 'remover' ? 'sem' : '+'} ${rotuloDaEscolha(g.nome, g.vezes)}`)
    .join(' · ');
}
