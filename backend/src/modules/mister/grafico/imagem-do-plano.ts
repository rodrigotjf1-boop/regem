import { Tela } from './tela';
import type { PlanoDoGrafico } from './plano-do-grafico';

// A IMAGEM DE UM PLANO DE GRÁFICO (versão 5, M5d.2): o mesmo desenho do gráfico do insumo (`grafico-do-insumo.ts`) e do
// protótipo — a faixa dourada, o título, o lugar e o período, o número grande com a comparação, a área do gráfico, a
// legenda e o rodapé com a hora da leitura. Só retângulos e texto (o `Tela` próprio, sem biblioteca): nítido no celular.

const OURO = '#D4952F';
const FAIXA = '#E2A340';
const MARINHO = '#2F4A60';
const ANTERIOR = '#C9D3DC';
const TINTA = '#0F2230';
const CINZA = '#5B6B78';
const LINHA = '#D5DCE3';
const GRADE = '#E6ECF1';
const TRILHO = '#EEF2F5';
const BOM = '#0F6647';
const RUIM = '#B93232';
/** As cores dos canais, na ordem (o maior primeiro). */
export const CORES_DAS_PARTES = ['#2F4A60', '#D4952F', '#5B8DB8', '#3E8E7E', '#A9B7C4', '#7A8B99'];
export const TAMANHO_DA_IMAGEM_DO_PLANO = { largura: 1000, altura: 640 } as const;

export function imagemDoPlano(p: PlanoDoGrafico): Buffer {
  const { largura: W, altura: H } = TAMANHO_DA_IMAGEM_DO_PLANO;
  const M = 40;
  const t = new Tela(W, H, '#FFFFFF');
  t.retangulo(0, 0, W, 6, FAIXA);

  // O cabeçalho: o título, o lugar e o período, e o número grande com a comparação na mesma linha.
  let y = 24;
  t.texto(t.caber(p.titulo, 'titulo', W - 2 * M), M, y, { tamanho: 'titulo', cor: TINTA });
  y += t.alturaDaLinha('titulo') + 2;
  t.texto(t.caber(p.sub, 'texto', W - 2 * M), M, y, { tamanho: 'texto', cor: CINZA });
  y += t.alturaDaLinha('texto') + 10;
  if (p.kpi) {
    const w = t.texto(t.caber(p.kpi, 'titulo', W - 2 * M), M, y, { tamanho: 'titulo', cor: TINTA });
    if (p.delta) {
      const cor = p.delta.tom === 'bom' ? BOM : p.delta.tom === 'ruim' ? RUIM : CINZA;
      const x = M + w + 20;
      t.texto(t.caber(p.delta.texto, 'texto', W - M - x), x, y + Math.round((t.alturaDaLinha('titulo') - t.alturaDaLinha('texto')) / 2) + 2, { tamanho: 'texto', cor });
    }
    y += t.alturaDaLinha('titulo') + 14;
  }

  if (p.forma === 'colunas') colunas(t, p, M, y, W, H);
  else if (p.forma === 'participacao') participacao(t, p, M, y + 6, W);
  else horizontais(t, p, M, y + 4, W);

  t.texto(t.caber(p.rodape, 'pequeno', W * 0.66), M, H - 34, { tamanho: 'pequeno', cor: CINZA });
  t.texto('REGEM · Mister', W - M, H - 34, { tamanho: 'pequeno', cor: FAIXA, alinhar: 'dir' });
  return t.png();
}

