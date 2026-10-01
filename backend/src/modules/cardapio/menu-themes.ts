// Layouts do cardápio público (`cardapio_config.menu_theme`) e o que as telas deles precisam do
// servidor. Funções puras: sem banco, sem relógio (o chamador passa a hora).

/** Templates do cardápio digital (docs/templates-cardapio/). */
export const TEMPLATES_CARDAPIO = ['galeria', 'balcao', 'oferta', 'fluxo'] as const;
export type TemplateCardapio = (typeof TEMPLATES_CARDAPIO)[number];
/** O template de loja nova e de loja que ainda tem um layout antigo gravado (`classic`, `fastfood`, `grid`). */
export const TEMPLATE_PADRAO: TemplateCardapio = 'fluxo';

export function ehTemplateCardapio(v: unknown): v is TemplateCardapio {
  return typeof v === 'string' && (TEMPLATES_CARDAPIO as readonly string[]).includes(v);
}

/**
 * O template que o cardápio público mostra: o que a loja escolheu, ou o padrão. A coluna guarda o
 * que foi gravado (inclusive um layout antigo); a troca acontece na leitura, sem migration.
 */
export function templateDoCardapio(v: unknown): TemplateCardapio {
  return ehTemplateCardapio(v) ? v : TEMPLATE_PADRAO;
}

/**
 * Eventos anônimos do funil do cardápio. `etapa_entrega` e `etapa_dados` vêm do checkout em etapas;
 * a etapa de pagamento usa `pagamento`, que já existia.
 */
export const TIPOS_EVENTO_FUNIL = ['view_menu', 'add_carrinho', 'checkout', 'etapa_entrega', 'etapa_dados', 'pagamento', 'pedido'] as const;

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

/**
 * A próxima abertura de um conjunto de horários: "18:00" quando é hoje mais tarde, "sex 18:00"
 * quando é outro dia, `null` sem horário cadastrado. Mesma regra do rótulo "Abre às…" do cabeçalho.
 */
export function proximaAberturaDe(
  horarios: { dia?: unknown; ativo?: unknown; abre?: string; fecha?: string }[] | null | undefined,
  agora: { dia: number; hhmm: string },
): string | null {
  const hs = Array.isArray(horarios) ? horarios : [];
  for (let d = 0; d < 7; d++) {
    const cd = (agora.dia + d) % 7;
    const janelas = hs
      .filter((h) => Number(h.dia) === cd && h.ativo && h.abre && h.fecha)
      .filter((h) => d > 0 || String(h.abre) > agora.hhmm)
      .sort((a, b) => (String(a.abre) < String(b.abre) ? -1 : 1));
    if (janelas.length) return d === 0 ? String(janelas[0].abre) : `${DIAS[cd]} ${janelas[0].abre}`;
  }
  return null;
}
