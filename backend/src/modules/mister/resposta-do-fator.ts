import { normalizarUnidade } from '../estoque/unidades';

// A RESPOSTA A "1 PACOTE TEM QUANTOS FARDOS?" (ERR-584). Pegar o primeiro número da frase transformou "pacote e fardo são
// sinônimos e têm 12 unidades cada" em 1 pacote = 12 fardos: 70 pacotes viraram 840 fardos. Aqui a frase só vira conta quando
// diz de qual unidade é o número. O que não dá para saber volta como pergunta, nunca como palpite.

export type RespostaDoFator =
  /** Só o número ("12", "12 fardos"): é a resposta da pergunta. */
  | { tipo: 'numero'; fator: number }
  /** Uma frase que dá para entender ("é a mesma coisa", "1 pacote tem 12 fardos"): mostra a conta antes de valer. */
  | { tipo: 'confirmar'; fator: number }
  /** Parece resposta, mas não diz quantos ("tem 12 unidades"): pergunta de novo. */
  | { tipo: 'duvida' }
  /** Não é resposta: segue como conversa. */
  | { tipo: 'outro' };

const MAX_FATOR = 100_000;
const NUMERO = String.raw`\d+(?:[.,]\d+)*`;
const MESMA_UNIDADE = /\b(sinonimos?|mesma coisa|mesma unidade|mesma medida|(?:e|sao) (?:o|a) mesm[oa]|(?:e|sao) iguais?|um (?:pra|para|por) um|1 (?:pra|para|por) 1)\b/;

const semAcento = (t: string) =>
  t
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** "12", "2,5", "1.000" (milhar): positivo e dentro do teto, ou null. */
function numeroDe(s: string): number | null {
  const limpo = /^\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, '') : s.replace(',', '.');
  if ((limpo.match(/\./g) ?? []).length > 1) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n > 0 && n < MAX_FATOR ? n : null;
}

const unidadeDe = (u: string | null | undefined): string | null => (u ? (normalizarUnidade(u) ?? semAcento(u)) : null);

export function lerRespostaDoFator(texto: unknown, unidadePedida: string | null | undefined, unidadeDoEstoque: string | null | undefined): RespostaDoFator {
  const t = semAcento(String(texto ?? ''));
  if (!t) return { tipo: 'outro' };
  const pedida = unidadeDe(unidadePedida);
  const estoque = unidadeDe(unidadeDoEstoque);

  // Só o número, com a unidade do estoque ou sem nenhuma.
  const so = new RegExp(`^(?:(?:sao|e|tem|da|vem|fica|deu) )?(${NUMERO}) ?([a-z]+)?[.!]?$`).exec(t);
  if (so) {
    const n = numeroDe(so[1]);
    if (n == null) return { tipo: 'duvida' };
    return !so[2] || unidadeDe(so[2]) === estoque ? { tipo: 'numero', fator: n } : { tipo: 'duvida' };
  }

  if (MESMA_UNIDADE.test(t)) return /\bnao\b/.test(t) ? { tipo: 'duvida' } : { tipo: 'confirmar', fator: 1 };

  // "1 pacote tem 12 fardos", "12 pacotes fazem 1 fardo", "cada caixa tem 9 kg".
  const pares = [...t.matchAll(new RegExp(`(${NUMERO}) ?([a-z]+)`, 'g'))].map((m) => ({ n: numeroDe(m[1]), u: unidadeDe(m[2]) }));
  const doEstoque = pares.filter((p) => p.u === estoque);
  const daPedida = pedida === estoque ? [] : pares.filter((p) => p.u === pedida);
  if (estoque && doEstoque.length === 1 && daPedida.length <= 1) {
    const b = doEstoque[0].n;
    const a = daPedida.length ? daPedida[0].n : 1;
    if (a != null && b != null) {
      const fator = Math.round((b / a) * 1_000_000) / 1_000_000;
      if (fator > 0 && fator < MAX_FATOR) return { tipo: 'confirmar', fator };
    }
    return { tipo: 'duvida' };
  }

  const palavras = t.split(' ');
  const cita = (u: string | null) => !!u && palavras.some((p) => unidadeDe(p.replace(/[^a-z]/g, '')) === u);
  if (cita(pedida) && cita(estoque)) return { tipo: 'duvida' };
  if (/\d/.test(t) && !t.includes('?') && (cita(pedida) || cita(estoque) || palavras.length <= 6)) return { tipo: 'duvida' };
  return { tipo: 'outro' };
}

/** "sim" ou "não" à conta mostrada. Outra coisa: null (a frase é lida como uma resposta nova). */
export function simOuNao(texto: unknown): 'sim' | 'nao' | null {
  const t = semAcento(String(texto ?? '')).replace(/[.!,]+$/g, '');
  if (/^(sim|s|isso|isso mesmo|certo|correto|exato|ok|confirmo|pode|pode ser|esta certo)$/.test(t)) return 'sim';
  if (/^(nao|n|errado|esta errado|nao e)$/.test(t)) return 'nao';
  return null;
}
