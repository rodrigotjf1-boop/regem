// Templates do cardápio digital (docs/templates-cardapio/). Só apresentação: a regra do pedido
// mora em `use-cardapio.ts` e é a mesma para os quatro.

export const TEMPLATES = ['galeria', 'balcao', 'oferta', 'fluxo'] as const;
export type TemplateChave = (typeof TEMPLATES)[number];

/** O template padrão do Regem (loja nova, valor desconhecido ou layout antigo). */
export const TEMPLATE_PADRAO: TemplateChave = 'fluxo';

export const NOME_TEMPLATE: Record<TemplateChave, string> = {
  galeria: 'Galeria',
  balcao: 'Balcão',
  oferta: 'Oferta',
  fluxo: 'Regem Fluxo',
};

export function ehTemplate(v: unknown): v is TemplateChave {
  return typeof v === 'string' && (TEMPLATES as readonly string[]).includes(v);
}

/** O template de uma loja: o que ela escolheu, ou o padrão. */
export function templateDe(menuTheme: unknown): TemplateChave {
  return ehTemplate(menuTheme) ? menuTheme : TEMPLATE_PADRAO;
}

/** Galeria, Oferta e Regem Fluxo pedem nome e WhatsApp dentro da etapa de entrega. */
export function dadosNaEntrega(t: TemplateChave): boolean {
  return t !== 'balcao';
}

/** Opções das seções comuns do checkout, por template (onde fica o cupom, estilo do "peça também"…). */
export const OPCOES_TEMPLATE: Record<
  TemplateChave,
  {
    /** Barra de frete grátis dentro da Sacola. */
    freteNaSacola: boolean;
    /** Cupom aberto na Sacola (senão, só no bloco de benefícios do Pagamento). */
    cupomNaSacola: boolean;
    /** "Peça também" em cards com foto (senão, em linhas). */
    upsellEmCards: boolean;
    tituloUpsell: string;
    /** Selo "Mais rápido" no Pix. */
    pixEmDestaque: boolean;
    /** Rodapé: botão neutro que DIZ o que falta e leva até o campo (senão, texto + botão desabilitado). */
    botaoDizOQueFalta: boolean;
    /** Produto com escolha obrigatória: grupos numerados e opcionais recolhidos. */
    produtoGuiado: boolean;
    /** "+" direto no produto sem escolha obrigatória. */
    adicionarDireto: boolean;
  }
> = {
  galeria: { freteNaSacola: false, cupomNaSacola: false, upsellEmCards: true, tituloUpsell: 'Peça também', pixEmDestaque: true, botaoDizOQueFalta: false, produtoGuiado: false, adicionarDireto: true },
  balcao: { freteNaSacola: false, cupomNaSacola: true, upsellEmCards: false, tituloUpsell: 'Aproveite e leve', pixEmDestaque: false, botaoDizOQueFalta: false, produtoGuiado: false, adicionarDireto: false },
  oferta: { freteNaSacola: true, cupomNaSacola: true, upsellEmCards: true, tituloUpsell: 'Combina com seu pedido', pixEmDestaque: true, botaoDizOQueFalta: false, produtoGuiado: false, adicionarDireto: false },
  fluxo: { freteNaSacola: true, cupomNaSacola: false, upsellEmCards: false, tituloUpsell: 'Combina com seu pedido', pixEmDestaque: true, botaoDizOQueFalta: true, produtoGuiado: true, adicionarDireto: true },
};
