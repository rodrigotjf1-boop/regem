import { PlanoDoGrafico, reaisCurtos, valeOPlano, variacao } from './plano-do-grafico';

// O PLANO DO RESUMO DO DIA E DA SEMANA EM ARQUIVO E NO LINK (versão 5, M5e; protótipo
// `mockups/regem-mister-ouve-ve-mostra.html`, aba "Arquivo e link", e a decisão 8: o resumo é texto com os botões
// "📄 PDF" e "📊 Ver gráficos", e os dois mostram o mesmo conteúdo). O texto do resumo é da IA; o PDF e a página do link
// saem DAQUI, só com os números do Regem: os números grandes, os gráficos (os mesmos planos da M5d.2 — o mesmo desenho
// da imagem da conversa) e os pontos de atenção. Puro: sem banco e sem desenho.

export type TipoDoResumo = 'resumo_dia' | 'resumo_semana';
/** O plano em arquivo e no link: o de um resumo, ou o de UM gráfico da conversa (o "📄 PDF" e o "🔗 Ver no link" da M5d). */
export type TipoDoPlano = TipoDoResumo | 'grafico';
export type AbaDoResumoId = 'hora' | 'dias' | 'canais' | 'produtos';

export interface NumeroDoResumo {
  valor: string;
  rotulo: string;
  /** A comparação ou o detalhe embaixo ("53% a mais que a quarta passada", "R$ 1.040"). */
  nota: string | null;
  tom: 'bom' | 'ruim' | 'neutro' | null;
}
export interface AtencaoDoResumo {
  oque: string;
  detalhe: string;
  valor: string;
}
export interface AbaDoResumo {
  id: AbaDoResumoId;
  nome: string;
  grafico: PlanoDoGrafico;
}

export interface PlanoDoResumo {
  versao: 1;
  tipo: TipoDoPlano;
  empresa: string;
  loja: string;
  titulo: string;
  /** "19/11 às 09:00": quando os números foram lidos. */
  lidoEm: string;
  numeros: NumeroDoResumo[];
  abas: AbaDoResumo[];
  atencao: AtencaoDoResumo[];
  fonte: string;
  /** O perfil de quem recebeu não mostra valores em reais: só quantidades. */
  semValores: boolean;
}

/** O que o serviço lê do Regem para montar o plano (já no escopo de quem recebe o resumo). */
export interface DadosDoResumo {
  tipo: TipoDoResumo;
  empresa: string;
  loja: string;
  /** O dia do resumo do dia, ou o primeiro dia da semana. */
  referencia: string;
  /** O último dia (igual à referência no resumo do dia). */
  ate: string;
  lidoEm: string;
  verValores: boolean;
  atual: { vendas: number; faturado: number | null; ticket: number | null };
  anterior: { vendas: number; faturado: number | null } | null;
  /** Com quem se compara: "a quarta passada", "a semana anterior". */
  contra: string;
  pico: { hora: string; total: number | null; vendas: number } | null;
  cancelamentos: { quantos: number; valor: number | null; linhas: AtencaoDoResumo[] } | null;
  estoque: AtencaoDoResumo[];
  graficos: Partial<Record<AbaDoResumoId, PlanoDoGrafico>>;
}

/** Quantas linhas de atenção cabem (os cancelamentos primeiro, depois o estoque). */
export const ATENCAO_MAX = 12;

const NOME_DO_DIA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const ddmmaaaa = (dia: string) => `${ddmm(dia)}/${dia.slice(0, 4)}`;
const nomeDoDia = (dia: string) => NOME_DO_DIA[new Date(`${dia}T12:00:00Z`).getUTCDay()];

/** "Resumo de quarta, 18/11/2026" / "Resumo da semana, 12/11 a 18/11/2026". */
export function tituloDoResumo(tipo: TipoDoResumo, referencia: string, ate: string): string {
  return tipo === 'resumo_dia' ? `Resumo de ${nomeDoDia(referencia)}, ${ddmmaaaa(referencia)}` : `Resumo da semana, ${ddmm(referencia)} a ${ddmmaaaa(ate)}`;
}

