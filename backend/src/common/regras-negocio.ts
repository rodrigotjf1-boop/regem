// Regras de negócio críticas do Regem, isoladas como funções puras para teste.
// Os services importam daqui — os testes cobrem o código realmente usado.
import { linhaEntra, type CanalDaFicha } from './embalagem-da-ficha';

/**
 * Custo médio ponderado móvel (recebimento de estoque).
 * novo = (saldoBase × custoMédioAtual + qtdEntrada × custoEntrada) / (saldoBase + qtdEntrada)
 * - saldoBase 0  → assume o custo da entrada;
 * - custoEntrada null → não altera (item recebido sem custo informado);
 * - custoMédioAtual 0 com saldo → o saldo tem custo DESCONHECIDO (contado sem custo, como a carga de 25/11/2026): assume o custo
 *   da entrada. Antes, esse saldo pesava como R$ 0 e a primeira compra derrubava o custo médio (o blend comprado a R$ 31,99 ficou
 *   em R$ 19,10, e o CMV saía baixo — ERR-630).
 */
export function custoMedioPonderado(
  saldoBase: number,
  custoMedioAtual: number,
  qtdEntrada: number,
  custoEntrada: number | null,
): number {
  if (custoEntrada == null) return custoMedioAtual;
  if (!(custoMedioAtual > 0)) return custoEntrada;
  const base = Math.max(saldoBase, 0);
  const denom = base + qtdEntrada;
  if (denom <= 0) return custoEntrada;
  return (base * custoMedioAtual + qtdEntrada * custoEntrada) / denom;
}

/**
 * Explosão de ficha técnica (baixa por venda/produção):
 * quanto de UM ingrediente sai ao produzir/vender `qtdProduzida` unidades da ficha.
 *   qtd_baixa = qtd_liquida × fc × qtdProduzida ÷ rendimento
 */
export function qtdBaixaExplosao(
  qtdLiquida: number,
  fc: number,
  qtdProduzida: number,
  rendimento: number,
): number {
  const rend = rendimento > 0 ? rendimento : 1;
  return (qtdLiquida * fc * qtdProduzida) / rend;
}

/**
 * Minutos de um intervalo [iniMs, fimMs] que caem na faixa noturna (22:00–05:00).
 * Hora local do Brasil = UTC−3 (sem horário de verão desde 2019). Prévia gerencial.
 */
export function minutosNaFaixaNoturna(iniMs: number, fimMs: number): number {
  let n = 0;
  for (let t = iniMs; t < fimMs; t += 60000) {
    const h = new Date(t - 3 * 3600000).getUTCHours(); // hora local BR
    if (h >= 22 || h < 5) n++;
  }
  return n;
}

/** Fator de hora extra: 100% (1.0) em domingo/feriado; 50% (0.5) em dia útil. */
export function fatorHoraExtra(ehDomingoOuFeriado: boolean): number {
  return ehDomingoOuFeriado ? 1.0 : 0.5;
}

/**
 * Furo de CMV (§1.3): parte do desvio não explicada pelo desperdício registrado.
 *   furo = desvio − desperdício_valorizado
 * Pode ser negativo (desperdício registrado maior que o desvio apurado).
 */
export function furoCmv(desvio: number, desperdicioValor: number): number {
  return desvio - desperdicioValor;
}

function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '') // remove acentos
    .trim();
}

export type RegraBot = {
  id: string;
  gatilhos: string; // palavras-chave separadas por vírgula
  ativa: boolean;
};

/**
 * Casa a pergunta contra as regras do bot: 1ª regra ATIVA cujo algum gatilho
 * (normalizado, sem acento/caixa) apareça na pergunta. Sem match → null.
 */
export function casarRegraBot<T extends RegraBot>(
  pergunta: string,
  regras: T[],
): T | null {
  const p = normalizar(pergunta);
  for (const r of regras) {
    if (!r.ativa) continue;
    const gatilhos = r.gatilhos
      .split(',')
      .map((g) => normalizar(g))
      .filter(Boolean);
    if (gatilhos.some((g) => p.includes(g))) return r;
  }
  return null;
}

