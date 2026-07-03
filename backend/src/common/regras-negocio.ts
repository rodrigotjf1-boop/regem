// Regras de negócio críticas do Regem, isoladas como funções puras para teste.
// Os services importam daqui — os testes cobrem o código realmente usado.

/**
 * Custo médio ponderado móvel (recebimento de estoque).
 * novo = (saldoBase × custoMédioAtual + qtdEntrada × custoEntrada) / (saldoBase + qtdEntrada)
 * - saldoBase 0  → assume o custo da entrada;
 * - custoEntrada null → não altera (item recebido sem custo informado).
 */
export function custoMedioPonderado(
  saldoBase: number,
  custoMedioAtual: number,
  qtdEntrada: number,
  custoEntrada: number | null,
): number {
  if (custoEntrada == null) return custoMedioAtual;
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
