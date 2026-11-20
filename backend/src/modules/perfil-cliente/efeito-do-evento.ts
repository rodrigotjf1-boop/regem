import { somarDias } from './calendario-regra';

// "MEXE NA SUA LOJA?" — O EFEITO DE CADA EVENTO NA LOJA (F3, parte 1, do docs/plano-perfil-cliente.md §4.7: "primeiro a
// loja, depois o cliente"). Para cada vez que o evento aconteceu, os pedidos daquele dia de operação contra a MÉDIA DO
// MESMO DIA DA SEMANA nas 8 semanas anteriores SEM evento nenhum (nunca contra a média geral: jogo cai em quarta e
// domingo, salário no começo do mês). Soma das vezes: variação = Σ pedidos do dia ÷ Σ média de referência − 1.
// Funções puras: testáveis sem banco. Honesto com o pouco dado: diz quantas vezes mediu e chama de "fraco" abaixo de 3.

export type Efeito = {
  /** Quantas vezes o evento aconteceu e deu para comparar. */
  vezes: number;
  /** Variação dos pedidos (0,22 = +22%); `null` sem medida. */
  variacao: number | null;
  forca: 'sem_historico' | 'sem_comparacao' | 'sem_efeito' | 'fraco' | 'medio' | 'forte';
  texto: string;
};

/** Semanas de referência antes de cada vez do evento, e o mínimo de dias comuns para comparar. */
export const REFERENCIA = { semanas: 8, minimoDeDias: 3 } as const;
/** Abaixo disto (em módulo) a diferença é ruído do dia a dia: "sem efeito medido". */
const SEM_EFEITO = 0.05;

/** A família do evento (a mesma data em outros anos/meses, ou as repetições do mesmo evento da loja). */
export function familiaDe(chave: string): string {
  const partes = chave.split(':');
  // regra:<tipo>:<id>:<ano ou ano-mês>  → regra:<tipo>:<id>
  if (partes[0] === 'regra') return partes.slice(0, 3).join(':');
  // loja:<id>:<dia> e escala:<id>:<dia> → loja:<id> / escala:<id>
  return partes.slice(0, 2).join(':');
}

const pct = (v: number) => `${v > 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}%`;

/**
 * Mede o efeito de um evento pelas vezes em que aconteceu (`dias`, todos antes de hoje).
 * `pedidos`: pedidos por dia de operação ('AAAA-MM-DD' → n); dia sem pedido conta 0 a partir de `primeiroDia` (o primeiro
 * dia com pedido nos dados — antes disso a loja nem usava o Regem). `comEvento`: TODOS os dias com algum evento (ficam
 * fora da referência).
 */
export function medirEfeito(dias: string[], pedidos: Map<string, number>, comEvento: Set<string>, primeiroDia: string | null): Efeito {
  if (!dias.length) return { vezes: 0, variacao: null, forca: 'sem_historico', texto: 'sem histórico ainda' };
  const n = (d: string) => (primeiroDia && d >= primeiroDia ? pedidos.get(d) ?? 0 : null);
  let vezes = 0;
  let somaDia = 0;
  let somaRef = 0;
  for (const dia of dias) {
    const doDia = n(dia);
    if (doDia === null) continue;
    const ref: number[] = [];
    for (let k = 1; k <= REFERENCIA.semanas; k++) {
      const d = somarDias(dia, -7 * k);
      if (comEvento.has(d)) continue;
      const v = n(d);
      if (v !== null) ref.push(v);
    }
    if (ref.length < REFERENCIA.minimoDeDias) continue;
    const media = ref.reduce((a, b) => a + b, 0) / ref.length;
    // Referência zerada (a loja não abre nesse dia da semana): não há o que comparar.
    if (media <= 0) continue;
    vezes++;
    somaDia += doDia;
    somaRef += media;
  }
  if (!vezes) return { vezes: 0, variacao: null, forca: 'sem_comparacao', texto: 'sem dias comuns para comparar' };
  const variacao = somaDia / somaRef - 1;
  const quando = vezes === 1 ? 'na última vez' : `nas últimas ${vezes} vezes`;
  if (Math.abs(variacao) < SEM_EFEITO) return { vezes, variacao, forca: 'sem_efeito', texto: `sem efeito medido (${quando})` };
  const forca = vezes >= 6 ? 'forte' : vezes >= 3 ? 'medio' : 'fraco';
  return { vezes, variacao, forca, texto: `${pct(variacao)} ${quando}${forca === 'fraco' ? ' · pouco histórico' : ''}` };
}
