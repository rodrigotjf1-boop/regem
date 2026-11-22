import { compacto, PlanoDoGrafico, reaisCurtos } from './plano-do-grafico';

// OS GRÁFICOS DAS ANÁLISES DO MISTER (versão 7, V7e; protótipo `mockups/regem-mister-v7.html`, aba "Análises (BI)"). O mesmo
// plano e o mesmo desenho dos outros gráficos (`imagem-do-plano.ts`), com os números que `analisar_vendas` já trouxe. Sem
// permissão de ver valores, as colunas e as barras são em pedidos: nenhum R$ entra no plano. Puro.

/** Os tipos do `mostrar_grafico` que saem de uma análise. */
export const TIPOS_DE_GRAFICO_DA_ANALISE = ['pico', 'fases_do_mes', 'cancelamentos_por_causa', 'mercadoria_perdida'] as const;
export type TipoDeGraficoDaAnalise = (typeof TIPOS_DE_GRAFICO_DA_ANALISE)[number];

const MAX_PARTES = 6;
const numero = (n: number): string => n.toLocaleString('pt-BR');

export function planoDoPico(o: {
  loja: string;
  rotulo: string;
  verValores: boolean;
  lidoEm: string;
  diasComVenda: number;
  porHora: Array<{ hora: string; pedidos: number; faturamento: number | null }>;
  faixa: { de: string; ate: string; pedidos: number; faturamento: number | null; partePct: number } | null;
  horasDaFaixa: string[];
}): PlanoDoGrafico {
  const dias = Math.max(1, o.diasComVenda);
  const media = (v: number) => (dias > 1 ? v / dias : v);
  const barras = o.porHora.map((h) => {
    const v = media(o.verValores ? (h.faturamento ?? 0) : h.pedidos);
    return { rotulo: h.hora, valor: v, texto: o.verValores ? compacto(v) : String(Math.round(v * 10) / 10).replace('.', ',') };
  });
  const faixa = o.porHora.flatMap((h, i) => (o.horasDaFaixa.includes(h.hora) ? [i + 1] : []));
  const emMedia = dias > 1 ? `média de ${dias} dias` : '';
  return {
    forma: 'colunas',
    titulo: o.faixa ? `Das ${o.faixa.de} às ${o.faixa.ate} sai ${o.faixa.partePct}% ${o.verValores ? 'da venda' : 'dos pedidos'}` : 'Vendas por hora',
    sub: [o.loja, o.rotulo, emMedia, o.verValores ? 'em reais' : 'em pedidos'].filter(Boolean).join(' · '),
    kpi: o.faixa ? (o.verValores ? reaisCurtos(media(o.faixa.faturamento ?? 0)) : `${numero(Math.round(media(o.faixa.pedidos) * 10) / 10)} pedidos`) : null,
    delta: o.faixa ? { texto: dias > 1 ? 'por dia na faixa de pico' : 'na faixa de pico', tom: 'neutro' } : null,
    barras,
    ...(faixa.length ? { faixa } : {}),
    rodape: `Lido em ${o.lidoEm} · vendas concluídas`,
  };
}

export function planoDasFases(o: {
  loja: string;
  meses: string;
  verValores: boolean;
  lidoEm: string;
  fases: Array<{ fase: string; diasComVenda: number; vendaPorDia: number | null; pedidosPorDia: number }>;
  doComecoParaOFim: { vendaPorDiaPct: number | null; pedidosPorDiaPct: number | null } | null;
}): PlanoDoGrafico {
  const rotulos = ['Dias 1 a 10', 'Dias 11 a 20', 'Dias 21 ao fim'];
  const barras = o.fases.map((f, i) => {
    const v = o.verValores ? (f.vendaPorDia ?? 0) : f.pedidosPorDia;
    return { rotulo: rotulos[i] ?? f.fase, valor: v, texto: o.verValores ? compacto(v) : String(v).replace('.', ',') };
  });
  const pctFim = o.doComecoParaOFim ? (o.verValores ? o.doComecoParaOFim.vendaPorDiaPct : o.doComecoParaOFim.pedidosPorDiaPct) : null;
  const titulo = pctFim === null ? 'A venda nas fases do mês' : pctFim <= -3 ? 'A venda cai ao longo do mês' : pctFim >= 3 ? 'A venda sobe ao longo do mês' : 'A venda fica parecida ao longo do mês';
  const inteiro = pctFim === null ? null : Math.round(pctFim);
  return {
    forma: 'colunas',
    titulo,
    sub: `${o.loja} · ${o.verValores ? 'venda' : 'pedidos'} por dia com venda · ${o.meses}`,
    kpi: null,
    delta: null,
    barras,
    ...(inteiro !== null && barras.length ? { destaque: inteiro < 0 ? barras.length : 1 } : {}),
    rodape: `Lido em ${o.lidoEm} · só os dias em que a loja vendeu`,
  };
}

