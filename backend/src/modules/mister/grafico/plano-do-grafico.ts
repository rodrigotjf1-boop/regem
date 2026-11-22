// O PLANO DE UM GRÁFICO DO MISTER (versão 5, M5d.2; protótipo `mockups/regem-mister-ouve-ve-mostra.html`, aba "Gráficos"):
// o que a imagem mostra, montado só pelo código a partir dos números do Regem (a IA escolhe o gráfico e escreve a
// conversa; os números, as barras e o texto do gráfico saem daqui). Três formas: COLUNAS (por dia, com o período anterior
// ao lado, ou por hora), PARTICIPAÇÃO (quanto cada canal do delivery fez do total) e HORIZONTAIS (os mais vendidos).
// Puro: sem banco e sem desenho — o desenho é `imagem-do-plano.ts`.

// Versão 6, M6i: mais duas formas para o "refazer" (`refazer-do-grafico.ts`) — a TABELA (uma linha por item, o valor à
// direita) e a LINHA (a série por dia ou por hora ligada ponto a ponto).
export type FormaDoGrafico = 'colunas' | 'participacao' | 'horizontais' | 'tabela' | 'linha';

export interface BarraDoPlano {
  /** O rótulo embaixo (uma ou duas linhas: "Qui" e "12"). */
  rotulo: string;
  rotulo2?: string;
  valor: number;
  texto: string;
  /** O mesmo ponto no período anterior (as colunas comparadas). */
  anterior?: number;
}

export interface ParteDoPlano {
  nome: string;
  valor: number;
  texto: string;
}

export interface PlanoDoGrafico {
  forma: FormaDoGrafico;
  titulo: string;
  sub: string;
  /** O número principal, grande ("R$ 38.420", "86 pedidos"). */
  kpi: string | null;
  /** A comparação ou o destaque ao lado do número ("▲ 12% sobre a semana anterior", "pico às 21h"). */
  delta: { texto: string; tom: 'bom' | 'ruim' | 'neutro' } | null;
  barras?: BarraDoPlano[];
  partes?: ParteDoPlano[];
  /** A legenda das colunas comparadas. */
  legenda?: string[];
  rodape: string;
  /** Versão 6, M6i: a posição (1 = o primeiro) do item em dourado — sem ela, o maior (ou o primeiro). */
  destaque?: number;
  /** Versão 7, V7e: as posições (1 = a primeira) da FAIXA em dourado, nas colunas (o pico de duas ou três horas). */
  faixa?: number[];
  /** Versão 6, M6i: sem os valores escritos em cima das barras (a pessoa pediu "mais limpo"). */
  semValores?: boolean;
}

