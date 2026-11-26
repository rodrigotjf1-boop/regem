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
  /** A linha a mais no link do PIN para quem ligou o PIN falado. */
  noLink: 'Ou mande um áudio seu falando o PIN (não vale áudio encaminhado).',
} as const;
