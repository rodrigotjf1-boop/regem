// Regras puras da venda do balcão (sem tela): busca de produto, divisão da conta e troco.
// Todo dinheiro é contado em CENTAVOS inteiros — R$ 100,00 por 3 pessoas tem de fechar em
// 33,34 + 33,33 + 33,33, nunca em três 33,33. Conferido por `scripts/check-balcao.mjs`.

export const centavos = (n: number | string | null | undefined): number => Math.round(Number(n || 0) * 100);

// "50" · "50,5" · "1.250,00" → número. O que não dá para ler (ou é negativo) vira 0.
export function valorDigitado(txt: string | number | null | undefined): number {
  const s = String(txt ?? '').trim();
  if (!s) return 0;
  const n = parseFloat(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

// Partes iguais: o centavo que sobra fica com as primeiras pessoas.
export function partesIguais(total: number, pessoas: number): number[] {
  const n = Math.max(1, Math.floor(pessoas));
  const c = centavos(total);
  const base = Math.floor(c / n);
  const sobra = c - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < sobra ? 1 : 0)) / 100);
}

// Por item: `linhas[i]` é o valor da linha i do pedido e `donos[i]` quem a paga (índice da pessoa),
// ou null = todos (a linha é dividida por igual). A taxa de serviço entra na proporção do que cada
// um consumiu; o centavo que sobra dela vai para quem consumiu mais. A soma fecha em linhas + serviço.
export function partesPorItem(linhas: number[], donos: (number | null)[], pessoas: number, servico = 0): number[] {
  const n = Math.max(1, Math.floor(pessoas));
  const c: number[] = Array(n).fill(0);
  linhas.forEach((valor, i) => {
    const dono = donos[i];
    if (dono == null || dono < 0 || dono >= n) partesIguais(valor, n).forEach((x, p) => (c[p] += centavos(x)));
    else c[dono] += centavos(valor);
  });
  const s = centavos(servico);
  const base = c.reduce((a, x) => a + x, 0);
  if (s > 0 && base > 0) {
    let dado = 0;
    const extra = c.map((x) => {
      const y = Math.floor((s * x) / base);
      dado += y;
      return y;
    });
    const ordem = c.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
    for (let i = 0, resto = s - dado; resto > 0; i = (i + 1) % ordem.length, resto--) extra[ordem[i][1]]++;
    extra.forEach((x, i) => (c[i] += x));
  }
  return c.map((x) => x / 100);
}

// Notas que o cliente costuma entregar para pagar `total` (no máximo 4, sem repetir).
export function notasSugeridas(total: number): number[] {
  if (!(total > 0)) return [];
  const s = new Set<number>();
  for (const nota of [5, 10, 20, 50, 100, 200]) s.add(Math.ceil(total / nota) * nota);
  return [...s].sort((a, b) => a - b).slice(0, 4);
}

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const junto = (s: string) => semAcento(s).replace(/[^a-z0-9]/g, '');

// Busca do balcão. Ordem: código exato · começo do nome · começo do código · iniciais ("xb" acha
// "X-Burger") · trecho no meio do nome. Empate fica na ordem do cadastro (a busca não reordena).
export function buscarProdutos<T extends { nome: string; codigo?: string | null }>(produtos: T[], texto: string, limite = 60): T[] {
  const q = junto(texto);
  if (!q) return [];
  const pontos = (p: T): number => {
    const nome = junto(p.nome);
    const cod = junto(p.codigo ?? '');
    if (cod && cod === q) return 0;
    if (nome.startsWith(q)) return 1;
    if (cod && cod.startsWith(q)) return 2;
    const iniciais = semAcento(p.nome).split(/[^a-z0-9]+/).filter(Boolean).map((w) => w[0]).join('');
    if (iniciais.startsWith(q)) return 3;
    if (nome.includes(q)) return 4;
    return 99;
  };
  return produtos
    .map((p, i) => [pontos(p), i, p] as const)
    .filter(([s]) => s < 99)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
    .slice(0, limite)
    .map(([, , p]) => p);
}

// Identidade de uma linha do pedido: mesmo produto, tamanho, escolhas e observação = mesma linha
// (as quantidades somam). A ordem em que os adicionais foram tocados não muda a linha.
export function chaveDoItem(i: { produtoId: string; variacaoId?: string | null; complementos?: string[]; observacao?: string | null }): string {
  return `${i.produtoId}:${i.variacaoId ?? ''}:${(i.complementos ?? []).slice().sort().join(',')}:${i.observacao ?? ''}`;
}
