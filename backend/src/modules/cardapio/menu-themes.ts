// Layouts do cardápio público (`cardapio_config.menu_theme`) e o que as telas deles precisam do
// servidor. Funções puras: sem banco, sem relógio (o chamador passa a hora).

/** Templates do cardápio digital (docs/templates-cardapio/). */
export const TEMPLATES_CARDAPIO = ['galeria', 'balcao', 'oferta', 'fluxo'] as const;
/** Layouts de antes dos templates. */
export const LAYOUTS_ANTIGOS = ['classic', 'fastfood', 'grid'] as const;
/** Tudo o que a coluna `menu_theme` aceita. */
export const MENU_THEMES = [...LAYOUTS_ANTIGOS, ...TEMPLATES_CARDAPIO] as const;
export type MenuTheme = (typeof MENU_THEMES)[number];

export function menuThemeValido(v: unknown): v is MenuTheme {
  return typeof v === 'string' && (MENU_THEMES as readonly string[]).includes(v);
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
