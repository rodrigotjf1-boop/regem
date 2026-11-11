// A CALCULADORA DE PREÇO (R3 F5; protótipo `mockups/regem-conciliacao-ifood.html`, "A calculadora de preço" e as decisões 7,
// 8 e 9): a conta por ITEM, os dois jeitos de entregar de cada app, a promoção, o Simples Nacional. É o porte da função
// `calcular` do protótipo aprovado. Sem import: o `check:catalogo` transpila este arquivo sozinho e confere os casos.

export type CanalCalc = 'ifood' | '99food';
export type JeitoDeEntregar = 'loja' | 'app';
export type Cenario = { com: number; pag: number; taxaFixa: number };
export type TaxasDoApp = {
  plano: JeitoDeEntregar;
  baseComissao: 'cliente' | 'loja' | 'cheio';
  parteNaEntrega: number | null;
  loja: Cenario;
  app: Cenario;
};
export type TaxasGerais = {
  impostoModo: 'simples' | 'media';
  imposto: number;
  rbt12: number | null;
  margem: number;
  antecipa: boolean;
  antec: number;
  entregaLoja: number;
  arred: boolean;
  maquininha: number;
  itensPedido: number | null;
};
export type Taxas = { ifood: TaxasDoApp; '99food': TaxasDoApp; geral: TaxasGerais };
export type VendasDaLoja = {
  rbt12: number | null;
  rbt12Motivo: string | null;
  itensPorPedido: number | null;
  pedidos: number;
  parteNaEntrega: Record<CanalCalc, { pct: number | null; pedidos: number }>;
  dias: number;
};
export type RespostaDasTaxas = { loja: { id: string; nome: string }; taxas: Taxas; salvas: boolean; atualizadoEm: string | null; vendas: VendasDaLoja };

/** O nome de cada jeito de entregar e o plano (os textos do protótipo). */
export const JEITOS: Record<CanalCalc, Record<JeitoDeEntregar, { rot: string; plano: string }>> = {
  ifood: { loja: { rot: 'A loja entrega', plano: 'Plano Básico' }, app: { rot: 'O iFood entrega', plano: 'Plano Entrega' } },
  '99food': { loja: { rot: 'A loja entrega', plano: 'entrega própria' }, app: { rot: 'A 99 entrega', plano: 'logística da 99' } },
};

/** A promoção simulada (não se guarda): % no item, R$ no item ou R$ no pedido; quem banca: a loja uma parte, ou o app um fixo. */
export type Promo = {
  ligada: boolean;
  tipo: 'pct' | 'rsItem' | 'rsPedido';
  desconto: number;
  descontoRs: number;
  quemBanca: 'parte' | 'appFixo';
  lojaBanca: number;
  appFixo: number;
};
export const PROMO_PADRAO: Promo = { ligada: false, tipo: 'pct', desconto: 30, descontoRs: 10, quemBanca: 'parte', lojaBanca: 100, appFixo: 5 };

/**
 * Simples Nacional, Anexo I (comércio — onde ficam bares e restaurantes; LC 123/2006 com a LC 155/2016): a alíquota efetiva
 * pelo faturamento dos últimos 12 meses (RBT12) = (RBT12 × nominal − parcela a deduzir) ÷ RBT12. Acima de R$ 4,8 mi: fora.
 */
export const FAIXAS_SIMPLES: [number, number, number][] = [
  [180000, 4.0, 0],
  [360000, 7.3, 5940],
  [720000, 9.5, 13860],
  [1800000, 10.7, 22500],
  [3600000, 14.3, 87300],
  [4800000, 19.0, 378000],
];
export function simples(rbt12: number | null | undefined): { faixa: number; nominal: number; efetiva: number } | null {
  if (rbt12 == null || !(rbt12 > 0)) return null;
  const i = FAIXAS_SIMPLES.findIndex(([teto]) => rbt12 <= teto);
  if (i < 0) return null;
  const [, nom, ded] = FAIXAS_SIMPLES[i];
  return { faixa: i + 1, nominal: nom, efetiva: Math.max(0, (rbt12 * (nom / 100) - ded) / rbt12) * 100 };
}

