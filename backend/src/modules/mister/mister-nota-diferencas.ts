import type { NotaNoMister, PedidoDaNota } from '../../common/nota-por-foto';

// AS DIFERENÇAS ENTRE O PEDIDO E A NOTA, PELA CONVERSA (versão 10, fase C1b-1; aprovada pelo dono em 25/11/2026 —
// `docs/plano-mister.md` § "Versão 10", protótipo `mockups/regem-mister-v10.html`, "O documento conversado"; era a P4c de
// "Pedidos e recebimento", PR-9). Antes, a nota que batia com um pedido era recebida "como veio": o que veio menos e o que não
// veio ficavam como falta no pedido, e o que veio a mais ia pelo recebimento avulso. A pessoa explicava depois ("o resto chega
// amanhã", "a cebola eu cancelei") e nada mudava. Agora, antes do "Lançar", o Regem mostra as diferenças, a IA conversa, e a
// decisão de cada uma vira o que o lançamento faz:
//  • veio menos / não veio → "chega depois" (fica num pedido novo, "Faltou de: …", com a data, só com esses itens) ou
//    "cancelado" (não volta a ser pedido);
//  • veio a mais → "no pedido" (entra no próprio pedido, recebido) ou "avulso" (o recebimento avulso, como antes).
// Puro: sem banco. A comparação é por insumo, na unidade do estoque (a quantidade da nota × a conversão), como o recebimento.

export interface DiferencasDoPedido {
  /** Todas as linhas da nota resolvidas (ligadas ao estoque ou fora): só então dá para comparar. */
  pronto: boolean;
  /** Quantos itens do pedido vieram como pedido (ou mais). */
  iguais: number;
  faltas: Array<{ itemId: string; nome: string; pedida: number; veio: number }>;
  aMais: Array<{ itemId: string; nome: string; veio: number }>;
}

const arred = (n: number) => Math.round(n * 10000) / 10000;

/** O que a nota trouxe de cada insumo, na unidade do estoque. */
function veioPorInsumo(nota: Pick<NotaNoMister, 'itens'>): Map<string, { qtd: number; nome: string }> {
  const m = new Map<string, { qtd: number; nome: string }>();
  for (const it of nota.itens) {
    if (it.estado !== 'ligado' || !it.insumoId || !it.fator) continue;
    const a = m.get(it.insumoId) ?? { qtd: 0, nome: it.insumoNome ?? it.descricao };
    a.qtd = arred(a.qtd + it.quantidade * it.fator);
    m.set(it.insumoId, a);
  }
  return m;
}

/** As diferenças entre o pedido (o retrato de quando bateu) e a nota. Sem o retrato, nenhuma (o caminho de antes). */
export function diferencasDoPedido(nota: Pick<NotaNoMister, 'itens' | 'pedido'>): DiferencasDoPedido {
  const itensDoPedido = nota.pedido?.itensDoPedido ?? [];
  const pronto = nota.itens.every((it) => it.estado === 'ligado' || it.estado === 'fora');
  if (!itensDoPedido.length) return { pronto, iguais: 0, faltas: [], aMais: [] };
  const veio = veioPorInsumo(nota);
  const doPedido = new Set(itensDoPedido.map((i) => i.itemId));
  const faltas: DiferencasDoPedido['faltas'] = [];
  let iguais = 0;
  // O mesmo insumo em duas linhas do pedido: a nota cobre a primeira (como o recebimento), a segunda fica sem.
  const usados = new Set<string>();
  for (const l of itensDoPedido) {
    const v = usados.has(l.itemId) ? 0 : (veio.get(l.itemId)?.qtd ?? 0);
    usados.add(l.itemId);
    if (v + 1e-9 >= l.quantidade) iguais++;
    else faltas.push({ itemId: l.itemId, nome: l.nome, pedida: l.quantidade, veio: v });
  }
  const aMais = [...veio.entries()].filter(([id]) => !doPedido.has(id)).map(([itemId, x]) => ({ itemId, nome: x.nome, veio: x.qtd }));
  return { pronto, iguais, faltas, aMais };
}