// ── Fichas técnicas aninhadas ────────────────────────────────────────────────
export type IngredienteCusto = {
  quantidade: number;
  fatorCorrecao: number;
  custoUnitario: number;
  subFichaId?: string | null;
  // A linha usa um produto do estoque FEITO NA LOJA (mig 314): a ficha que o produz. O custo da
  // linha vem dela (custo total ÷ rendimento) — a ligação exige que ela renda na unidade do produto.
  fichaDoItemId?: string | null;
  // Linha de custo só contabilizada em pedido externo (delivery) — ex.: embalagem.
  somenteDelivery?: boolean;
  // Linha de custo só contabilizada na venda de balcão, mesa e totem — a embalagem do balcão (mig 317).
  somenteBalcao?: boolean;
};
export type FichaCusto = {
  rendimento: number;
  ingredientes: IngredienteCusto[];
  // Margem de perda em % (mig 318): somada ao custo INTEIRO da ficha — ingredientes, sub-receitas e a
  // embalagem da venda. Sem margem = 0.
  margemPerda?: number;
};

/**
 * O custo de UMA linha de ficha, a regra única da tela e do Mister: a linha ligada a um item do estoque usa o custo médio atual dele
 * (quem chama resolve o da loja, se houver; senão, o do cadastro); sem custo médio, ou sem item, vale o valor gravado na linha. Zero
 * é "sem custo". `ficha_ingrediente.custo_unitario` é a cópia de quando a ficha foi salva e nada aqui a regrava.
 */
export function custoDaLinhaDaFicha(custoGravado: unknown, custoMedioDoItem?: number | null): number {
  const medio = Number(custoMedioDoItem);
  if (medio > 0) return medio;
  const gravado = Number(custoGravado);
  return gravado > 0 ? gravado : 0;
}

/**
 * Custo total (do lote inteiro = rendimento) de uma ficha, resolvendo sub-fichas
 * recursivamente: uma sub-ficha entra pelo seu custo/porção (custoTotal ÷ rendimento).
 * Guarda de ciclo: uma ficha já visitada na cadeia contribui 0 (safety net —
 * ciclos são barrados na escrita). Ficha ausente do mapa contribui 0.
 */
export function custoTotalFicha(
  fichaId: string,
  mapa: Record<string, FichaCusto>,
  // Para que venda: `nenhum` = só os ingredientes; `balcao` e `delivery` somam a embalagem de cada
  // um. `mesmaEmbalagem` = a chave da empresa (a do delivery vale para as duas vendas).
  // A regra de quem entra: `common/embalagem-da-ficha.ts`.
  canal: CanalDaFicha = 'nenhum',
  mesmaEmbalagem = false,
  visitados: Set<string> = new Set(),
): number {
  if (visitados.has(fichaId)) return 0;
  const ficha = mapa[fichaId];
  if (!ficha) return 0;
  const proximos = new Set(visitados);
  proximos.add(fichaId);

  let total = 0;
  for (const ing of ficha.ingredientes) {
    // Embalagem de outro canal não entra neste custo.
    if (!linhaEntra(ing, canal, mesmaEmbalagem)) continue;
    let custoUnit = Number(ing.custoUnitario) || 0;
    if (ing.subFichaId) {
      const sub = mapa[ing.subFichaId];
      const rendSub = sub && Number(sub.rendimento) > 0 ? Number(sub.rendimento) : 1;
      custoUnit = custoTotalFicha(ing.subFichaId, mapa, canal, mesmaEmbalagem, proximos) / rendSub;
    } else if (ing.fichaDoItemId) {
      // Produto feito na loja: o custo é o da ficha dele, sempre atualizado com o preço dos
      // ingredientes (só os ingredientes — embalagem, de balcão ou de delivery, não é custo do insumo). Se a
      // ficha dele ainda não tem custo, fica o que está gravado na linha.
      const feita = mapa[ing.fichaDoItemId];
      const rendFeita = feita && Number(feita.rendimento) > 0 ? Number(feita.rendimento) : 1;
      const pelaFicha = custoTotalFicha(ing.fichaDoItemId, mapa, 'nenhum', false, proximos) / rendFeita;
      if (pelaFicha > 0) custoUnit = pelaFicha;
    }
    total += Number(ing.quantidade) * Number(ing.fatorCorrecao) * custoUnit;
  }
  // Margem de perda da ficha (pedido do dono, 14/10/2026: "levar em consideração a ficha completa").
  // A sub-receita já entrou acima com a margem DELA; esta vale sobre o total desta ficha.
  const margem = Number(ficha.margemPerda) || 0;
  return margem > 0 ? total * (1 + margem / 100) : total;
}