/** Os números que a conta usa: o digitado pela loja, ou o das vendas (`null` = das vendas; sem vendas, o exemplo). */
export function numerosEfetivos(t: Taxas, v: VendasDaLoja | null, canal: CanalCalc) {
  const rbt12 = t.geral.rbt12 ?? v?.rbt12 ?? null;
  const itens = t.geral.itensPedido ?? v?.itensPorPedido ?? 2;
  const parte = t[canal].parteNaEntrega ?? v?.parteNaEntrega[canal]?.pct ?? 30;
  const sn = t.geral.impostoModo === 'simples' ? simples(rbt12) : null;
  return {
    rbt12,
    itensPedido: Math.max(1, itens),
    parteNaEntrega: parte,
    simples: sn,
    imposto: sn ? sn.efetiva : t.geral.imposto,
  };
}

export type Base = { custo: number; emb: number; semEntrega?: boolean };
export type Resultado = {
  preco: number;
  clientePaga: number;
  descontoLoja: number;
  descontoApp: number;
  vende: number;
  baseComissao: number;
  comissao: number;
  pagamento: number;
  antecipacao: number;
  imposto: number;
  taxasR: number;
  lucro: number;
  margem: number;
};
export type Calculo = {
  fixo: number;
  entrega: number;
  taxaFixa: number;
  taxaFixaItem: number;
  n: number;
  partes: { comissao: number; pagamento: number; antecipacao: number; imposto: number };
  imposto: number;
  taxas: number;
  recomendado: number | null;
  minimo: number | null;
  com: (p: number) => Resultado;
  descontoMax: (p: number) => { rs: number; pct: number };
};

/**
 * A CONTA (por ITEM; P = preço cheio no app):
 * - custo fixo do item = custo + embalagem + entrega da loja por item (só quando a loja entrega) + taxa fixa da entrega do
 *   app ÷ itens por pedido (só quando o app entrega); o complemento (`semEntrega`) não leva entrega nem taxa fixa;
 * - a promoção dá ao cliente um desconto (% de P, R$ no item, ou R$ no pedido ÷ itens, nunca mais que P); o app banca uma
 *   parte (o resto da % que a loja não banca, ou um fixo até o desconto inteiro) e a loja, o resto;
 * - a loja vende B = P − a parte dela; o cliente paga C = P − o desconto inteiro;
 * - a comissão sai sobre a base do app (C, B ou P); o pagamento online e a maquininha, sobre C; a antecipação e o imposto,
 *   sobre B. Ganho líquido = B − taxas − custo fixo do item;
 * - recomendado: o P em que o ganho = margem × B (arredondado para ,90 se a loja quer); mínimo: ganho = 0. Sai por busca (o
 *   ganho só cresce com P).
 */
