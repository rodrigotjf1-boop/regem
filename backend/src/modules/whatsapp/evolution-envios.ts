// MENSAGENS QUE O PRÓPRIO REGEM MANDOU PELA EVOLUTION (robô, caixa de conversas, campanha) — 15 minutos de memória.
//
// Como a Evolution se comporta (conferido no código dela, 2.3.x): o envio feito pela API (`/message/send*`, do Regem
// ou do n8n) sai no evento SEND_MESSAGE, e o `emitOwnEvents: false` faz o eco dele não voltar como MESSAGES_UPSERT.
// Então um `fromMe` que chega no MESSAGES_UPSERT é de OUTRO aparelho — o celular ou o WhatsApp Web da loja —, ou
// seja, "o atendente assumiu" (o robô pausa).
//
// Este registro é a segunda trava: guarda o id de cada envio feito pelo Regem e, se uma versão futura da Evolution
// voltar a ecoar os envios da API, o eco não pausa o robô à toa. Um `fromMe` com id desconhecido é de gente.
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
