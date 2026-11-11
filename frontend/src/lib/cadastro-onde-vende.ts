// CADASTROS › CARDÁPIO depois da Gestão do catálogo (R3, fase F7; protótipo aprovado `mockups/regem-conciliacao-ifood.html`,
// "E no Cadastros › Cardápio, como fica", decisões 1 e 14).
//
//   • Ao CRIAR, o "Onde vende" (Regem, iFood, 99) vira os campos do produto: Regem = o balcão E o cardápio digital (a pausa
//     do Regem é dos dois juntos — decisão 13); iFood = "Está no iFood" (`noIfood`); 99 = "Está na 99" (`na99`). O campo de
//     um app só vai com o app ligado (ausente = o servidor guarda o padrão — e nem grava sem o direito).
//   • Ao EDITAR, o preço muda só na Gestão do catálogo (o formulário mostra e não manda), e a pausa/onde vende só vai se a
//     pessoa MUDOU: a Gestão (ou o totem) pode ter mudado depois que o formulário abriu, e regravar o valor velho desfaria
//     isso. Os canais de `canais_pausados` vão um por vez, pela rota da pausa por canal (nunca a lista inteira).

export type OndeVende = { regem: boolean; ifood: boolean; n99: boolean };

/** O "Onde vende" de um produto novo: tudo marcado (todos os catálogos), como no protótipo. */
export const ONDE_VENDE_NOVO: OndeVende = { regem: true, ifood: true, n99: true };

/** Ao criar: os campos do produto que o "Onde vende" decide. */
export function camposDoOndeVende(o: OndeVende, comIfood: boolean, com99: boolean): Record<string, boolean> {
  return {
    disponivelBalcao: o.regem,
    disponivelCardapio: o.regem,
    ...(comIfood ? { noIfood: o.ifood } : {}),
    ...(com99 ? { na99: o.n99 } : {}),
  };
}

/** O que o "Onde vende" deixa de fora (para a frase de ajuda). Vazio = vende em todos os mostrados. */
export function ondeNaoVende(o: OndeVende, comIfood: boolean, com99: boolean): string[] {
  return [!o.regem && 'no Regem', comIfood && !o.ifood && 'no iFood', com99 && !o.n99 && 'na 99'].filter((x): x is string => !!x);
}

/** O estado de pausa/onde vende que o formulário de editar leu do produto. */
export type EstadoDeVenda = {
  disponivelBalcao: boolean;
  disponivelCardapio: boolean;
  noIfood: boolean;
  canaisPausados: string[];
};

export function estadoDeVenda(p: any): EstadoDeVenda {
  return {
    disponivelBalcao: p?.disponivelBalcao !== false,
    disponivelCardapio: p?.disponivelCardapio !== false,
    noIfood: p?.noIfood === true,
    canaisPausados: Array.isArray(p?.canaisPausados) ? p.canaisPausados.map(String) : [],
  };
}

/**
 * Ao editar: SÓ o que mudou. `patch` vai no PATCH do produto (balcão, cardápio digital, "Está no iFood" — este só com o
 * iFood ligado); `canais` vão um por vez pela pausa por canal (o canal que entrou na lista = pausar; o que saiu = reativar).
 */
export function mudancasAoEditar(
  antes: EstadoDeVenda,
  agora: EstadoDeVenda,
  comIfood: boolean,
): { patch: Record<string, boolean>; canais: { canal: string; pausado: boolean }[] } {
  const patch: Record<string, boolean> = {};
  if (agora.disponivelBalcao !== antes.disponivelBalcao) patch.disponivelBalcao = agora.disponivelBalcao;
  if (agora.disponivelCardapio !== antes.disponivelCardapio) patch.disponivelCardapio = agora.disponivelCardapio;
  if (comIfood && agora.noIfood !== antes.noIfood) patch.noIfood = agora.noIfood;
  const eraPausado = new Set(antes.canaisPausados);
  const ficouPausado = new Set(agora.canaisPausados);
  const canais = [
    ...[...ficouPausado].filter((c) => !eraPausado.has(c)).map((canal) => ({ canal, pausado: true })),
    ...[...eraPausado].filter((c) => !ficouPausado.has(c)).map((canal) => ({ canal, pausado: false })),
  ];
  return { patch, canais };
}

/** A Gestão do catálogo com a busca já preenchida (a página lê `?busca=` ao abrir). */
export const linkDaGestao = (nome?: string) => (nome ? `/catalogo?busca=${encodeURIComponent(nome)}` : '/catalogo');