export function calcular(base: Base, canal: CanalCalc, k: JeitoDeEntregar, t: Taxas, vendas: VendasDaLoja | null, promo: Promo, margem = t.geral.margem): Calculo {
  const app = t[canal];
  const cen = app[k];
  const ef = numerosEfetivos(t, vendas, canal);
  const g = t.geral;
  const n = ef.itensPedido;
  const entrega = base.semEntrega || k !== 'loja' ? 0 : g.entregaLoja;
  const taxaFixa = base.semEntrega || k !== 'app' ? 0 : cen.taxaFixa || 0;
  const taxaFixaItem = taxaFixa / n;
  const fixo = base.custo + base.emb + entrega + taxaFixaItem;
  // no jeito em que a loja entrega, parte dos pedidos é paga na entrega (maquininha); o resto, online
  const pag = k === 'loja' ? (1 - ef.parteNaEntrega / 100) * cen.pag + (ef.parteNaEntrega / 100) * g.maquininha : cen.pag;
  const partes = { comissao: cen.com, pagamento: pag, antecipacao: g.antecipa ? g.antec : 0, imposto: ef.imposto };
  const taxas = (partes.comissao + partes.pagamento + partes.antecipacao + partes.imposto) / 100;
  const porPedido = promo.tipo === 'rsPedido';
  const desconto = (p: number) => {
    if (!promo.ligada) return { cliente: 0, app: 0, loja: 0 };
    const cliente = promo.tipo === 'pct' ? (p * promo.desconto) / 100 : Math.min(p, porPedido ? promo.descontoRs / n : promo.descontoRs);
    const doApp = promo.quemBanca === 'appFixo' ? Math.min(cliente, porPedido ? promo.appFixo / n : promo.appFixo) : cliente * (1 - promo.lojaBanca / 100);
    return { cliente, app: doApp, loja: cliente - doApp };
  };
  const com = (p: number): Resultado => {
    const d = desconto(p);
    const vende = p - d.loja;
    const clientePaga = p - d.cliente;
    const baseComissao = app.baseComissao === 'cheio' ? p : app.baseComissao === 'cliente' ? clientePaga : vende;
    const comissao = (baseComissao * partes.comissao) / 100;
    const pagamento = (clientePaga * partes.pagamento) / 100;
    const antecipacao = (vende * partes.antecipacao) / 100;
    const imposto = (vende * partes.imposto) / 100;
    const taxasR = comissao + pagamento + antecipacao + imposto;
    const lucro = vende - taxasR - fixo;
    return { preco: p, clientePaga, descontoLoja: d.loja, descontoApp: d.app, vende, baseComissao, comissao, pagamento, antecipacao, imposto, taxasR, lucro, margem: vende > 0 ? (lucro / vende) * 100 : 0 };
  };
  const precoPara = (m: number) => {
    const atinge = (p: number) => {
      const x = com(p);
      return x.vende > 0 && x.lucro >= m * x.vende;
    };
    let lo = 0;
    let hi = (fixo + 1) * 50 + 200;
    if (!atinge(hi)) return null;
    for (let i = 0; i < 60; i++) {
      const meio = (lo + hi) / 2;
      if (atinge(meio)) hi = meio;
      else lo = meio;
    }
    return hi;
  };
  const arred = (v: number) => {
    if (!g.arred) return Math.round(v * 100) / 100;
    let r = Math.floor(v) + 0.9;
    if (r < v - 1e-9) r += 1;
    return Math.round(r * 100) / 100;
  };
  // o maior desconto que a loja aguenta bancar sozinha sem prejuízo, no preço dado
  const descontoMax = (p: number) => {
    const outras = (partes.pagamento + partes.antecipacao + partes.imposto) / 100;
    const c = partes.comissao / 100;
    const rs = app.baseComissao === 'cheio' ? p - (fixo + c * p) / (1 - outras) : p - fixo / (1 - taxas);
    return { rs: Math.max(0, rs), pct: p > 0 ? Math.max(0, Math.min(100, (rs / p) * 100)) : 0 };
  };
  const rec = 1 - taxas - margem / 100 > 0.05 ? precoPara(margem / 100) : null;
  const min = 1 - taxas > 0.05 ? precoPara(0) : null;
  return {
    fixo,
    entrega,
    taxaFixa,
    taxaFixaItem,
    n,
    partes,
    imposto: ef.imposto,
    taxas: taxas * 100,
    recomendado: rec == null ? null : arred(rec),
    minimo: min == null ? null : Math.round(min * 100) / 100,
    com,
    descontoMax,
  };
}

/** "12,5%" */
export const pct = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
/** "R$ 12,50" */
export const brl = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));

/** Número digitado ("12,5", "540.000,00") → número; `null` se não dá para ler. */
export function numeroDigitado(v: string): number | null {
  const s = v.replace(/R\$\s*/i, '').trim();
  if (!s) return null;
  const limpo = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(limpo);
  return Number.isFinite(n) ? n : null;
}