/** As colunas: com o período anterior ao lado (a coluna clara à esquerda) ou sozinhas; a maior em dourado. */
function colunas(t: Tela, p: PlanoDoGrafico, M: number, y: number, W: number, H: number): void {
  const barras = p.barras ?? [];
  const n = Math.max(1, barras.length);
  const comparadas = barras.some((b) => b.anterior !== undefined);
  const duasLinhas = barras.some((b) => b.rotulo2);
  const legenda = (p.legenda ?? []).length > 0;
  const base = H - 60 - (duasLinhas ? 50 : 28) - (legenda ? 40 : 0);
  const topo = y + t.alturaDaLinha('texto') + 4;
  const maior = Math.max(1, ...barras.map((b) => Math.max(b.valor, b.anterior ?? 0)));
  const passo = (W - 2 * M) / n;
  const larg = comparadas ? Math.max(3, Math.min(34, passo * 0.32)) : Math.max(3, Math.min(64, passo * 0.6));
  const tam = n <= 10 ? 'texto' : 'pequeno';
  const cabem = barras.every((b) => t.medir(b.texto, tam) <= passo - 4);
  const iMaior = barras.reduce((m, b, i) => (b.valor > barras[m].valor ? i : m), 0);
  const pulo = Math.max(1, Math.ceil((Math.max(1, ...barras.map((b) => t.medir(b.rotulo, 'pequeno'))) + 10) / passo));
  for (const f of [1 / 3, 2 / 3]) t.linhaH(M, W - M, base - (base - topo) * f, GRADE, 1);
  t.linhaH(M, W - M, base, LINHA, 2);
  barras.forEach((b, i) => {
    const cx = M + i * passo + passo / 2;
    const h = (b.valor / maior) * (base - topo);
    let topoDaBarra = base - h;
    if (comparadas) {
      const ha = ((b.anterior ?? 0) / maior) * (base - topo);
      if (ha > 0) t.retangulo(cx - larg - 1, base - ha, larg, Math.max(1, ha), ANTERIOR);
      if (h > 0) t.retangulo(cx + 1, base - h, larg, Math.max(1, h), i === iMaior ? OURO : MARINHO);
      topoDaBarra = Math.min(base - h, base - ha);
    } else if (h > 0) t.retangulo(cx - larg / 2, base - h, larg, Math.max(1, h), i === iMaior ? OURO : MARINHO);
    if (cabem || i === iMaior) t.texto(b.texto, cx, topoDaBarra - t.alturaDaLinha(tam) - 2, { tamanho: tam, cor: TINTA, alinhar: 'centro' });
    if (i % pulo === 0) {
      t.texto(b.rotulo, cx, base + 8, { tamanho: 'pequeno', cor: TINTA, alinhar: 'centro' });
      if (b.rotulo2) t.texto(b.rotulo2, cx, base + 8 + t.alturaDaLinha('pequeno') + 2, { tamanho: 'pequeno', cor: CINZA, alinhar: 'centro' });
    }
  });
  if (legenda) {
    const cores = comparadas ? [MARINHO, ANTERIOR, OURO] : [OURO];
    let x = M;
    const yl = H - 60 - 26;
    (p.legenda ?? []).forEach((txt, i) => {
      t.retangulo(x, yl + 4, 14, 14, cores[i] ?? MARINHO);
      x += 20 + t.texto(txt, x + 20, yl, { tamanho: 'pequeno', cor: CINZA }) + 24;
    });
  }
}

/** A participação: a barra empilhada e uma linha por parte (a cor, o nome, a %, o valor). */
function participacao(t: Tela, p: PlanoDoGrafico, M: number, y: number, W: number): void {
  const partes = p.partes ?? [];
  const soma = partes.reduce((s, x) => s + x.valor, 0) || 1;
  let x = M;
  partes.forEach((parte, i) => {
    const w = ((W - 2 * M) * parte.valor) / soma;
    t.retangulo(x, y, Math.max(1, w - 3), 34, CORES_DAS_PARTES[i % CORES_DAS_PARTES.length]);
    x += w;
  });
  let yy = y + 60;
  partes.forEach((parte, i) => {
    t.retangulo(M, yy + 5, 18, 18, CORES_DAS_PARTES[i % CORES_DAS_PARTES.length]);
    t.texto(t.caber(parte.nome, 'texto', W * 0.45), M + 30, yy, { tamanho: 'texto', cor: TINTA });
    t.texto(`${Math.round((parte.valor / soma) * 100)}%`, W - M - 230, yy, { tamanho: 'texto', cor: TINTA, alinhar: 'dir' });
    t.texto(parte.texto, W - M, yy, { tamanho: 'texto', cor: CINZA, alinhar: 'dir' });
    yy += 52;
  });
}

/** As barras deitadas: o nome e o valor em cima, a barra no trilho embaixo; a primeira em dourado. */
function horizontais(t: Tela, p: PlanoDoGrafico, M: number, y: number, W: number): void {
  const partes = p.partes ?? [];
  const maior = Math.max(1, ...partes.map((x) => x.valor));
  let yy = y;
  partes.forEach((parte, i) => {
    const valor = parte.texto;
    const wValor = t.medir(valor, 'texto');
    t.texto(t.caber(parte.nome, 'texto', W - 2 * M - wValor - 24), M, yy, { tamanho: 'texto', cor: TINTA });
    t.texto(valor, W - M, yy, { tamanho: 'texto', cor: TINTA, alinhar: 'dir' });
    const yb = yy + t.alturaDaLinha('texto') + 6;
    t.retangulo(M, yb, W - 2 * M, 14, TRILHO);
    t.retangulo(M, yb, Math.max(4, ((W - 2 * M) * parte.valor) / maior), 14, i === 0 ? OURO : MARINHO);
    yy = yb + 14 + 22;
  });
}