/** Quantas diferenças ainda esperam a decisão da pessoa. */
export function diferencasSemDecisao(p: Pick<PedidoDaNota, 'decisoes'> | null | undefined, d: DiferencasDoPedido): number {
  const dec = p?.decisoes;
  return d.faltas.filter((f) => !dec?.faltas?.[f.itemId]).length + d.aMais.filter((a) => !dec?.aMais?.[a.itemId]).length;
}

// ───────────────────────────── a decisão que a IA manda ─────────────────────────────

const normal = (t: unknown) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** O item pelo nome dito: o igual, senão o único que contém (ou está contido). Nunca escolhe entre parecidos. */
function acharPorNome<T extends { nome: string }>(dito: unknown, lista: T[]): T | { erro: string } {
  const n = normal(dito);
  if (n.length < 2) return { erro: 'Diga o produto como ele aparece nas diferenças do pedido.' };
  const igual = lista.filter((x) => normal(x.nome) === n);
  if (igual.length === 1) return igual[0];
  const parte = lista.filter((x) => normal(x.nome).includes(n) || n.includes(normal(x.nome)));
  if (parte.length === 1) return parte[0];
  const nomes = lista.map((x) => x.nome).join('; ');
  return { erro: parte.length ? `"${String(dito)}" serve para mais de um item: ${parte.map((x) => x.nome).join('; ')}. Pergunte qual.` : `"${String(dito)}" não está nas diferenças do pedido (${nomes || 'nenhuma'}).` };
}

const DIAS_DO_CHEGA_DEPOIS = 60;

export type DecisoesDoPedido = NonNullable<PedidoDaNota['decisoes']>;

/**
 * A decisão que a IA manda (`documento_em_andamento`, `acao: pedido`): `faltas` (produto, decisao chega_depois ou cancelado,
 * `para` AAAA-MM-DD opcional) e `a_mais` (produto, decisao no_pedido ou avulso). Conferida inteira antes de gravar; soma às
 * decisões que já havia (a pessoa pode responder aos poucos).
 */
export function lerDecisoesDoPedido(
  en: Record<string, unknown>,
  d: DiferencasDoPedido,
  antes: DecisoesDoPedido | undefined,
  hojeIso: string,
): { decisoes: DecisoesDoPedido; feito: string[] } | { erro: string } {
  const faltas = Array.isArray(en.faltas) ? en.faltas : [];
  const aMais = Array.isArray(en.a_mais) ? en.a_mais : [];
  if (!faltas.length && !aMais.length) return { erro: 'Diga o que aconteceu: faltas (produto e decisao) e/ou a_mais (produto e decisao).' };
  const dec: DecisoesDoPedido = { faltas: { ...(antes?.faltas ?? {}) }, aMais: { ...(antes?.aMais ?? {}) } };
  const feito: string[] = [];
  const hoje = Date.parse(`${hojeIso}T00:00:00Z`);
  for (const x of faltas as any[]) {
    const f = acharPorNome(x?.produto, d.faltas);
    if ('erro' in f) return f;
    if (x?.decisao !== 'chega_depois' && x?.decisao !== 'cancelado') return { erro: `${f.nome}: a decisão é chega_depois ou cancelado.` };
    let para: string | null = null;
    if (x.decisao === 'chega_depois' && x.para !== undefined && x.para !== null && String(x.para).trim()) {
      const v = String(x.para).trim();
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
      const data = m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
      if (!m || new Date(data).toISOString().slice(0, 10) !== v) return { erro: `${f.nome}: o dia que chega vai como AAAA-MM-DD.` };
      if (data < hoje || data > hoje + DIAS_DO_CHEGA_DEPOIS * 86_400_000) return { erro: `${f.nome}: o dia ${v} tem de ser de hoje até ${DIAS_DO_CHEGA_DEPOIS} dias: confirme com a pessoa.` };
      para = v;
    }
    dec.faltas[f.itemId] = { decisao: x.decisao, para };
    feito.push(x.decisao === 'cancelado' ? `${f.nome}: sai do pedido (cancelado).` : `${f.nome}: ${num(f.pedida - f.veio)} continua no pedido${para ? `, para ${dia(para)}` : ''}.`);
  }
  for (const x of aMais as any[]) {
    const a = acharPorNome(x?.produto, d.aMais);
    if ('erro' in a) return a;
    if (x?.decisao !== 'no_pedido' && x?.decisao !== 'avulso') return { erro: `${a.nome}: a decisão é no_pedido ou avulso.` };
    dec.aMais[a.itemId] = x.decisao;
    feito.push(x.decisao === 'no_pedido' ? `${a.nome}: entra no pedido.` : `${a.nome}: entra pelo recebimento avulso, fora do pedido.`);
  }
  return { decisoes: dec, feito };
}

