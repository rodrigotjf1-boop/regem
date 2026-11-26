/* eslint-disable @typescript-eslint/no-explicit-any */

// O "DIGITANDO…" RENOVADO (26/11/2026, análise do atendente que demorou mais de 2 min): a Meta tira o indicador em 25 s
// (doc "Typing indicators"), e a resposta do robô leva 34 s na mediana medida na loja piloto (até ~90 s com áudio) — o
// cliente via o "digitando" sumir e ficava no silêncio, achando que ninguém respondia. Agora, enquanto a resposta não sai,
// o indicador é mandado de novo a cada 20 s, até o `responder` parar (`pararDigitando`) ou o teto de 2,5 min (o robô que
// não responde não deixa o cliente vendo "digitando" para sempre). Em memória deste processo, por conversa (empresa +
// telefone), como a junção das mensagens e a resposta em andamento.

const RENOVAR_MS = 20_000;
const TETO_MS = 150_000;

const renovando = new Map<string, { timer: ReturnType<typeof setInterval>; ate: number }>();
let relogio: () => number = () => Date.now();

const chave = (tenantId: unknown, telefone: unknown) => `${String(tenantId ?? '')}:${String(telefone ?? '').replace(/\D/g, '')}`;

/**
 * Começa (ou recomeça) a renovar o "digitando…" desta conversa. `mostrar` manda o indicador (já foi mandado uma vez por
 * quem chama). Nunca lança: o indicador é enfeite — sem ele, o robô responde igual.
 */
export function renovarDigitando(tenantId: unknown, telefone: unknown, mostrar: () => void): void {
  const k = chave(tenantId, telefone);
  if (!String(tenantId ?? '') || k.endsWith(':')) return;
  pararDigitando(tenantId, telefone);
  const ate = relogio() + TETO_MS;
  const timer = setInterval(() => {
    if (relogio() >= ate) return pararDigitando(tenantId, telefone);
    try {
      mostrar();
    } catch {
      /* o indicador nunca derruba nada */
    }
  }, RENOVAR_MS);
  // Não segura o processo vivo (desligar o servidor não espera o indicador).
  (timer as any)?.unref?.();
  renovando.set(k, { timer, ate });
}

/** A resposta saiu (ou não vai sair): para de renovar. Sem renovação aberta, não faz nada. */
export function pararDigitando(tenantId: unknown, telefone: unknown): void {
  const k = chave(tenantId, telefone);
  const r = renovando.get(k);
  if (r) clearInterval(r.timer);
  renovando.delete(k);
}

/** Só para teste. */
export function renovandoAgora(tenantId: unknown, telefone: unknown): boolean {
  return renovando.has(chave(tenantId, telefone));
}
export function trocarRelogioDoDigitando(r: (() => number) | null): void {
  relogio = r ?? (() => Date.now());
}
export function esquecerDigitando(): void {
  for (const r of renovando.values()) clearInterval(r.timer);
  renovando.clear();
}
