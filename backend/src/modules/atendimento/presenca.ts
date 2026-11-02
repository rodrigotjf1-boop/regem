import { BadRequestException } from '@nestjs/common';

// "DISPONÍVEL / OCUPADO: EMBALANDO" — quem atende pelo app "Regem Atendimento" (mig 353, protótipo da central de
// atendimento, tela 3 do app). Ocupado tira a pessoa da vez sem sair do app: o app dela só toca para o que tem prazo, e os
// casos sem prazo ficam para quem está disponível. A regra de validade é UMA, aqui no servidor (V80): o app avisa a cada
// minuto enquanto está aberto; sem aviso por mais que `PRESENCA_VALE_MIN`, a pessoa sai da lista — o celular apagou, a
// bateria acabou ou o app fechou sem "Sair". As telas recebem só quem vale.

/** Sem aviso do app por mais que isto, a pessoa sai da vez. O app avisa a cada minuto (3 avisos de folga). */
export const PRESENCA_VALE_MIN = 3;

/** O motivo do "ocupado" ("embalando", "caixa") — curto: aparece ao lado do nome no "Passar o caso". */
export const MOTIVO_MAX = 40;

export type EstadoPresenca = 'disponivel' | 'ocupado';

/** O que o app manda, conferido: estado da lista; motivo só no ocupado (aparado, sem quebra de linha, até 40). */
export function lerPresenca(dto: unknown): { estado: EstadoPresenca; motivo: string | null } {
  const d = (dto ?? {}) as { estado?: unknown; motivo?: unknown };
  if (d.estado !== 'disponivel' && d.estado !== 'ocupado')
    throw new BadRequestException('Escolha "Disponível" ou "Ocupado".');
  if (d.estado === 'disponivel') return { estado: 'disponivel', motivo: null };
  const motivo = typeof d.motivo === 'string' ? d.motivo.replace(/\s+/g, ' ').trim() : '';
  if (motivo.length > MOTIVO_MAX) throw new BadRequestException(`O motivo tem no máximo ${MOTIVO_MAX} letras.`);
  return { estado: 'ocupado', motivo: motivo || null };
}
