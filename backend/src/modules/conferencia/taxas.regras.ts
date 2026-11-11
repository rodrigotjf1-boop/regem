/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "％ TAXAS E MARGEM" de cada loja (R3 F5; mig 407; protótipo `mockups/regem-conciliacao-ifood.html`, decisões 7 e 8): o
 * formato guardado, os valores de referência e a conferência de cada número. A calculadora (a conta) mora na tela
 * (`frontend/src/lib/calculadora-preco.ts`); aqui só o que se guarda.
 */

export type CanalDaTaxa = 'ifood' | '99food';
export type Cenario = { com: number; pag: number; taxaFixa: number };
export type TaxasDoApp = {
  /** O plano da loja: a loja entrega ou o app entrega (a calculadora marca o da loja e mostra o outro). */
  plano: 'loja' | 'app';
  /** Com promoção, a comissão incide sobre: o que o cliente paga, o preço menos o desconto da loja, ou o preço cheio. */
  baseComissao: 'cliente' | 'loja' | 'cheio';
  /** % dos pedidos do app pagos na entrega (quando a loja entrega); `null` = o número das vendas (decisão 8). */
  parteNaEntrega: number | null;
  loja: Cenario;
  app: Cenario;
};
export type TaxasGerais = {
  impostoModo: 'simples' | 'media';
  /** % médio (modo "média"; e o que vale se o Simples não der conta). */
  imposto: number;
  /** Faturamento dos últimos 12 meses (Simples); `null` = o das vendas. */
  rbt12: number | null;
  margem: number;
  antecipa: boolean;
  antec: number;
  /** O que a entrega custa à loja por item (quando a loja entrega). */
  entregaLoja: number;
  arred: boolean;
  maquininha: number;
  /** Itens de um pedido médio; `null` = o das vendas. */
  itensPedido: number | null;
};
export type Taxas = { ifood: TaxasDoApp; '99food': TaxasDoApp; geral: TaxasGerais };

/**
 * Os valores de referência (protótipo, "Fontes das taxas de referência", consultadas em 11/11/2026): iFood — Plano Básico
 * 12% e Plano Entrega 23%, mais 3,2% de pagamento online; 99 — 10,9% com entrega da loja e 8,9% com a da 99, mais cerca de
 * 3,2%. O resto são exemplos sem fonte, para a loja trocar; o faturamento, os itens por pedido e a parte paga na entrega
 * vêm das vendas (`null`).
 */
export const TAXAS_PADRAO: Taxas = {
  ifood: { plano: 'loja', baseComissao: 'loja', parteNaEntrega: null, loja: { com: 12, pag: 3.2, taxaFixa: 0 }, app: { com: 23, pag: 3.2, taxaFixa: 0 } },
  '99food': { plano: 'app', baseComissao: 'cliente', parteNaEntrega: null, loja: { com: 10.9, pag: 3.2, taxaFixa: 0 }, app: { com: 8.9, pag: 3.2, taxaFixa: 0 } },
  geral: {
    impostoModo: 'simples',
    imposto: 6,
    rbt12: null,
    margem: 20,
    antecipa: false,
    antec: 2.5,
    entregaLoja: 0.8,
    arred: true,
    maquininha: 2.9,
    itensPedido: null,
  },
};

const APP: Record<CanalDaTaxa, string> = { ifood: 'iFood', '99food': '99' };

