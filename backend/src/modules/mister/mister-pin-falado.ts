// FALAR O PIN (Mister, versão 10, fase C5 — decisão V10-5; protótipo `mockups/regem-mister-v10.html`, "ligar e usar o PIN
// falado"; `docs/plano-mister.md` § "C5"; mig 507).
//
//  • Cada pessoa liga para SI, confirmando o PIN uma vez pela página do PIN (a proposta `ligar_pin_falado`), sabendo do risco: o
//    áudio fica no celular, e quem pegar o celular destravado pode ouvir.
//  • Com uma proposta de PIN esperando, o áudio DELA — nunca o encaminhado — é transcrito e os números são conferidos pelo
//    CÓDIGO, antes da fila, da IA e da memória. Nada fica guardado (nem o áudio, nem a transcrição, nem os números). Os erros
//    falados e os digitados somam no mesmo bloqueio de 5. Depois, o Mister pede para apagar o áudio.
//  • O presidente vê quem ligou e desliga em Mister › Pessoas. Nasce desligado (`MISTER_PIN_FALADO=1`, depois do teste com 20
//    áudios reais).

export const pinFaladoLigado = (): boolean => process.env.MISTER_PIN_FALADO === '1';

/** Os números falados por extenso (o "meia" é o 6 de quem dita número no Brasil). */
const NUMEROS_FALADOS: Record<string, string> = {
  zero: '0',
  um: '1',
  uma: '1',
  dois: '2',
  duas: '2',
  tres: '3',
  quatro: '4',
  cinco: '5',
  seis: '6',
  meia: '6',
  sete: '7',
  oito: '8',
  nove: '9',
};

/**
 * O PIN dito no áudio, pela transcrição: os dígitos e os números por extenso, na ordem em que vieram. Só vale com 4 a 6 dígitos
 * no total (o tamanho do PIN); fora disso, null — o Mister diz que não entendeu, e isso NÃO conta como PIN errado.
 */