export function planoDosCancelamentos(o: {
  loja: string;
  rotulo: string;
  verValores: boolean;
  lidoEm: string;
  naoEntrou: { pedidos: number; valor: number | null };
  porCausa: Array<{ causa: string; pedidos: number; valor: number | null }>;
}): PlanoDoGrafico {
  const ordenadas = [...o.porCausa].sort((a, b) => (o.verValores ? (b.valor ?? 0) - (a.valor ?? 0) : b.pedidos - a.pedidos));
  const cabem = ordenadas.slice(0, ordenadas.length > MAX_PARTES ? MAX_PARTES - 1 : MAX_PARTES);
  const resto = ordenadas.slice(cabem.length);
  const linhas = resto.length
    ? [...cabem, { causa: `Outras ${resto.length} causas`, pedidos: resto.reduce((s, x) => s + x.pedidos, 0), valor: resto.reduce((s, x) => s + (x.valor ?? 0), 0) }]
    : cabem;
  return {
    forma: 'horizontais',
    titulo: o.verValores ? `Cancelamentos: ${reaisCurtos(o.naoEntrou.valor ?? 0)} não entraram` : `Cancelamentos: ${numero(o.naoEntrou.pedidos)} pedidos`,
    sub: `${o.loja} · ${numero(o.naoEntrou.pedidos)} pedidos · ${o.rotulo} · por causa`,
    kpi: null,
    delta: null,
    partes: linhas.map((x) => ({
      nome: `${x.causa} (${x.pedidos})`,
      valor: o.verValores ? (x.valor ?? 0) : x.pedidos,
      texto: o.verValores ? reaisCurtos(x.valor ?? 0) : numero(x.pedidos),
    })),
    rodape: `Lido em ${o.lidoEm} · sem pedidos de teste`,
  };
}

/** A mercadoria perdida é em reais (somar quilo com unidade não diz nada): sem valores não há gráfico, e quem chama recusa. */
export function planoDaMercadoria(o: {
  loja: string;
  rotulo: string;
  lidoEm: string;
  valorPerdido: number | null;
  desperdicio: Array<{ item: string; valor: number | null }>;
  faltou: Array<{ item: string; valor: number | null }>;
}): PlanoDoGrafico {
  const todos = [
    ...o.desperdicio.filter((x) => x.valor !== null).map((x) => ({ nome: x.item, valor: x.valor as number })),
    ...o.faltou.filter((x) => x.valor !== null).map((x) => ({ nome: `${x.item} (contagem)`, valor: x.valor as number })),
  ]
    .filter((x) => x.valor > 0)
    .sort((a, b) => b.valor - a.valor);
  const cabem = todos.slice(0, todos.length > MAX_PARTES ? MAX_PARTES - 1 : MAX_PARTES);
  const resto = todos.slice(cabem.length);
  const partes = resto.length ? [...cabem, { nome: 'Outros', valor: resto.reduce((s, x) => s + x.valor, 0) }] : cabem;
  return {
    forma: 'horizontais',
    titulo: `Mercadoria perdida: ${reaisCurtos(o.valorPerdido ?? 0)}`,
    sub: `${o.loja} · ${o.rotulo} · desperdício e diferença na contagem`,
    kpi: null,
    delta: null,
    partes: partes.map((x) => ({ nome: x.nome, valor: x.valor, texto: reaisCurtos(x.valor) })),
    rodape: `Lido em ${o.lidoEm} · só o que tem custo no Estoque`,
  };
}