/** Um número digitado ("12,5", 12.5) dentro da faixa; `undefined` = não veio; lança com a frase da tela se não serve. */
function numero(v: unknown, rotulo: string, min: number, max: number, opcional = false): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') {
    if (opcional) return null;
    throw new Error(`${rotulo}: informe um número.`);
  }
  const n = typeof v === 'number' ? v : Number(String(v).replace(/\./g, (m, i, s) => (s.includes(',') ? '' : m)).replace(',', '.'));
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${rotulo}: use um número de ${min} a ${max.toLocaleString('pt-BR')}.`);
  return Math.round(n * 100) / 100;
}

/**
 * As taxas a gravar, conferidas número a número contra a faixa de cada um (a frase do erro diz o campo); o que não veio
 * fica o que já estava (`atuais`, V16). Lança `Error` com a frase da tela.
 */
export function conferirTaxas(dto: any, atuais: Taxas): Taxas {
  const t: Taxas = JSON.parse(JSON.stringify(atuais));
  for (const c of ['ifood', '99food'] as const) {
    const d = dto?.[c];
    if (d === undefined) continue;
    if (d === null || typeof d !== 'object') throw new Error(`Taxas ${APP[c] === '99' ? 'da 99' : 'do iFood'}: formato inválido.`);
    const nome = APP[c] === '99' ? 'da 99' : 'do iFood';
    if (d.plano !== undefined) {
      if (d.plano !== 'loja' && d.plano !== 'app') throw new Error(`O plano ${nome}: escolha "a loja entrega" ou "o app entrega".`);
      t[c].plano = d.plano;
    }
    if (d.baseComissao !== undefined) {
      if (!['cliente', 'loja', 'cheio'].includes(d.baseComissao)) throw new Error(`A base da comissão ${nome}: escolha uma das opções.`);
      t[c].baseComissao = d.baseComissao;
    }
    const parte = numero(d.parteNaEntrega, `Pedidos ${nome} pagos na entrega (%)`, 0, 100, true);
    if (parte !== undefined) t[c].parteNaEntrega = parte;
    for (const k of ['loja', 'app'] as const) {
      const e = d[k];
      if (e === undefined) continue;
      const quem = k === 'loja' ? 'a loja entrega' : `${APP[c] === '99' ? 'a 99' : 'o iFood'} entrega`;
      const com = numero(e?.com, `Comissão ${nome} (${quem})`, 0, 100);
      const pag = numero(e?.pag, `Pagamento online ${nome} (${quem})`, 0, 100);
      const fixa = numero(e?.taxaFixa, `Taxa fixa por entrega ${nome} (${quem})`, 0, 1000);
      if (com != null) t[c][k].com = com;
      if (pag != null) t[c][k].pag = pag;
      if (fixa != null) t[c][k].taxaFixa = fixa;
    }
  }
  const g = dto?.geral;
  if (g !== undefined) {
    if (g === null || typeof g !== 'object') throw new Error('Imposto e margem: formato inválido.');
    if (g.impostoModo !== undefined) {
      if (g.impostoModo !== 'simples' && g.impostoModo !== 'media') throw new Error('O imposto: escolha "Simples Nacional" ou "uma média".');
      t.geral.impostoModo = g.impostoModo;
    }
    const campos: [keyof TaxasGerais, string, number, number, boolean][] = [
      ['imposto', 'Imposto médio (%)', 0, 100, false],
      ['rbt12', 'Faturamento dos últimos 12 meses', 0, 100_000_000, true],
      ['margem', 'Margem (%)', 0, 90, false],
      ['antec', 'Antecipação do repasse (%)', 0, 100, false],
      ['entregaLoja', 'Entrega da loja por item (R$)', 0, 1000, false],
      ['maquininha', 'Taxa da maquininha (%)', 0, 100, false],
      ['itensPedido', 'Itens por pedido', 1, 50, true],
    ];
    for (const [k, rotulo, min, max, opc] of campos) {
      const v = numero(g[k], rotulo, min, max, opc);
      if (v !== undefined) (t.geral as any)[k] = v;
    }
    for (const k of ['antecipa', 'arred'] as const) {
      if (g[k] === undefined) continue;
      if (typeof g[k] !== 'boolean') throw new Error(`${k === 'antecipa' ? '"Antecipo"' : '"Arredondar para ,90"'}: marque ou desmarque.`);
      t.geral[k] = g[k];
    }
  }
  return t;
}

/** As taxas guardadas completadas com os valores de referência (o que faltar ou não servir fica o de referência). */
export function completarTaxas(salvas: unknown): Taxas {
  try {
    return conferirTaxas(salvas && typeof salvas === 'object' ? salvas : {}, TAXAS_PADRAO);
  } catch {
    // Uma linha antiga com um número fora da faixa: campo a campo, o que serve fica.
    const t: Taxas = JSON.parse(JSON.stringify(TAXAS_PADRAO));
    const s: any = salvas ?? {};
    for (const parte of [{ ifood: s.ifood }, { '99food': s['99food'] }, { geral: s.geral }]) {
      try {
        Object.assign(t, conferirTaxas(parte, t));
      } catch {
        /* fica o de referência */
      }
    }
    return t;
  }
}