const DIA_DA_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** "R$ 38.420" (sem centavos acima de mil; com centavos abaixo). */
export function reaisCurtos(v: number): string {
  const n = Number(v) || 0;
  return Math.abs(n) >= 1000 ? `R$ ${Math.round(n).toLocaleString('pt-BR')}` : `R$ ${n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "5,4 mil" acima de mil; o número inteiro abaixo (o valor que cabe em cima da barra). */
export function compacto(v: number): string {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `${(Math.round(n / 100) / 10).toLocaleString('pt-BR')} mil`;
  return Math.round(n).toLocaleString('pt-BR');
}

/** A variação em %, arredondada, ou null (sem base para comparar). */
export function variacao(atual: number, antes: number): number | null {
  if (!Number.isFinite(atual) || !Number.isFinite(antes) || antes <= 0) return null;
  return Math.round(((atual - antes) / antes) * 100);
}

/**
 * O "+12% sobre a semana anterior" (ou "-8% …", ou "igual ao que foi …"). `contra` = "a semana anterior", "o período
 * anterior". Só caracteres que o atlas da imagem tem (o "▲" não tem: sairia "?").
 */
export function deltaDe(atual: number, antes: number, contra: string): PlanoDoGrafico['delta'] {
  const v = variacao(atual, antes);
  if (v === null) return null;
  if (v === 0) return { texto: `igual ${contra.replace(/^a /, 'à ').replace(/^o /, 'ao ')}`, tom: 'neutro' };
  return { texto: `${v > 0 ? '+' : '-'}${Math.abs(v)}% sobre ${contra}`, tom: v > 0 ? 'bom' : 'ruim' };
}

/** "Qui" e "12" de "2026-11-12" (o dia da semana pela data, sem fuso: é um dia do calendário). */
export function rotuloDoDia(dia: string): { rotulo: string; rotulo2: string } {
  const [a, m, d] = String(dia).slice(0, 10).split('-').map(Number);
  if (!a || !m || !d) return { rotulo: String(dia), rotulo2: '' };
  const semana = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return { rotulo: DIA_DA_SEMANA[semana], rotulo2: String(d).padStart(2, '0') };
}

type Dia = { dia: string; total: number | null; vendas: number };

/**
 * As vendas por dia, com o período anterior ao lado (o mesmo número de dias, ponto a ponto). Sem `verValores`, conta as
 * vendas (nunca reais). `porDia` vem do relatório de vendas (os dias com venda); os dias sem venda entram com zero.
 */
export function planoVendasPorDia(o: {
  loja: string;
  rotuloDoPeriodo: string;
  dias: string[];
  porDia: Dia[];
  anteriores: Dia[] | null;
  diasAnteriores: string[];
  verValores: boolean;
  lidoEm: string;
  contra: string;
}): PlanoDoGrafico {
  const valorDe = (d: Dia | undefined) => (d ? (o.verValores ? Number(d.total) || 0 : d.vendas) : 0);
  const porData = new Map(o.porDia.map((d) => [d.dia, d]));
  const antPorData = new Map((o.anteriores ?? []).map((d) => [d.dia, d]));
  const barras: BarraDoPlano[] = o.dias.map((dia, i) => {
    const v = valorDe(porData.get(dia));
    const ant = o.anteriores ? valorDe(antPorData.get(o.diasAnteriores[i])) : undefined;
    return { ...rotuloDoDia(dia), valor: v, texto: o.verValores ? compacto(v) : String(v), ...(ant !== undefined ? { anterior: ant } : {}) };
  });
  const soma = barras.reduce((s, b) => s + b.valor, 0);
  const somaAnt = barras.reduce((s, b) => s + (b.anterior ?? 0), 0);
  return {
    forma: 'colunas',
    titulo: o.verValores ? 'Vendas por dia' : 'Vendas por dia (quantidade)',
    sub: `${o.loja} · ${o.rotuloDoPeriodo}`,
    kpi: o.verValores ? reaisCurtos(soma) : `${soma.toLocaleString('pt-BR')} vendas`,
    delta: o.anteriores ? deltaDe(soma, somaAnt, o.contra) : null,
    barras,
    legenda: o.anteriores ? ['este período', o.contra.replace(/^(d[oa]s?|a|o)\s+/, ''), 'o melhor dia'] : ['o melhor dia'],
    rodape: `Lido em ${o.lidoEm} · vendas concluídas`,
  };
}

/** As vendas por hora (o pico em dourado). */
export function planoVendasPorHora(o: { loja: string; rotuloDoPeriodo: string; porHora: Array<{ hora: string; total: number | null; vendas: number }>; verValores: boolean; lidoEm: string }): PlanoDoGrafico {
  const horas = o.porHora.filter((h) => h.vendas > 0 || (Number(h.total) || 0) > 0);
  const barras: BarraDoPlano[] = horas.map((h) => {
    const v = o.verValores ? Number(h.total) || 0 : h.vendas;
    return { rotulo: h.hora, valor: v, texto: o.verValores ? compacto(v) : String(v) };
  });
  const soma = barras.reduce((s, b) => s + b.valor, 0);
  const pico = barras.reduce<BarraDoPlano | null>((m, b) => (!m || b.valor > m.valor ? b : m), null);
  return {
    forma: 'colunas',
    titulo: o.verValores ? 'Vendas por hora' : 'Vendas por hora (quantidade)',
    sub: `${o.loja} · ${o.rotuloDoPeriodo}`,
    kpi: o.verValores ? reaisCurtos(soma) : `${soma.toLocaleString('pt-BR')} vendas`,
    delta: pico && pico.valor > 0 ? { texto: `pico às ${pico.rotulo}`, tom: 'neutro' } : null,
    barras,
    rodape: `Lido em ${o.lidoEm} · vendas concluídas`,
  };
}

/** O delivery por canal (iFood, 99, cardápio…): quanto cada um fez do total. Só com valores em reais (a rota também). */
export function planoCanais(o: { loja: string; rotuloDoPeriodo: string; porPlataforma: Array<{ plataforma: string; total: number | null; pedidos: number }>; lidoEm: string }): PlanoDoGrafico {
  const partes = o.porPlataforma
    .map((p) => ({ nome: nomeDoCanal(p.plataforma), valor: Number(p.total) || 0, texto: reaisCurtos(Number(p.total) || 0) }))
    .filter((p) => p.valor > 0)
    .sort((a, b) => b.valor - a.valor)
    .slice(0, 6);
  const soma = partes.reduce((s, p) => s + p.valor, 0);
  return {
    forma: 'participacao',
    titulo: 'Delivery por canal',
    sub: `${o.loja} · ${o.rotuloDoPeriodo}`,
    kpi: reaisCurtos(soma),
    delta: null,
    partes,
    rodape: `Lido em ${o.lidoEm} · pedidos aceitos, sem os cancelados`,
  };
}

/** Os mais vendidos por quantidade (o primeiro em dourado); o faturamento ao lado só para quem vê valores. */
export function planoMaisVendidos(o: { loja: string; rotuloDoPeriodo: string; itens: Array<{ nome: string; quantidade: number; total: number | null }>; verValores: boolean; lidoEm: string }): PlanoDoGrafico {
  const itens = o.itens.filter((i) => i.quantidade > 0).slice(0, 6);
  const partes = itens.map((i) => ({
    nome: i.nome,
    valor: i.quantidade,
    texto: `${i.quantidade.toLocaleString('pt-BR')} un${o.verValores && i.total != null ? ` · ${reaisCurtos(i.total)}` : ''}`,
  }));
  const soma = itens.reduce((s, i) => s + i.quantidade, 0);
  return {
    forma: 'horizontais',
    titulo: 'Mais vendidos',
    sub: `${o.loja} · ${o.rotuloDoPeriodo} · por quantidade`,
    kpi: `${soma.toLocaleString('pt-BR')} unidades`,
    delta: null,
    partes,
    rodape: `Lido em ${o.lidoEm}`,
  };
}

/** O nome do canal como a loja fala. */
export function nomeDoCanal(p: string): string {
  const c = String(p ?? '').trim().toLowerCase();
  if (c === 'ifood') return 'iFood';
  if (c === '99food' || c === '99') return '99Food';
  if (c === 'cardapio' || c === 'cardápio') return 'Cardápio digital';
  if (c === 'totem') return 'Totem';
  if (c === 'balcao' || c === 'balcão') return 'Balcão';
  if (c === 'whatsapp') return 'WhatsApp';
  if (!c) return 'Outro';
  return c.charAt(0).toUpperCase() + c.slice(1);
}

/** Vale a imagem? Colunas: 2 ou mais com algum valor. Participação e horizontais: 2 ou mais partes. */
export function valeOPlano(p: PlanoDoGrafico): boolean {
  if (p.forma === 'colunas') return (p.barras?.length ?? 0) >= 2 && (p.barras ?? []).some((b) => b.valor > 0);
  return (p.partes?.length ?? 0) >= 2;
}
