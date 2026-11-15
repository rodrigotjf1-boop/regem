import type { MotivoSemResposta } from './mister-agente.regras';

// A QUALIDADE DO MISTER, parte 1 (F5 do docs/plano-mister.md — a linha de base; protótipo
// mockups/regem-dependencias-e-qualidade.html, vista "Console › Mister › Qualidade"). Só números: nunca o texto da
// pergunta ou da resposta (é da loja). As regras puras: os períodos aceitos e o texto de cada motivo de não responder.
// A parte 2 (o assunto das perguntas sem resposta e a avaliação de regressão) pede migration.

export const PERIODOS_DA_QUALIDADE = [7, 30] as const;
export type PeriodoDaQualidade = (typeof PERIODOS_DA_QUALIDADE)[number];

/** O período pedido (7 ou 30 dias); qualquer outra coisa vira 7. */
export function periodoDaQualidade(v: unknown): PeriodoDaQualidade {
  return Number(v) === 30 ? 30 : 7;
}

/** Por que não respondeu, como o console mostra (os motivos são os de `MotivoSemResposta`). */
export const MOTIVO_NA_QUALIDADE: Record<MotivoSemResposta, string> = {
  sem_chave: 'a empresa não tem chave de IA',
  chave_recusada: 'a chave de IA da empresa foi recusada',
  sem_credito: 'sem crédito na conta de IA',
  teto_atingido: 'a conta de IA chegou ao teto de gasto',
  limite_por_minuto: 'a IA não respondeu (passageiro)',
  indisponivel: 'a IA não respondeu (passageiro)',
  pedido_invalido: 'a IA não respondeu (passageiro)',
  erro: 'a IA não respondeu (passageiro)',
  recusou: 'o assunto não é do Mister',
  nao_fechou: 'não fechou a resposta',
  limite: 'a pessoa chegou ao limite de perguntas',
  demorou: 'passou do tempo',
  interrompida: 'passou do tempo',
  desligado: 'o Mister estava desligado',
  sem_acesso: 'a pessoa não tinha acesso',
  envio: 'a resposta não saiu pelo WhatsApp',
  manutencao: 'em manutenção',
};

export function motivoNaQualidade(m: unknown): string {
  return MOTIVO_NA_QUALIDADE[String(m ?? '') as MotivoSemResposta] ?? 'outro motivo';
}

/** As linhas dos motivos agrupadas pelo texto (vários motivos dizem a mesma coisa), da maior para a menor. */
export function motivosAgrupados(linhas: Array<{ motivo: unknown; n: number }>): Array<{ motivo: string; quantas: number }> {
  const porTexto = new Map<string, number>();
  for (const l of linhas) {
    const t = motivoNaQualidade(l.motivo);
    porTexto.set(t, (porTexto.get(t) ?? 0) + (Number(l.n) || 0));
  }
  return [...porTexto.entries()].map(([motivo, quantas]) => ({ motivo, quantas })).sort((a, b) => b.quantas - a.quantas || a.motivo.localeCompare(b.motivo));
}

/** O nome da consulta como o console mostra ("resumo_do_dia" → "resumo do dia"). */
export const nomeDaConsultaNaQualidade = (n: unknown): string => String(n ?? '').replace(/_/g, ' ').trim() || 'consulta sem nome';

/** Percentual inteiro (0 quando não há base). */
export const pct = (parte: number, total: number): number => (total > 0 ? Math.round((parte / total) * 100) : 0);