// ───────────────────────────── os textos ─────────────────────────────

const num = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dia = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** A pergunta das diferenças (o protótipo, "O documento conversado"): o que veio, o que veio menos, o que não veio e o a mais. */
export function textoDasDiferencas(p: Pick<PedidoDaNota, 'nome' | 'criado'>, d: DiferencasDoPedido, especie: NotaNoMister['especie']): string {
  const doc = especie === 'cupom' ? 'o cupom' : 'a nota';
  const linhas = [
    ...(d.iguais ? [`✓ ${d.iguais === 1 ? '1 item veio' : `${d.iguais} itens vieram`} como pedido`] : []),
    ...d.faltas.map((f) => (f.veio > 0 ? `! ${f.nome}: pedidos ${num(f.pedida)}, vieram ${num(f.veio)}` : `! ${f.nome}: não veio`)),
    ...d.aMais.map((a) => `+ ${a.nome}: ${num(a.veio)} que não estava no pedido`),
  ];
  return `Conferi ${doc} com o pedido "${p.nome}" (${p.criado}), item a item:\n${linhas.join('\n')}\n\nO que aconteceu com esses? Pode contar do seu jeito. Nada foi lançado ainda.`;
}

/** As linhas do pedido no "Vou fazer" (o resumo antes do "Lançar"), montadas pelo Regem a partir das decisões. */
export function linhasDoPedidoNoResumo(d: DiferencasDoPedido, dec: DecisoesDoPedido | undefined): string[] {
  const linhas: string[] = [];
  for (const f of d.faltas) {
    const x = dec?.faltas?.[f.itemId];
    if (!x) continue;
    linhas.push(x.decisao === 'cancelado' ? `• ${f.nome}: sai do pedido (cancelado).` : `• ${f.nome}: ${num(f.pedida - f.veio)} continua num pedido novo${x.para ? `, para ${dia(x.para)}` : ''}.`);
  }
  for (const a of d.aMais) {
    const x = dec?.aMais?.[a.itemId];
    if (x) linhas.push(x === 'no_pedido' ? `• ${a.nome}: entra no pedido.` : `• ${a.nome}: entra pelo recebimento avulso.`);
  }
  return linhas;
}

/** As diferenças para a IA (`ver` e o trabalho em andamento): o que falta decidir, com os nomes que ela usa na decisão. */
export function diferencasParaAIa(d: DiferencasDoPedido, dec: DecisoesDoPedido | undefined) {
  return {
    vieramComoPedido: d.iguais,
    faltas: d.faltas.map((f) => ({ produto: f.nome, pedida: f.pedida, veio: f.veio, decidido: dec?.faltas?.[f.itemId]?.decisao ?? null })),
    aMais: d.aMais.map((a) => ({ produto: a.nome, veio: a.veio, decidido: dec?.aMais?.[a.itemId] ?? null })),
    siga:
      'Pergunte o que aconteceu com cada diferença, do jeito da conversa, e grave com documento_em_andamento acao pedido: faltas (chega_depois, com para AAAA-MM-DD se a pessoa disser o dia; ou cancelado) e a_mais (no_pedido ou avulso). Sem certeza, pergunte; nunca decida sozinho.',
  };
}