/**
 * Todo ingrediente que entra nesta venda tem custo (também na sub-receita)? `custoTotalFicha` soma a linha sem custo como zero: a
 * ficha pela metade daria um custo baixo e uma margem falsa. Quem mostra lucro ou manda custo para fora confere aqui antes.
 */
export function fichaComCustoCompleto(
  fichaId: string,
  mapa: Record<string, FichaCusto>,
  canal: CanalDaFicha = 'nenhum',
  mesmaEmbalagem = false,
  visitados: Set<string> = new Set(),
): boolean {
  if (visitados.has(fichaId)) return false;
  const ficha = mapa[fichaId];
  if (!ficha) return false;
  const proximos = new Set(visitados);
  proximos.add(fichaId);
  let entraram = 0;
  for (const ing of ficha.ingredientes) {
    if (!linhaEntra(ing, canal, mesmaEmbalagem)) continue;
    if (!(Number(ing.quantidade) > 0)) continue;
    entraram++;
    if (!(Number(ing.fatorCorrecao) > 0)) return false;
    if (ing.subFichaId) {
      if (!fichaComCustoCompleto(ing.subFichaId, mapa, canal, mesmaEmbalagem, proximos)) return false;
      continue;
    }
    // Feito na loja: se a ficha dele já tem algum custo, ela decide. Sem nenhum, vale o que está gravado na linha.
    if (ing.fichaDoItemId && custoTotalFicha(ing.fichaDoItemId, mapa, 'nenhum', false, proximos) > 0) {
      if (!fichaComCustoCompleto(ing.fichaDoItemId, mapa, 'nenhum', false, proximos)) return false;
      continue;
    }
    if (!(Number(ing.custoUnitario) > 0)) return false;
  }
  return entraram > 0;
}

/**
 * Existe caminho de `origem` até `destino` no grafo de sub-fichas
 * (arestas: ficha → lista de sub-fichas)? Usado para barrar ciclos ao inserir
 * uma sub-ficha: adicionar a aresta pai→sub cria ciclo se `sub` alcança `pai`.
 */
export function fichaAlcancavel(
  origem: string,
  destino: string,
  arestas: Record<string, string[]>,
  visitados: Set<string> = new Set(),
): boolean {
  if (origem === destino) return true;
  if (visitados.has(origem)) return false;
  visitados.add(origem);
  for (const prox of arestas[origem] ?? []) {
    if (fichaAlcancavel(prox, destino, arestas, visitados)) return true;
  }
  return false;
}

// ── Preferências de UI (shell) ───────────────────────────────────────────────
export type UiPrefs = {
  sidebar?: 'expanded' | 'collapsed';
  side?: 'left' | 'right';
  // Ordem PESSOAL das categorias no PDV Balcão (arrastável, POR USUÁRIO) — NÃO altera o
  // catálogo. Lista de ids de categoria; categorias fora da lista vão para o fim.
  pdvOrdemCategorias?: string[];
  // O tamanho dos cartões de produto no PDV · Balcão (17/11/2026): grande (padrão) ou compacto.
  pdvCartoes?: 'grande' | 'compacto';
};

/** Mantém apenas chaves conhecidas com valores válidos (ignora o resto). */
export function sanitizeUiPrefs(p: any): UiPrefs {
  const out: UiPrefs = {};
  if (p?.sidebar === 'expanded' || p?.sidebar === 'collapsed') out.sidebar = p.sidebar;
  if (p?.side === 'left' || p?.side === 'right') out.side = p.side;
  if (Array.isArray(p?.pdvOrdemCategorias)) {
    // Só ids (strings não vazias, ≤64 chars), sem duplicatas, no máx. 200 categorias.
    const vistos = new Set<string>();
    const ordem = p.pdvOrdemCategorias
      .filter((x: any) => typeof x === 'string' && x.length > 0 && x.length <= 64)
      .filter((x: string) => (vistos.has(x) ? false : (vistos.add(x), true)))
      .slice(0, 200);
    if (ordem.length) out.pdvOrdemCategorias = ordem;
  }
  if (p?.pdvCartoes === 'grande' || p?.pdvCartoes === 'compacto') out.pdvCartoes = p.pdvCartoes;
  return out;
}

