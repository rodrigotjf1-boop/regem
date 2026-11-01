import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { atendimentoChamado } from '../../db/schema';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ABRIR UM CHAMADO (o robô → a equipe), fora do serviço do atendimento: o WhatsApp também abre chamado sozinho — o robô
// do outro lado (Bloco 4, 31/10/2026) — e o módulo do WhatsApp não pode depender do de atendimento (que depende do
// delivery, que depende do WhatsApp). O `AtendimentoService` chama estas mesmas funções: uma regra só.

export type Prioridade = 'normal' | 'urgente';

export type DadosDoChamado = {
  tipo?: string;
  cliente?: string;
  telefone?: string;
  pedidoNumero?: string;
  pedidoId?: string;
  mensagem?: string;
  prioridade?: Prioridade;
};

/** Avisa a tela em tempo real (o `EventEmitter2.emit`). */
export type Emitir = (evento: string, dados: any) => unknown;

/** Por quanto tempo um chamado ABERTO do mesmo telefone conta como o mesmo pedido de ajuda. */
export const JANELA_DO_MESMO_CHAMADO_H = 12;

/** Junta a mensagem nova à do chamado que já estava aberto, sem repetir a mesma frase e sem crescer sem fim. */
export function juntarMensagem(antes: string | null | undefined, nova: string | null | undefined): string | null {
  const a = String(antes ?? '').trim();
  const n = String(nova ?? '').trim();
  if (!n || a.includes(n)) return a || null;
  if (!a) return n.slice(0, 1000);
  return `${a}\n${n}`.slice(-1000);
}

/** Abre um chamado (handoff do robô → humano) e avisa a tela em tempo real. */
export async function abrirChamado(db: any, emitir: Emitir, tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
  const tipo = ['mudanca', 'erro', 'humano', 'outro', 'cancelamento'].includes(dto.tipo ?? '') ? dto.tipo : 'humano';
  const [row] = await db
    .insert(atendimentoChamado)
    .values({
      tenantId,
      unidadeId: unidadeId ?? null,
      tipo,
      cliente: dto.cliente?.trim() || null,
      telefone: dto.telefone?.trim() || null,
      pedidoNumero: dto.pedidoNumero != null ? String(dto.pedidoNumero) : null,
      pedidoId: dto.pedidoId ?? null,
      mensagem: dto.mensagem?.trim() || null,
      prioridade: dto.prioridade === 'urgente' ? 'urgente' : 'normal',
    })
    .returning();
  emitir('atendimento.novo', { tenantId, chamado: row });
  return { ok: true, id: row.id, prioridade: row.prioridade };
}

/**
 * Chamado aberto PELO ROBÔ. Se o mesmo cliente (pela chave do telefone: com/sem 55 e nono dígito) já tem um chamado
 * aberto nas últimas 12 h, é o mesmo pedido de ajuda: não abre outro (a IA às vezes chama duas vezes na mesma
 * resposta). O que chega é somado ao aberto: a mensagem nova vai junto, e `urgente` SOBE a prioridade (nunca desce) —
 * aí a tela é avisada de novo, porque mudou o que a equipe precisa ver.
 * Exceção: um pedido de CANCELAMENTO ou MUDANÇA ligado a um pedido, quando o aberto é de outro tipo, abre o seu
 * próprio chamado — o botão "Aceitar cancelamento" depende do tipo e do pedido do chamado.
 * Sem telefone, abre sempre (não há como saber se é o mesmo cliente). Duas chamadas no mesmo instante ainda podem abrir
 * dois — nenhum índice impede; o pior caso é um chamado a mais no painel.
 */
export async function abrirChamadoPeloRobo(db: any, emitir: Emitir, tenantId: string, unidadeId: string | null, dto: DadosDoChamado) {
  const k = chaveTelefone(dto.telefone);
  if (!k) return abrirChamado(db, emitir, tenantId, unidadeId, dto);
  const [aberto] = await db
    .select()
    .from(atendimentoChamado)
    .where(
      and(
        eq(atendimentoChamado.tenantId, tenantId),
        eq(atendimentoChamado.status, 'aberto'),
        gte(atendimentoChamado.criadoEm, sql.raw(`now() - interval '${Number(JANELA_DO_MESMO_CHAMADO_H)} hours'`)),
        sql`${sqlChaveTelefone(sql`${atendimentoChamado.telefone}`)} = ${k}`,
      ),
    )
    .orderBy(desc(atendimentoChamado.criadoEm))
    .limit(1);
  const tipoNovo = String(dto.tipo ?? '');
  const precisaDoProprio = (tipoNovo === 'cancelamento' || tipoNovo === 'mudanca') && !!dto.pedidoId && aberto?.tipo !== tipoNovo;
  if (!aberto || precisaDoProprio) return abrirChamado(db, emitir, tenantId, unidadeId, dto);

  const subiu = dto.prioridade === 'urgente' && aberto.prioridade !== 'urgente';
  const mensagem = juntarMensagem(aberto.mensagem, dto.mensagem);
  const patch: Record<string, unknown> = {};
  if (subiu) patch.prioridade = 'urgente';
  if (mensagem !== (aberto.mensagem ?? null)) patch.mensagem = mensagem;
  if (!aberto.pedidoId && dto.pedidoId) {
    patch.pedidoId = dto.pedidoId;
    if (!aberto.pedidoNumero && dto.pedidoNumero != null) patch.pedidoNumero = String(dto.pedidoNumero);
  }
  let row: any = aberto;
  if (Object.keys(patch).length) {
    [row] = await db
      .update(atendimentoChamado)
      .set(patch as any)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, aberto.id)))
      .returning();
  }
  if (subiu) emitir('atendimento.novo', { tenantId, chamado: row });
  return { ok: true, id: aberto.id, prioridade: (row?.prioridade ?? aberto.prioridade) as Prioridade, jaAberto: true };
}
