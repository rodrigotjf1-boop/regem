// O ENVIO À 99 ITEM A ITEM (R3 da Gestão do catálogo, fase F2; mig 402) — as regras puras, sem banco nem rede.
//
// A API da 99 (doc 1967 "Update One Item", 1969 "Update Item Status", 1961 "Get Store Menu Details"):
//   • `updateItem` exige o item INTEIRO em toda chamada — nome, preço, situação e "vende separado" (os quatro
//     obrigatórios) — e troca o que vier. Então o Regem lê o item como a 99 tem (`item/list`) e devolve tudo igual,
//     mudando só o que é dele (o preço, o nome, a descrição). A foto, os horários, a ordem e o campo livre do PDV voltam
//     como estavam; a promoção (`activity_price`) NÃO vai: a doc diz que esta chamada não muda promoção;
//   • `updateItemStatus` muda só a situação (1 disponível, 2 indisponível) e diz item a item o que deu certo;
//   • preço SEMPRE em centavos, inteiro.

/** Os limites da 99 (doc 1967): o que passa disso não vai — o motivo fica no "último envio à 99". */
export const LIMITE_NOME_99 = 180;
export const LIMITE_DESCRICAO_99 = 1500;

/** O que mudar no item (o resto volta como a 99 tem). Preço em centavos; `foto` = o endereço público da foto do Regem (F6). */
export type MudancaNoItem = { preco?: number; nome?: string; descricao?: string; foto?: string };

/** Os campos que a doc 1967 aceita no `updateItem` (fora o `auth_token`, que o serviço põe). */
const CAMPOS_QUE_VOLTAM = ['app_external_id', 'sold_info_intl', 'head_img', 'priority'] as const;

const tem = (v: unknown) => v !== undefined && v !== null;

/**
 * O corpo do `updateItem` (sem o `auth_token`): o item como a 99 devolveu na leitura, com a mudança do Regem por cima.
 * A situação e o "vende separado" voltam como lá estão (uma mudança de preço não reativa nem pausa o item).
 */
export function itemParaAtualizar(daLista: Record<string, any>, mudar: MudancaNoItem): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    app_item_id: String(daLista.app_item_id),
    item_name: mudar.nome ?? String(daLista.item_name ?? ''),
    price: mudar.preco ?? Number(daLista.price),
    status: Number(daLista.status) === 2 ? 2 : 1,
    is_sold_separately: daLista.is_sold_separately !== false,
  };
  if (mudar.descricao !== undefined) corpo.short_desc = mudar.descricao;
  else if (tem(daLista.short_desc)) corpo.short_desc = daLista.short_desc;
  for (const k of CAMPOS_QUE_VOLTAM) if (tem(daLista[k])) corpo[k] = daLista[k];
  // "Mandar esta foto à 99" (R3 F6): a 99 baixa a foto pelo endereço (doc 1967, `head_img`).
  if (mudar.foto !== undefined) corpo.head_img = mudar.foto;
  return corpo;
}

// ── O COMPLEMENTO (R3 F3b; mig 404) ─────────────────────────────────────────────────────────────────────────────
// Na 99, o complemento é um item que entra nos grupos (`modifier_groups`) com um preço POR GRUPO. O "Update Modifier
// Group" (doc 1971) troca o grupo inteiro: nome e `buy_mode` obrigatórios, a regra (obrigatório, mínimo, máximo) e a lista
// das opções com o preço de cada uma. Então o Regem devolve o grupo como a 99 tem, trocando SÓ o preço da opção dele.

/** Os campos do grupo que voltam como a 99 tem (doc 1971, fora o `auth_token` e os montados abaixo). */
const CAMPOS_DO_GRUPO_QUE_VOLTAM = ['app_external_id', 'is_required', 'quantity_min_permitted', 'quantity_max_permitted'] as const;

/** Os grupos da 99 que têm a opção com este código. */
export function gruposComOItem(grupos: unknown[], codigo: string): Record<string, any>[] {
  return (Array.isArray(grupos) ? grupos : []).filter(
    (g: any) => Array.isArray(g?.app_mg_items) && g.app_mg_items.some((it: any) => String(it?.app_item_id) === codigo),
  ) as Record<string, any>[];
}

/**
 * O corpo do `updateModifierGroup` (sem o `auth_token`): o grupo como a 99 devolveu na leitura, com o preço da opção do
 * código trocado (em centavos). As outras opções e a regra de escolha voltam iguais.
 */
export function grupoParaAtualizar(daLista: Record<string, any>, codigo: string, preco: number): Record<string, unknown> {
  const corpo: Record<string, unknown> = {
    modifier_group_name: String(daLista.modifier_group_name ?? ''),
    app_modifier_group_id: String(daLista.app_modifier_group_id),
    buy_mode: Number(daLista.buy_mode) === 1 ? 1 : 0,
    app_mg_items: (Array.isArray(daLista.app_mg_items) ? daLista.app_mg_items : []).map((it: any) => {
      const id = String(it?.app_item_id);
      const valor = id === codigo ? preco : it?.price;
      return tem(valor) ? { app_item_id: id, price: Number(valor) } : { app_item_id: id };
    }),
  };
  for (const k of CAMPOS_DO_GRUPO_QUE_VOLTAM) if (tem(daLista[k])) corpo[k] = daLista[k];
  return corpo;
}

/** Reais (texto ou número do banco) → centavos inteiros (o que a 99 recebe). */
export const centavos = (v: unknown): number => Math.round(Number(v) * 100);

/** O que fazer com a resposta da 99 (o `errno`). */
export type Desfecho99 = {
  /** aplicado | nao_encontrado | recusado | dispensado */
  resultado: string;
  /** Tentar de novo mais tarde. */
  repetir: boolean;
  resposta: Record<string, unknown>;
  erro: string | null;
};

/**
 * O `errno` da 99 vira o desfecho: 0 = aplicado; sem resposta (-1), sem token (-2), erro de sistema (10000, 10001) e
 * autorização expirada (10102, que já tentou com token novo) = tentar de novo; o resto (10002 parâmetro, e os que a doc
 * não lista) = recusado, com a mensagem da 99 — repetir não resolve.
 */
export function desfechoDoErrno(errno: number, errmsg: string | null, extra: Record<string, unknown> = {}): Desfecho99 {
  if (errno === 0) return { resultado: 'aplicado', repetir: false, resposta: { errno, ...extra }, erro: null };
  const frase = errmsg ? `A 99 respondeu: ${errmsg}` : `A 99 recusou (código ${errno}).`;
  if ([-1, -2, -3, 10000, 10001, 10102].includes(errno))
    return { resultado: 'erro', repetir: true, resposta: { errno, mensagem: errmsg, ...extra }, erro: `errno ${errno}${errmsg ? `: ${errmsg}` : ''}` };
  return { resultado: 'recusado', repetir: false, resposta: { errno, mensagem: errmsg, frase, ...extra }, erro: `errno ${errno}${errmsg ? `: ${errmsg}` : ''}` };
}

/** Espera antes da próxima tentativa (1, 2, 5, 10, 30 e depois 60 minutos) — a régua do Orzuni. */
export function recuoMinutos99(tentativas: number): number {
  const passos = [1, 2, 5, 10, 30];
  return passos[Math.max(0, tentativas - 1)] ?? 60;
}

/** Desiste depois de 24 h sem conseguir (a tela diz para salvar de novo). */
export const DESISTIR_99_DEPOIS_HORAS = 24;
/** Reserva de um envio em andamento: se o processo morrer no meio, ele volta à fila sozinho. */
export const RESERVA_99_MINUTOS = 2;
