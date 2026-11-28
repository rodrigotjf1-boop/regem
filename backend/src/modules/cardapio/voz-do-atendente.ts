import { createHash } from 'node:crypto';
import { EstiloDaVoz, TONS_DE_QUEM_FALA, TomDeQuemFala, estiloDaVoz } from '../mister/mister-midia.regras';

// A VOZ DO ATENDENTE PELO DMS GRAPH (fase A do plano "o atendente com o jeito do Mister" — o dono, 27/11/2026: "a voz ainda
// não mudou, está robótica… simular respiração nas pausas, calma, alegria, até uma piada leve quando a situação permitir").
// O fluxo do n8n pedia o Gemini TTS direto ao Google em OGG — formato que o Gemini TTS não entrega (só WAV) — e caía sempre
// na reserva (Chirp 3 HD), a voz sem emoção. Agora o fluxo pede a fala ao Regem (`publico/bot/voz`), e o Regem pede ao DMS
// Graph, como o Mister: o Gemini TTS com o tom de cada resposta, convertido em OGG pelo Graph. Regras puras, aqui.

/** Os tons que a transcrição do fluxo devolve na linha "TOM:": os mesmos do Mister (e do `ouvir_audio` do Graph). */
export type TomDoCliente = TomDeQuemFala;

/** O tom que veio do fluxo, só da lista; o resto (vazio, outra palavra) = null (neutro). */
export function tomDoCliente(valor: unknown): TomDoCliente | null {
  const t = String(valor ?? '').trim().toLowerCase();
  return (TONS_DE_QUEM_FALA as readonly string[]).includes(t) ? (t as TomDoCliente) : null;
}

/** O texto que a voz fala: até 1.500 letras (o teto do Graph); o fluxo já manda o principal (~600, ~40 s). */
export const FALA_MAX_DO_ATENDENTE = 1500;
/** O prazo TOTAL da fala (V106): o Graph tem 18 s (Gemini e, se cair, a voz de reserva); o fluxo espera 22 s. */
export const PRAZO_DA_VOZ_DO_ATENDENTE_MS = 20_000;

/** O texto da fala, limpo: sem as marcas do WhatsApp nem emoji; vazio = nada a falar. */
export function textoDaFala(texto: unknown): string {
  return String(texto ?? '')
    .replace(/\p{Extended_Pictographic}|\u{FE0F}|\u{200D}/gu, '')
    .replace(/[*_~`]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/ *\n */g, '\n')
    .trim()
    .slice(0, FALA_MAX_DO_ATENDENTE)
    .trim();
}

const normal = (s: unknown) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/**
 * Onde o atendente nunca ri, além dos temas do Mister: alergia, dinheiro (pagamento, Pix, cobrança, valor, estorno,
 * reembolso) e cancelamento — as mesmas proibições do humor nas instruções (.f41, CARISMA E JOGO DE CINTURA).
 */
const SEM_RISADA_NO_ATENDENTE =
  /\balergi\w*|\balergenic\w*|\bglute\w*|\blactose\b|\bpagamento\w*|\bpag(?:ar|ou|ue|ando)\b|\bpix\b|\bcobran\w*|\bcobr(?:ou|ado|ada|aram)\b|\breembols\w*|\bestorn\w*|\bcancel\w*|\btroco\b/;

/**
 * O estilo da fala do atendente: a MESMA regra do Mister (`estiloDaVoz` — irritado ou preocupado → calma; animado ou
 * brincando → alegria; apressado → direta; perda → séria; risada só com o cliente leve e sem tema ruim), mais as proibições
 * do atendente para a risada, e SEMPRE com as pausas (o ritmo calmo, com respiração entre as frases — contrato 1.8.0 do Graph).
 * Quem decide é este código, nunca a IA, e o texto do cliente nunca vai à instrução de voz (o Graph só recebe valores fixos).
 */
export function estiloDaVozDoAtendente(tom: TomDoCliente | null, resposta: unknown, pergunta?: unknown): EstiloDaVoz & { pausas: true } {
  const base = estiloDaVoz(tom, resposta, pergunta);
  const semRisada = base.risada && SEM_RISADA_NO_ATENDENTE.test(`${normal(resposta)}\n${normal(pergunta)}`);
  return { tom: base.tom, risada: semRisada ? false : base.risada, pausas: true };
}

/**
 * A chave de idempotência da fala do atendente no Graph: a empresa, o texto, o estilo e a voz (a mesma resposta repetida
 * não gasta a franquia de novo; com outro estilo, outra chave — o Graph recusa a mesma chave com outro pedido). Diferente
 * da do Mister (`chaveDaFala`): a mesma frase dita pelo Mister, na voz masculina, não pode bater com a do atendente.
 */
export function chaveDaFalaDoAtendente(tenantId: string, texto: string, estilo: { tom: string; risada: boolean; pausas?: boolean }): string {
  const base = `atendente\n${tenantId}\n${texto}\n${estilo.tom}\n${estilo.risada ? 1 : 0}\n${estilo.pausas ? 1 : 0}\nfeminina`;
  return `regem-atendente-${createHash('sha256').update(base).digest('hex').slice(0, 48)}`;
}
