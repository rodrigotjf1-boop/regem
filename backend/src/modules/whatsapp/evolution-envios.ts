// MENSAGENS QUE O PRÓPRIO REGEM MANDOU PELA EVOLUTION (robô, caixa de conversas, campanha) — 15 minutos de memória.
//
// A Evolution devolve no webhook, como `fromMe`, TODA mensagem que saiu do número da loja: as que o Regem mandou pela
// API e as que alguém digitou no celular/WhatsApp Web da loja. Só as do celular são "o atendente assumiu" (o robô
// pausa). O id de cada envio feito pelo Regem fica aqui; um `fromMe` com id desconhecido é de gente.
//
// Em memória deste processo: com mais de uma réplica da API, o envio feito por outra réplica pareceria humano (o robô
// pausaria à toa naquela conversa) — o custo é pausar a mais, nunca responder por cima do atendente.

const VALIDADE_MS = 15 * 60 * 1000;
const enviados = new Map<string, number>(); // id da mensagem → até quando lembrar

export function lembrarEnvio(id: unknown): void {
  const k = String(id ?? '').trim();
  if (!k) return;
  enviados.set(k, Date.now() + VALIDADE_MS);
  if (enviados.size > 20_000) limpar();
}

export function foiEnviadoPeloRegem(id: unknown): boolean {
  const ate = enviados.get(String(id ?? '').trim());
  return !!ate && ate > Date.now();
}

function limpar() {
  const agora = Date.now();
  for (const [k, ate] of enviados) if (ate <= agora) enviados.delete(k);
}

/** Só para teste. */
export function esquecerEnvios(): void {
  enviados.clear();
}
