import { itensSomamOTotal, numeroDoTexto, somaDosItens, type ItemDaNota, type NotaNoMister, type ProblemaDaNota } from './nota-por-foto';

// A DÚVIDA NA NOTA E NO CUPOM (L2b da leitura de fotos; `docs/plano-mister.md` § "Leitura de fotos"). Antes, uma linha mal lida
// recusava a foto inteira. Agora o Mister guarda o que leu, diz o que ficou em dúvida e a pessoa responde o certo ou manda outra
// foto. Nada é lançado antes disso: quem responde é ela, e o código nunca escolhe entre as opções. Só regras, sem banco.

/** O botão de seguir com a soma que não fecha: `doc:ns:<documento>`. */
export const PREFIXO_LANCAR_ASSIM = 'doc:ns:';
export const botaoLancarAssim = (documentoId: string) => ({ id: `${PREFIXO_LANCAR_ASSIM}${documentoId}`, titulo: 'Lançar assim' });
export function lerLancarAssim(botaoId: unknown): string | null {
  const m = /^doc:ns:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(String(botaoId ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** Os problemas da leitura que viram pergunta. Os outros (chave de outro emitente, ilegível, sem itens) continuam pedindo outra foto. */
const QUE_SE_PERGUNTAM: readonly ProblemaDaNota[] = ['itens_nao_somam', 'sem_total'];
export const podePerguntar = (problemas: readonly ProblemaDaNota[]): boolean => problemas.every((p) => QUE_SE_PERGUNTAM.includes(p));

/** O motivo gravado no documento enquanto ele espera a resposta sobre a leitura. */
export const ehMotivoDaLeitura = (motivo: unknown): boolean => /^duvida:\d+$/.test(String(motivo ?? '')) || motivo === 'total' || motivo === 'soma';

/** O que falta a pessoa dizer sobre a leitura, nesta ordem: as linhas, o total, a soma. Null = a leitura está resolvida. */
export function pendenciaDaLeitura(n: Pick<NotaNoMister, 'itens' | 'valorTotalCentavos' | 'descontoCentavos' | 'semSomar'>): string | null {
  const i = n.itens.findIndex((x) => x.duvida);
  if (i >= 0) return `duvida:${i}`;
  if (!n.valorTotalCentavos) return 'total';
  if (!n.semSomar && !itensSomamOTotal(n.itens, n.descontoCentavos, n.valorTotalCentavos)) return 'soma';
  return null;
}

const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const NUMERO = /\d+(?:[.,]\d+)*/g;
const MAX_DA_RESPOSTA = 60;
const MAX_QUANTIDADE = 100_000;

/** O único número de uma resposta curta ("são 2", "7 unidades"). Pergunta, frase longa ou dois números diferentes não valem. */
export function numeroDaResposta(texto: unknown): number | 'varios' | null {
  const t = String(texto ?? '').trim();
  if (!t || t.length > MAX_DA_RESPOSTA || t.includes('?')) return null;
  const achados = [...new Set(t.match(NUMERO) ?? [])];
  if (!achados.length) return null;
  // "são 2" e "7 unidades" respondem; "me manda o relatório de 2025" é outra conversa.
  if (t.replace(NUMERO, ' ').trim().split(/\s+/).filter(Boolean).length > 3) return null;
  if (achados.length > 1) return 'varios';
  const n = numeroDoTexto(achados[0]);
  return n != null && n > 0 && n <= MAX_QUANTIDADE ? n : null;
}

export type RespostaDaDuvida = 'ok' | 'repete' | 'outro';

const CONVERSA_NAO_E_PRODUTO = /\b(confirm\w*|correc\w*|corrig\w*|certo|certa|ok|isso|sim|nao|pode|anotad\w*|registr\w*|vincul\w*|lancar|lanca|lancado|obrigad\w*|entendi|perfeito|beleza)\b/;

/** "Confirmado a correção" virou o nome de uma linha do cupom real: confirmação é conversa, nunca nome de produto. */
export const pareceConversa = (texto: unknown): boolean =>
  CONVERSA_NAO_E_PRODUTO.test(
    String(texto ?? '')
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .toLowerCase(),
  );

/**
 * Aplica a resposta à linha em dúvida. `outro` = não é resposta (segue como conversa com o Mister); `repete` = parece resposta,
 * mas não dá para saber qual; `ok` = a linha foi corrigida e saiu da dúvida.
 */
export function responderDuvidaDoItem(it: ItemDaNota, texto: unknown): RespostaDaDuvida {
  const d = it.duvida;
  if (!d) return 'outro';
  if (d.campo === 'descricao') {
    const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
    if (t.length < 2 || t.length > MAX_DA_RESPOSTA || t.includes('?') || t.split(' ').length > 6 || !/\p{L}/u.test(t) || pareceConversa(t)) return 'outro';
    it.descricao = t;
    it.duvida = null;
    return 'ok';
  }
  const n = numeroDaResposta(texto);
  if (n === null) return 'outro';
  if (n === 'varios') return 'repete';
  if (d.campo === 'quantidade') {
    it.quantidade = Math.round(n * 1000) / 1000;
    if (it.valorUnitarioCentavos != null) it.valorTotalCentavos = Math.round(it.valorUnitarioCentavos * it.quantidade);
  } else {
    it.valorTotalCentavos = Math.round(n * 100);
  }
  it.duvida = null;
  return 'ok';
}

const ITEM_DIGITADO =
  /^(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml|un|und|cx|caixas?|pct|pacotes?|fd|fardos?|sc|sacos?|dz)?\s+(.{2,60}?)\s+(?:a\s+|por\s+|de\s+)?(?:r\$\s*)?(\d+(?:\.\d{3})*,\d{2}|\d+\.\d{2})(?:\s*reais)?$/i;

/** O item que faltou, escrito pela pessoa: "2 cx tomate 60,00" (o valor é o total da linha). */
export function lerItemDigitado(texto: unknown): ItemDaNota | null {
  const m = ITEM_DIGITADO.exec(String(texto ?? '').replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const quantidade = numeroDoTexto(m[1]);
  const valor = numeroDoTexto(m[4]);
  if (!quantidade || quantidade > MAX_QUANTIDADE || !valor) return null;
  return {
    descricao: m[3].trim(),
    codigo: null,
    quantidade,
    unidade: m[2] ? m[2].toUpperCase() : null,
    valorUnitarioCentavos: null,
    valorTotalCentavos: Math.round(valor * 100),
  };
}

const nomeDoDocumento = (n: Pick<NotaNoMister, 'especie'>) => (n.especie === 'cupom' ? 'do cupom' : 'da nota');
const OUTRA_FOTO = 'Se preferir, mande outra foto dessa parte.';

/** Com as opções numéricas da dúvida, a soma de cada uma contra o total. Só mostra: quem escolhe é a pessoa. */
function contaDasOpcoes(n: NotaNoMister, i: number): string | null {
  const it = n.itens[i];
  const unit = it.valorUnitarioCentavos;
  if (it.duvida?.campo !== 'quantidade' || unit == null || !n.valorTotalCentavos) return null;
  const opcoes = [...new Set(it.duvida.texto.match(NUMERO) ?? [])].map((x) => numeroDoTexto(x)).filter((x): x is number => !!x && x > 0);
  if (opcoes.length < 2 || opcoes.length > 3) return null;
  const outras = n.itens.filter((_, k) => k !== i);
  // Só com os outros itens resolvidos a conta diz alguma coisa.
  if (outras.some((x) => x.duvida)) return null;
  return opcoes
    .map((q) => {
      const linha = { ...it, quantidade: q, valorTotalCentavos: Math.round(unit * q) };
      const soma = somaDosItens([...outras, linha], n.descontoCentavos);
      return itensSomamOTotal([...outras, linha], n.descontoCentavos, n.valorTotalCentavos) ? `Com ${q}, a soma fecha com o total de ${reais(n.valorTotalCentavos)}.` : `Com ${q}, daria ${reais(soma)}.`;
    })
    .join(' ');
}

export const FRASES_DA_LEITURA = {
  duvida: (n: NotaNoMister, i: number): string => {
    const it = n.itens[i];
    const d = it.duvida!;
    const emDuvida = n.itens.filter((x) => x.duvida).length;
    const abre = emDuvida > 1 ? `Li ${n.itens.length} itens, e ${emDuvida} ficaram em dúvida. Vamos um por vez.` : `Li ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'}, e só a linha ${i + 1} ficou em dúvida.`;
    const qual = d.campo === 'quantidade' ? `quantidade *${d.texto}*` : d.campo === 'valor' ? `valor *${d.texto}*` : `o produto: *${d.texto}*`;
    const pede = d.campo === 'quantidade' ? 'Qual é a quantidade?' : d.campo === 'valor' ? 'Qual é o valor total dessa linha?' : 'Qual é o produto?';
    const conta = contaDasOpcoes(n, i);
    return `${abre}\n\n*${it.descricao}*, ${qual}.${conta ? `\n${conta}` : ''}\n\n${pede} ${OUTRA_FOTO}`;
  },
  total: (n: NotaNoMister): string =>
    `Li ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'}, que somam ${reais(somaDosItens(n.itens, n.descontoCentavos))}, mas não consegui ler o total ${nomeDoDocumento(n)}.\n\nQual é o total? ${OUTRA_FOTO}`,
  soma: (n: NotaNoMister): string => {
    const soma = somaDosItens(n.itens, n.descontoCentavos);
    const dif = n.valorTotalCentavos - soma;
    return (
      `Li ${n.itens.length} ${n.itens.length === 1 ? 'item' : 'itens'}, que somam ${reais(soma)}, e o total ${nomeDoDocumento(n)} é ${reais(n.valorTotalCentavos)}. ` +
      `${dif > 0 ? `Faltam ${reais(dif)}: alguma linha não saiu na foto.` : `Sobram ${reais(-dif)}: alguma linha foi lida errada.`}\n\n` +
      'Você pode:\n• mandar outra foto da parte dos produtos;\n• me dizer o que faltou, assim: 2 cx tomate 60,00 (o valor é o total da linha);\n' +
      '• tocar em "Lançar assim": a conta entra pelo total impresso, e o estoque só com os itens que li.'
    );
  },
  repete: (it: ItemDaNota): string => `Não entendi qual é. Para *${it.descricao}*, me diga só um número, ou mande outra foto dessa parte.`,
  repeteTotal: 'Não entendi qual é o total. Me diga só o valor, ou mande outra foto.',
};
