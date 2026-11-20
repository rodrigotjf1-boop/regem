import { diaDaSemana, somarDias } from './calendario-regra';

// O QUE MOVE O CLIENTE — A SENSIBILIDADE A EVENTOS (F3 parte 2 do docs/plano-perfil-cliente.md, §4.7, o "método honesto"):
//  1. primeiro a loja: só se mede o cliente num tipo de evento que mexe na LOJA (o RR somado de todos ≥ 1,05);
//  2. o cliente contra ELE MESMO no mesmo dia da semana: o esperado num dia de evento é a taxa dele naquele dia da semana
//     nos dias COMUNS (sem evento nenhum), dentro do período em que ele já era cliente;
//  3. o risco relativo ENCOLHIDO para o da loja (Gama-Poisson: λ̂ = (k + a) / (E + b), com a/b = o RR da loja);
//  4. o selo só com prova: ≥ 3 dias de evento com pedido E P(RR > 1) ≥ 0,9;
//  5. muitos clientes × tipos = falso positivo: Benjamini-Hochberg no lote (q = 0,10, com p = 1 − P(RR > 1)).
// Funções puras: testáveis sem banco. Os cortes ficam aqui (da distribuição — a loja não vê nem edita a lógica).

export const REGRAS_DA_SENSIBILIDADE = {
  /** Força do prior (em "pedidos esperados"): 2 = o RR da loja vale como 2 pedidos de evidência. */
  forcaDoPrior: 2,
  /** O tipo só é medido no cliente se mexe na loja: RR somado ≥ 1,05 e ao menos 3 dias desse tipo no período. */
  rrMinimoDaLoja: 1.05,
  diasMinimosDaLoja: 3,
  /** O selo: dias de evento com pedido, a chance de efeito real e a taxa de descobertas falsas do lote. */
  diasMinimosDoSelo: 3,
  probMinimaDoSelo: 0.9,
  fdr: 0.1,
} as const;

export const TIPOS_DE_SENSIBILIDADE = ['feriado', 'comemorativa', 'dinheiro', 'loja'] as const;
export type TipoDeSensibilidade = (typeof TIPOS_DE_SENSIBILIDADE)[number];

// ── a gama incompleta regularizada (Numerical Recipes, gammq) ──────────────────────────────────────────────────────────
function lnGama(x: number): number {
  // Lanczos (g = 7, n = 9).
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGama(1 - x);
  const y = x - 1;
  let a = c[0];
  const t = y + 7.5;
  for (let i = 1; i < 9; i++) a += c[i] / (y + i);
  return 0.5 * Math.log(2 * Math.PI) + (y + 0.5) * Math.log(t) - t + Math.log(a);
}
function serie(a: number, x: number): number {
  let soma = 1 / a;
  let del = soma;
  let ap = a;
  for (let n = 0; n < 500; n++) {
    ap += 1;
    del *= x / ap;
    soma += del;
    if (Math.abs(del) < Math.abs(soma) * 1e-12) break;
  }
  return soma * Math.exp(-x + a * Math.log(x) - lnGama(a));
}
function fracao(a: number, x: number): number {
  const MIN = 1e-300;
  let b = x + 1 - a;
  let c = 1 / MIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < MIN) d = MIN;
    c = b + an / c;
    if (Math.abs(c) < MIN) c = MIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-12) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGama(a)) * h;
}
/** Q(a, x) = 1 − P(a, x): a cauda de cima da gama regularizada (a > 0, x ≥ 0). */
export function gamaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  return x < a + 1 ? 1 - serie(a, x) : fracao(a, x);
}

/** Benjamini-Hochberg: quais p-valores passam com a taxa de descobertas falsas `q` (índices na ordem de entrada). */
export function benjaminiHochberg(p: number[], q: number): boolean[] {
  const m = p.length;
  const ordem = p.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0]);
  let corte = -1;
  ordem.forEach(([v], r) => {
    if (v <= ((r + 1) / m) * q) corte = r;
  });
  const passa = new Array<boolean>(m).fill(false);
  for (let r = 0; r <= corte; r++) passa[ordem[r][1]] = true;
  return passa;
}

// ── o cálculo ───────────────────────────────────────────────────────────────────────────────────────────────────────────

export type ClienteParaMedir = {
  id: string;
  /** O calendário da loja do cliente (a loja onde ele mais pede). */
  loja: string;
  /** O primeiro dia em que ele já era cliente dentro do período (dia de operação). */
  inicio: string;
  /** Pedidos por dia de operação. */
  pedidos: Map<string, number>;
};
export type Sensibilidade = {
  cliente: string;
  tipo: TipoDeSensibilidade;
  rr: number;
  prob: number;
  pedidos: number;
  esperado: number;
  dias: number;
  selo: boolean;
};