/** "a quarta passada" (o mesmo dia da semana anterior) ou "a semana anterior". */
export function contraDoResumo(tipo: TipoDoResumo, referencia: string): string {
  if (tipo === 'resumo_semana') return 'a semana anterior';
  const d = nomeDoDia(referencia);
  return `${d === 'sábado' || d === 'domingo' ? 'o' : 'a'} ${d} ${d === 'sábado' || d === 'domingo' ? 'passado' : 'passada'}`;
}

/** O nome do arquivo, só com letras sem acento (o cabeçalho do download não aceita acento): "resumo-2026-11-18.pdf". */
export function nomeDoPdfDoResumo(tipo: TipoDoResumo, referencia: string, ate: string): string {
  return tipo === 'resumo_dia' ? `resumo-${referencia}.pdf` : `resumo-semana-${referencia}-a-${ate}.pdf`;
}

/** "53% a mais que a quarta passada" / "8% a menos que …" / "igual a …". */
function comparacao(atual: number, antes: number, contra: string): { nota: string; tom: NumeroDoResumo['tom'] } | null {
  const v = variacao(atual, antes);
  if (v === null) return null;
  if (v === 0) return { nota: `igual ${contra.replace(/^a /, 'à ').replace(/^o /, 'ao ')}`, tom: 'neutro' };
  return { nota: `${Math.abs(v)}% a ${v > 0 ? 'mais' : 'menos'} que ${contra}`, tom: v > 0 ? 'bom' : 'ruim' };
}

const NOME_DA_ABA: Record<AbaDoResumoId, string> = { hora: 'Por hora', dias: 'Por dia', canais: 'Canais', produtos: 'Produtos' };

export function montarPlanoDoResumo(d: DadosDoResumo): PlanoDoResumo {
  const numeros: NumeroDoResumo[] = [];
  if (d.verValores && d.atual.faturado != null) {
    const c = d.anterior?.faturado != null ? comparacao(d.atual.faturado, d.anterior.faturado, d.contra) : null;
    numeros.push({ valor: reaisCurtos(d.atual.faturado), rotulo: 'faturamento', nota: c?.nota ?? null, tom: c?.tom ?? null });
  }
  {
    const c = !d.verValores && d.anterior ? comparacao(d.atual.vendas, d.anterior.vendas, d.contra) : null;
    numeros.push({ valor: d.atual.vendas.toLocaleString('pt-BR'), rotulo: d.atual.vendas === 1 ? 'venda' : 'vendas', nota: c?.nota ?? null, tom: c?.tom ?? null });
  }
  if (d.verValores && d.atual.ticket != null && d.atual.vendas > 0) numeros.push({ valor: reaisCurtos(d.atual.ticket), rotulo: 'ticket médio', nota: null, tom: null });
  if (d.pico && d.pico.vendas > 0)
    numeros.push({ valor: d.pico.hora, rotulo: 'pico', nota: d.verValores && d.pico.total != null ? reaisCurtos(d.pico.total) : `${d.pico.vendas} vendas`, tom: null });
  if (d.cancelamentos)
    numeros.push({
      valor: d.cancelamentos.quantos.toLocaleString('pt-BR'),
      rotulo: d.cancelamentos.quantos === 1 ? 'cancelamento' : 'cancelamentos',
      nota: d.verValores && d.cancelamentos.valor != null && d.cancelamentos.quantos > 0 ? reaisCurtos(d.cancelamentos.valor) : null,
      tom: null,
    });

  // As abas na ordem do protótipo: por hora (o dia) ou por dia (a semana) primeiro. Só as que têm o que mostrar.
  const ordem: AbaDoResumoId[] = d.tipo === 'resumo_dia' ? ['hora', 'canais', 'dias', 'produtos'] : ['dias', 'canais', 'produtos', 'hora'];
  const abas: AbaDoResumo[] = [];
  for (const id of ordem) {
    const g = d.graficos[id];
    if (g && valeOPlano(g)) abas.push({ id, nome: id === 'dias' && d.tipo === 'resumo_dia' ? '7 dias' : NOME_DA_ABA[id], grafico: g });
  }

  const atencao = [...(d.cancelamentos?.linhas ?? []), ...d.estoque].slice(0, ATENCAO_MAX);
  return {
    versao: 1,
    tipo: d.tipo,
    empresa: d.empresa,
    loja: d.loja,
    titulo: tituloDoResumo(d.tipo, d.referencia, d.ate),
    lidoEm: d.lidoEm,
    numeros: numeros.slice(0, 5),
    abas,
    atencao,
    fonte: `Dados do Regem lidos em ${d.lidoEm} · vendas concluídas${d.verValores ? ' · a gorjeta não entra no faturamento' : ' · sem valores em reais (o perfil de quem recebeu não mostra)'}.`,
    semValores: !d.verValores,
  };
}