export function pinNoTexto(transcricao: unknown): string | null {
  const t = String(transcricao ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  let pin = '';
  for (const parte of t.split(/[^a-z0-9]+/)) {
    if (!parte) continue;
    if (/^\d+$/.test(parte)) pin += parte;
    else if (NUMEROS_FALADOS[parte]) pin += NUMEROS_FALADOS[parte];
  }
  return /^\d{4,6}$/.test(pin) ? pin : null;
}

/**
 * Rodada 7, MIS-D-13 (ERR-655): a transcrição de um áudio é SÓ um PIN (4 a 6 dígitos ditos, e quase nada além)? Então ela não
 * vira pergunta — nem na fila, nem na IA, nem na resposta "🎧 Entendi" — mesmo quando não há pedido esperando o PIN (o PIN
 * falado desligado, o link vencido, já autorizado). Frase com número no meio de palavras ("vendi 1500 hoje?") segue.
 */
export function pareceSoUmPin(transcricao: unknown): boolean {
  if (!pinNoTexto(transcricao)) return false;
  const palavras = String(transcricao ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  // Tirados os números e as palavras do PIN ("o meu pin é"), sobra no máximo uma palavra: é "só o PIN" ("o meu pin é 2 5 8 0").
  const outras = palavras.filter((p) => !/^\d+$/.test(p) && !NUMEROS_FALADOS[p] && !PALAVRAS_DO_PIN.has(p));
  return outras.length <= 1;
}
/** MIS-D-04 (ERR-655): PIN errado da mesma pessoa em 24 horas, somados os links e a voz, que travam o PIN pelo Mister. */
export const PIN_ERRADOS_NO_DIA = 10;

/** MIS-D-11: "Autorizar: estoque: remover item?" → "estoque: remover item" (o que o "PIN conferido" diz). Vazio → null. */
export function oQueFoiAutorizado(titulo: unknown): string | null {
  const t = String(titulo ?? '')
    .replace(/^\s*autorizar\s*:?\s*/i, '')
    .replace(/\?\s*$/, '')
    .trim();
  return t ? `${t.charAt(0).toLowerCase()}${t.slice(1)}`.slice(0, 120) : null;
}

const PALAVRAS_DO_PIN = new Set(['o', 'a', 'e', 'eh', 'meu', 'minha', 'pin', 'senha', 'codigo', 'numero', 'ta', 'aqui', 'ai', 'ok']);

export const TEXTOS_DO_PIN_FALADO = {
  /** O que a IA diz ao propor ligar (o link vai logo depois). */
  sigaDoLigar:
    'Diga em duas frases: o risco (o áudio fica gravado no celular; quem pegar o celular destravado pode ouvir o PIN) e que o link para confirmar o PIN uma vez vai logo depois. Digitar continua valendo sempre.',
  jaLigado: 'O PIN falado já está ligado para esta pessoa. Para desligar, é só pedir.',
  desligado: 'Pronto: o PIN falado está desligado para você. O PIN segue pelo link, digitado.',
  naoEstavaLigado: 'O PIN falado não estava ligado para esta pessoa.',
  desligadoNaDistribuicao: 'O PIN falado ainda não está disponível nesta instalação. O PIN segue pelo link, digitado.',
  /** As respostas ao áudio com o PIN. */
  encaminhado: 'Áudio encaminhado não vale para o PIN. Mande um áudio seu, falando o PIN, ou use o link.',
  naoEntendi: 'Não entendi o PIN no áudio. Fale os números um por um, devagar, ou use o link. Isso não conta como PIN errado.',
  naoOuvi: 'Não consegui ouvir o áudio agora. Use o link para digitar o PIN.',
  apagueOAudio: 'Agora apague o áudio do PIN desta conversa: toque e segure nele › Apagar › Apagar para mim.',
  autorizado: 'PIN conferido. Fazendo agora…',
  errado: (restam: number) => `PIN errado. ${restam === 1 ? 'Resta 1 tentativa' : `Restam ${restam} tentativas`} (falando ou pelo link).`,
  bloqueado: 'PIN errado 5 vezes: esta autorização foi bloqueada e nada foi feito. Peça de novo, se ainda precisar.',
  // Rodada 7, MIS-D-13 (ERR-655): o áudio que era o PIN nunca vira pergunta — sem pedido esperando, ou com erro, a resposta é fixa.
  semPedido: 'Não há mais pedido esperando o PIN (venceu ou já foi respondido). Nada foi feito. Se ainda precisar, peça de novo.',
  naoOuviAgora: 'Não consegui ouvir o áudio agora. Mande de novo daqui a pouco, ou escreva.',
  pareceUmPin: 'Esse áudio parece um PIN. O PIN não vai para a conversa: para autorizar, use o link do pedido. Apague o áudio: toque e segure nele › Apagar › Apagar para mim.',
  /** MIS-D-11: com mais de um pedido esperando o PIN, o áudio não escolhe — cada um pelo próprio link. */
  maisDeUm: 'Há mais de um pedido esperando o seu PIN: para não autorizar o errado, use o link de cada um. Nada foi feito.',
  /** MIS-D-12: só a nota de voz gravada na hora vale (o arquivo de áudio anexado, não). */
  soNotaDeVoz: 'Para o PIN, grave uma nota de voz na hora (segure o microfone). Arquivo de áudio não vale. Ou use o link.',
  /** MIS-D-11: o "conferido" diz o que foi autorizado. */
  autorizadoO: (oQue: string) => `PIN conferido: ${oQue}. Fazendo agora…`,
  /** MIS-D-04: o teto de PIN errado da pessoa no dia (página e voz somados). */
  travadoNoDia: `Foram ${PIN_ERRADOS_NO_DIA} PIN errados nas últimas 24 horas: pelo Mister o PIN fica travado até amanhã, e nada foi feito. Faça pela tela do Regem.`,
  /** A linha a mais no link do PIN para quem ligou o PIN falado. */
  noLink: 'Ou mande um áudio seu falando o PIN (não vale áudio encaminhado).',
} as const;