/**
 * Mede todos os clientes de uma empresa. `calendarios`: por loja, os tipos de evento de cada dia ('AAAA-MM-DD' → tipos;
 * o dia sem evento vem com o conjunto vazio ou não vem). `ate`: o último dia medido (ontem).
 * Devolve as linhas (só cliente × tipo medido, com pedido em dia de evento) e o RR de cada tipo na loja somada.
 */
export function medirSensibilidades(
  clientes: ClienteParaMedir[],
  calendarios: Map<string, Map<string, Set<string>>>,
  ate: string,
): { linhas: Sensibilidade[]; rrDaLoja: Record<string, { rr: number | null; dias: number; mede: boolean }> } {
  const R = REGRAS_DA_SENSIBILIDADE;
  type Conta = { k: number; e: number; dias: number };
  const porCliente: { id: string; contas: Map<TipoDeSensibilidade, Conta> }[] = [];
  const total = new Map<TipoDeSensibilidade, { k: number; e: number }>();
  const diasDoTipo = new Map<TipoDeSensibilidade, Set<string>>();
  for (const cal of calendarios.values())
    for (const [dia, tipos] of cal)
      for (const t of tipos) if ((TIPOS_DE_SENSIBILIDADE as readonly string[]).includes(t)) {
        const s = diasDoTipo.get(t as TipoDeSensibilidade) ?? new Set<string>();
        s.add(dia);
        diasDoTipo.set(t as TipoDeSensibilidade, s);
      }

  for (const c of clientes) {
    const cal = calendarios.get(c.loja) ?? new Map<string, Set<string>>();
    // A taxa do cliente em cada dia da semana nos dias COMUNS do período dele.
    const comuns = new Array(7).fill(0);
    const naComum = new Array(7).fill(0);
    for (let d = c.inicio; d <= ate; d = somarDias(d, 1)) {
      if (cal.get(d)?.size) continue;
      const w = diaDaSemana(d);
      comuns[w]++;
      naComum[w] += c.pedidos.get(d) ?? 0;
    }
    const taxa = comuns.map((n, w) => (n > 0 ? naComum[w] / n : 0));
    const contas = new Map<TipoDeSensibilidade, Conta>();
    for (let d = c.inicio; d <= ate; d = somarDias(d, 1)) {
      const tipos = cal.get(d);
      if (!tipos?.size) continue;
      const n = c.pedidos.get(d) ?? 0;
      for (const t of tipos) {
        if (!(TIPOS_DE_SENSIBILIDADE as readonly string[]).includes(t)) continue;
        const x = contas.get(t as TipoDeSensibilidade) ?? { k: 0, e: 0, dias: 0 };
        x.k += n;
        x.e += taxa[diaDaSemana(d)];
        if (n > 0) x.dias++;
        contas.set(t as TipoDeSensibilidade, x);
      }
    }
    for (const [t, x] of contas) {
      const s = total.get(t) ?? { k: 0, e: 0 };
      s.k += x.k;
      s.e += x.e;
      total.set(t, s);
    }
    porCliente.push({ id: c.id, contas });
  }

  const rrDaLoja: Record<string, { rr: number | null; dias: number; mede: boolean }> = {};
  for (const t of TIPOS_DE_SENSIBILIDADE) {
    const s = total.get(t);
    const rr = s && s.e > 0 ? s.k / s.e : null;
    const dias = diasDoTipo.get(t)?.size ?? 0;
    rrDaLoja[t] = { rr, dias, mede: rr != null && rr >= R.rrMinimoDaLoja && dias >= R.diasMinimosDaLoja };
  }

  const linhas: Sensibilidade[] = [];
  for (const c of porCliente)
    for (const [t, x] of c.contas) {
      if (!rrDaLoja[t].mede || x.e <= 0 || x.k <= 0) continue;
      const b = R.forcaDoPrior;
      const a = b * (rrDaLoja[t].rr as number);
      const alfa = x.k + a;
      const beta = x.e + b;
      linhas.push({
        cliente: c.id,
        tipo: t,
        rr: alfa / beta,
        // P(λ > 1) com λ ~ Gama(alfa, beta) = Q(alfa, beta·1).
        prob: gamaQ(alfa, beta),
        pedidos: x.k,
        esperado: x.e,
        dias: x.dias,
        selo: false,
      });
    }
  const passa = benjaminiHochberg(linhas.map((l) => 1 - l.prob), R.fdr);
  linhas.forEach((l, i) => {
    l.selo = passa[i] && l.dias >= R.diasMinimosDoSelo && l.prob >= R.probMinimaDoSelo;
  });
  return { linhas, rrDaLoja };
}