/** O plano tem o que mostrar? (Um dia sem venda não vira PDF nem link: o texto já diz.) */
export const resumoTemConteudo = (p: PlanoDoResumo): boolean => p.abas.length > 0 || p.atencao.length > 0;

// ── Um gráfico da conversa em arquivo e no link (o "📄 PDF" e o "🔗 Ver no link" da conversa 6 do protótipo) ────────

/** Os gráficos do `mostrar_grafico` e a aba de cada um. */
export const TIPOS_DO_GRAFICO = ['vendas_por_dia', 'vendas_por_hora', 'canais', 'mais_vendidos'] as const;
export type TipoDoGrafico = (typeof TIPOS_DO_GRAFICO)[number];
const ABA_DO_GRAFICO: Record<TipoDoGrafico, AbaDoResumoId> = { vendas_por_dia: 'dias', vendas_por_hora: 'hora', canais: 'canais', mais_vendidos: 'produtos' };

/** O plano de UM gráfico: o título com o período, o número principal com a comparação e a aba dele. */
export function planoDeUmGrafico(o: { tipo: TipoDoGrafico; grafico: PlanoDoGrafico; empresa: string; loja: string; periodo: string; lidoEm: string; verValores: boolean }): PlanoDoResumo {
  const g = o.grafico;
  return {
    versao: 1,
    tipo: 'grafico',
    empresa: o.empresa,
    loja: o.loja,
    titulo: `${g.titulo} · ${o.periodo}`.slice(0, 300),
    lidoEm: o.lidoEm,
    numeros: g.kpi ? [{ valor: g.kpi, rotulo: 'total', nota: g.delta?.texto ?? null, tom: g.delta?.tom ?? null }] : [],
    abas: [{ id: ABA_DO_GRAFICO[o.tipo], nome: g.titulo.slice(0, 40), grafico: g }],
    atencao: [],
    fonte: `Dados do Regem lidos em ${o.lidoEm} · vendas concluídas${o.verValores ? '' : ' · sem valores em reais (o perfil de quem pediu não mostra)'}.`,
    semValores: !o.verValores,
  };
}

/** "grafico-vendas-por-dia-2026-11-12-a-2026-11-18.pdf" (sem acento: o cabeçalho do download não aceita). */
export const nomeDoPdfDoGrafico = (tipo: TipoDoGrafico, de: string, ate: string): string =>
  `grafico-${tipo.replace(/_/g, '-')}-${de === ate ? de : `${de}-a-${ate}`}.pdf`;

/**
 * O botão do gráfico leva o que refaz o gráfico no escopo de quem toca: a empresa (conferida contra os vínculos do
 * telefone), o gráfico, o período e a loja escolhida (ou nenhuma). Nada vale por si: o toque refaz tudo de novo.
 */
export const PREFIXO_DO_GRAFICO = 'grf:';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIA = /^\d{4}-\d{2}-\d{2}$/;
export const botaoDoGrafico = (acao: 'pdf' | 'link', b: { tenantId: string; tipo: TipoDoGrafico; de: string; ate: string; loja: string | null }): string =>
  `${PREFIXO_DO_GRAFICO}${acao}:${b.tenantId}:${b.tipo}:${b.de}:${b.ate}${b.loja ? `:${b.loja}` : ''}`;
