// Regras puras da venda do balcão (sem tela): busca de produto, divisão da conta e troco.
// Todo dinheiro é contado em CENTAVOS inteiros — R$ 100,00 por 3 pessoas tem de fechar em
// 33,34 + 33,33 + 33,33, nunca em três 33,33. Conferido por `scripts/check-balcao.mjs`.

export const centavos = (n: number | string | null | undefined): number => Math.round(Number(n || 0) * 100);

// "50" · "50,5" · "1.250,00" · "1.250" → número. O que não dá para ler (ou é negativo) vira 0. A MESMA regra de
// `lib/valor-digitado.ts` (o `check:valor` compara os dois): ponto de milhar só em grupos de 3, vírgula decimal — antes,
// "1.250" virava R$ 1,25 e "12.34,56" virava R$ 1.234,56 no dividir conta (PDV-C-04 da revisão de 25/11/2026).
export function valorDigitado(txt: string | number | null | undefined): number {
  if (typeof txt === 'number') return Number.isFinite(txt) && txt > 0 ? Math.round(txt * 100) / 100 : 0;
  const s = String(txt ?? '').replace(/R\$/gi, '').replace(/\s+/g, '');
  if (!s) return 0;
  let normal: string;
  if (s.includes(',')) {
    const [inteira, ...resto] = s.split(',');
    if (resto.length !== 1 || (inteira.includes('.') && !/^-?\d{1,3}(\.\d{3})+$/.test(inteira))) return 0;
    normal = `${inteira.replace(/\./g, '')}.${resto[0]}`;
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) normal = s.replace(/\./g, '');
  else normal = s;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return 0;
  const n = Math.round(Number(normal) * 100) / 100;
  return n > 0 ? n : 0;
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

/** A pílula dos produtos sem categoria (ou de categoria que não existe mais). */
export const SEM_CATEGORIA = '_sem';

/**
 * As categorias do balcão SEM o "Todos" (pedido do dono, 16/11/2026): a tela abre na PRIMEIRA categoria — na ordem dada
 * (a ordem pessoal do PDV) — que tem produto, e a escolhida vale enquanto existir. O produto de SUBcategoria conta na
 * categoria de cima dela (antes só o "Todos" o mostrava); o produto sem categoria, ou de categoria apagada, vai para
 * `SEM_CATEGORIA` — a tela mostra essa pílula só quando há algum (senão ele só sairia na busca).
 * `topo`: as categorias de topo, na ordem da tela; `todas`: todas, com o pai; `escolhida`: a clicada ('' = nenhuma ainda).
 */
export function categoriasDoBalcao(
  topo: { id: string }[],
  todas: { id: string; parentId?: string | null }[],
  produtos: { categoriaId?: string | null }[],
  escolhida: string,
): { atual: string; semCategoria: boolean; topoDe: (categoriaId: string | null | undefined) => string } {
  const idsDeTopo = new Set(topo.map((c) => c.id));
  const paiDe = new Map(todas.map((c) => [c.id, c.parentId ?? null] as const));
  const topoDe = (categoriaId: string | null | undefined): string => {
    let atual = categoriaId ?? null;
    for (let i = 0; i < 10 && atual && paiDe.get(atual); i++) atual = paiDe.get(atual) ?? null;
    return atual && idsDeTopo.has(atual) ? atual : SEM_CATEGORIA;
  };
  const comProduto = new Set(produtos.map((p) => topoDe(p.categoriaId)));
  const semCategoria = comProduto.has(SEM_CATEGORIA);
  const vale = escolhida === SEM_CATEGORIA ? semCategoria : idsDeTopo.has(escolhida);
  const atual = escolhida && vale
    ? escolhida
    : (topo.find((c) => comProduto.has(c.id))?.id ?? (semCategoria ? SEM_CATEGORIA : (topo[0]?.id ?? '')));
  return { atual, semCategoria, topoDe };
}
