import { dataBr, hojeIso, num, type Tom } from '@/components/ui/lista';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O que as partes da tela de Ordens de produção têm em comum: os nomes das situações, em que
// grupo cada uma cai e como a ordem se apresenta numa linha.

export const STATUS_LABEL: Record<string, string> = {
  planejada: 'Planejada',
  liberada: 'Liberada',
  em_producao: 'Em produção',
  concluida_total: 'Concluída (total)',
  concluida_parcial: 'Concluída (parcial)',
  nao_concluida: 'Não concluída',
  aguardando_lancamento: 'Aguardando lançamento',
  pendencia_critica: 'Pendência crítica',
  cancelada: 'Cancelada',
};
export const STATUS_TOM: Record<string, Tom> = {
  planejada: 'neutro',
  liberada: 'info',
  em_producao: 'aviso',
  concluida_total: 'ok',
  concluida_parcial: 'ok',
  nao_concluida: 'neutro',
  aguardando_lancamento: 'critico',
  pendencia_critica: 'critico',
  cancelada: 'neutro',
};
export const situacaoDe = (o: any): string => STATUS_LABEL[o.status] ?? String(o.status);

export const A_FAZER = 0;
export const EM_PRODUCAO = 1;
export const PENDENCIA = 2;
export const ENCERRADA = 3;
/** Grupo da ordem; -1 = situação que esta tela não conhece (aparece só em "Todas"). */
export function grupoDe(o: any): number {
  if (['planejada', 'liberada'].includes(o.status)) return A_FAZER;
  if (o.status === 'em_producao') return EM_PRODUCAO;
  if (['aguardando_lancamento', 'pendencia_critica'].includes(o.status)) return PENDENCIA;
  if (['concluida_total', 'concluida_parcial', 'nao_concluida', 'cancelada'].includes(o.status)) return ENCERRADA;
  return -1;
}

export const fichaDe = (o: any): string => o.fichaNome ?? 'Ficha';
export const quandoDe = (o: any): string => `${dataBr(o.dataProducao)}${o.horaInicio ? `, ${String(o.horaInicio).slice(0, 5)}` : ''}`;
export const quantidadeDe = (o: any): string => `${num(o.quantidadePlanejada)} ${o.unidade ?? ''}`.trim();
/** Nome da ordem para os rótulos das ações: a mesma ficha se repete em dias diferentes. */
export const rotuloDe = (o: any): string => `${fichaDe(o)} (${quandoDe(o)})`;
/** A linha de apoio: quantidade, quanto rendeu (no parcial) e o motivo (não concluída, cancelada). */
export function apoioDe(o: any): string {
  return [
    quantidadeDe(o),
    o.status === 'concluida_parcial' ? `rendeu ${num(o.quantidadeProduzida)} de ${num(o.quantidadePlanejada)}` : '',
    o.motivo ? `motivo: ${o.motivo}` : '',
  ].filter(Boolean).join(' · ');
}

// O que o servidor aceita em cada situação (`ordem-producao.service.ts`).
export const podeLiberar = (o: any) => o.status === 'planejada';
export const podeIniciar = (o: any) => ['planejada', 'liberada'].includes(o.status);
export const podeConcluir = (o: any) => ['liberada', 'em_producao', 'aguardando_lancamento', 'pendencia_critica'].includes(o.status);
export const podeCancelar = (o: any) => grupoDe(o) !== ENCERRADA;

/** yyyy-mm-dd de `n` dias atrás, no fuso da loja (com `toISOString()` a noite já seria amanhã). */
export function diasAtras(n: number): string {
  return new Date(Date.parse(`${hojeIso()}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
}