export function lerBotaoDoGrafico(id: string): { acao: 'pdf' | 'link'; tenantId: string; tipo: TipoDoGrafico; de: string; ate: string; loja: string | null } | null {
  const p = String(id ?? '').split(':');
  if (p[0] !== 'grf' || (p[1] !== 'pdf' && p[1] !== 'link') || (p.length !== 6 && p.length !== 7)) return null;
  const [, acao, tenantId, tipo, de, ate, loja] = p;
  if (!UUID.test(tenantId) || !(TIPOS_DO_GRAFICO as readonly string[]).includes(tipo) || !DIA.test(de) || !DIA.test(ate) || de > ate) return null;
  if (loja !== undefined && !UUID.test(loja)) return null;
  return { acao: acao as 'pdf' | 'link', tenantId, tipo: tipo as TipoDoGrafico, de, ate, loja: loja ?? null };
}

// ── A conferência do plano guardado (o link público só abre o que a página sabe desenhar) ──────────────────────────

const texto = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const TOMS = ['bom', 'ruim', 'neutro'];
const FORMAS = ['colunas', 'participacao', 'horizontais'];
const ABAS: readonly string[] = ['hora', 'dias', 'canais', 'produtos'];

function ehGrafico(g: any): g is PlanoDoGrafico {
  if (!g || typeof g !== 'object' || !FORMAS.includes(g.forma) || !texto(g.titulo, 200) || !texto(g.sub, 300) || !texto(g.rodape, 300)) return false;
  if (g.kpi !== null && !texto(g.kpi, 80)) return false;
  if (g.delta !== null && !(g.delta && texto(g.delta.texto, 200) && TOMS.includes(g.delta.tom))) return false;
  if (g.legenda !== undefined && !(Array.isArray(g.legenda) && g.legenda.length <= 4 && g.legenda.every((l: unknown) => texto(l, 80)))) return false;
  if (g.forma === 'colunas')
    return (
      Array.isArray(g.barras) &&
      g.barras.length <= 62 &&
      g.barras.every(
        (b: any) =>
          b && texto(b.rotulo, 40) && (b.rotulo2 === undefined || texto(b.rotulo2, 40)) && Number.isFinite(b.valor) && texto(b.texto, 40) && (b.anterior === undefined || Number.isFinite(b.anterior)),
      )
    );
  return Array.isArray(g.partes) && g.partes.length <= 12 && g.partes.every((p: any) => p && texto(p.nome, 200) && Number.isFinite(p.valor) && texto(p.texto, 80));
}

/** O plano guardado tem a forma do plano do resumo? (Uma linha com outra forma NÃO abre: a página diz que o link não vale.) */
export function ehPlanoDoResumo(p: unknown): p is PlanoDoResumo {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
  const x = p as Record<string, any>;
  if (x.versao !== 1 || !['resumo_dia', 'resumo_semana', 'grafico'].includes(x.tipo) || typeof x.semValores !== 'boolean') return false;
  if (!texto(x.empresa, 300) || !texto(x.loja, 300) || !texto(x.titulo, 300) || !texto(x.lidoEm, 80) || !texto(x.fonte, 600)) return false;
  if (!Array.isArray(x.numeros) || x.numeros.length > 6) return false;
  if (!x.numeros.every((n: any) => n && texto(n.valor, 80) && texto(n.rotulo, 120) && (n.nota === null || texto(n.nota, 200)) && (n.tom === null || TOMS.includes(n.tom)))) return false;
  if (!Array.isArray(x.abas) || x.abas.length > 4 || !x.abas.every((a: any) => a && ABAS.includes(a.id) && texto(a.nome, 40) && ehGrafico(a.grafico))) return false;
  return Array.isArray(x.atencao) && x.atencao.length <= ATENCAO_MAX && x.atencao.every((a: any) => a && texto(a.oque, 80) && texto(a.detalhe, 300) && texto(a.valor, 80));
}