/** Merge parcial: patch sobrescreve, chaves ausentes/ inválidas preservam o atual. */
export function mergeUiPrefs(atual: any, patch: any): UiPrefs {
  return { ...sanitizeUiPrefs(atual), ...sanitizeUiPrefs(patch) };
}

// ── Sync (edge ↔ nuvem) ──────────────────────────────────────────────────────
/**
 * Resolução de conflito last-write-wins entre duas versões da mesma linha.
 * Vence o `updated_at` mais recente; empate no timestamp desempata por id
 * (determinístico, para os dois lados convergirem igual). Ver arquitetura-edge §3.
 */
export function venceLWW(
  tsLocal: string | Date | null | undefined,
  tsRemoto: string | Date | null | undefined,
  idLocal: string,
  idRemoto: string,
): 'local' | 'remoto' {
  const l = tsLocal ? new Date(tsLocal).getTime() : 0;
  const r = tsRemoto ? new Date(tsRemoto).getTime() : 0;
  if (r > l) return 'remoto';
  if (l > r) return 'local';
  return idRemoto > idLocal ? 'remoto' : 'local';
}

/** Deve sobrescrever a versão local pela remota (LWW)? */
export function deveAplicarRemoto(
  tsLocal: string | Date | null | undefined,
  tsRemoto: string | Date | null | undefined,
  idLocal: string,
  idRemoto: string,
): boolean {
  return venceLWW(tsLocal, tsRemoto, idLocal, idRemoto) === 'remoto';
}

export type MovLedger = { tipo: string; quantidade: number | string };

/**
 * Saldo derivado do ledger de estoque (espelha a soma feita em SQL):
 * entrada +, saida −, qualquer outro tipo (ajuste) soma pelo sinal do valor.
 */
export function saldoLedger(movimentos: MovLedger[]): number {
  return movimentos.reduce((s, m) => {
    const q = Number(m.quantidade);
    if (m.tipo === 'entrada') return s + q;
    if (m.tipo === 'saida') return s - q;
    return s + q; // ajuste: já vem sinalizado
  }, 0);
}

/**
 * Próximo vencimento de um título financeiro recorrente.
 * 'nenhuma' (ou base ausente) → null.
 */
export function proximaData(
  base: string | null,
  recorrencia: string,
): string | null {
  if (!base) return null;
  const d = new Date(base);
  if (recorrencia === 'semanal') d.setDate(d.getDate() + 7);
  else if (recorrencia === 'quinzenal') d.setDate(d.getDate() + 15);
  else if (recorrencia === 'mensal') d.setMonth(d.getMonth() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Late-binding tarefa→escala: quem executa a tarefa naquela data.
 * 1) override explícito vence; 2) senão, o colaborador alocado na etiqueta; 3) senão, ninguém.
 */
export function resolverColaboradorTarefa(
  overrideId: string | null | undefined,
  alocacaoColaboradorId: string | null | undefined,
): string | null {
  return overrideId ?? alocacaoColaboradorId ?? null;
}

/**
 * Escopo de setor (RBAC): supervisor só enxerga/opera o próprio setor;
 * presidente/gerente/execução não têm restrição de setor aqui.
 * Supervisor sem setor definido não acessa recurso de setor algum.
 */
export function escopoPermiteSetor(
  categoria: string,
  userSetorId: string | null | undefined,
  recursoSetorId: string | null | undefined,
): boolean {
  if (categoria !== 'supervisao') return true;
  if (!userSetorId) return false;
  return recursoSetorId === userSetorId;
}

/**
 * Executa `fn` com retry APENAS em violação de unique do Postgres (código 23505),
 * usado no NSR sequencial por equipamento (colisão concorrente → tenta o próximo).
 * Outros erros propagam; estouro de tentativas propaga o último erro.
 */
export async function comRetryUnico<T>(
  fn: () => Promise<T>,
  maxTentativas = 5,
): Promise<T> {
  let tentativa = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn();
    } catch (e: any) {
      if (e?.code === '23505' && tentativa < maxTentativas - 1) {
        tentativa++;
        continue;
      }
      throw e;
    }
  }
}
