// O TURNO DO CAIXA NÃO DEVE FICAR ABERTO MAIS DE 24 HORAS (pedido do dono, 12/11/2026: "ideal é o turno não ficar mais de 24
// horas aberto e, se passar, pedir o fechamento"). O turno é a sessão do caixa (`caixa_sessao`, "Turno N"). A conta usa o
// relógio do SERVIDOR (o do computador da loja pode estar errado); a tela só mostra e pede o fechamento — não trava a venda.

export const TURNO_LIMITE_HORAS = 24;

/** Há quantas horas o turno está aberto e se passou do limite. Sem a hora de abertura: 0 e não passou. */
export function idadeDoTurno(abertaEm: Date | string | null | undefined, agora: number = Date.now()): { horasAberto: number; passouDoLimite: boolean } {
  const t = abertaEm instanceof Date ? abertaEm.getTime() : abertaEm ? Date.parse(abertaEm) : NaN;
  if (!Number.isFinite(t)) return { horasAberto: 0, passouDoLimite: false };
  const horasAberto = Math.max(0, Math.floor((agora - t) / 3_600_000));
  return { horasAberto, passouDoLimite: agora - t >= TURNO_LIMITE_HORAS * 3_600_000 };
}
