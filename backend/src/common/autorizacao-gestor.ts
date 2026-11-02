import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { colaborador, funcao, perfilAcesso } from '../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Os níveis cuja senha LIBERA na hora (decisão do dono, 23/10/2026: presidente, gerente e supervisão, em tudo). */
export const NIVEIS_QUE_LIBERAM = ['presidente', 'gerente', 'supervisao'] as const;

// LIBERAÇÃO POR SENHA DE GESTOR — a mesma regra em todo lugar que pede "senha do gestor" na hora (cancelar e reabrir
// pedido de delivery; despachar o pedido sem todas as estações, no KDS de despacho; a sangria do perfil que pede senha).
// Vale a senha de quem é presidente, gerente ou supervisão pelo NÍVEL DE ACESSO, como no login (o perfil de acesso; sem
// perfil, a função), e que ainda tem acesso: excluído, bloqueado ou desligado não libera nada. Antes, a liberação do
// delivery olhava só a função e aceitava a senha de quem já tinha saído (ERR-192 / V48: tirar o acesso fecha TODAS as
// portas — login, PIN e esta senha). Até 23/10/2026 só presidente e gerente liberavam. Devolve quem liberou, para a
// auditoria e o comprovante.
/**
 * Só presidente e gerente — a disputa do iFood e o pedido de cancelamento/reembolso da 99 (decisão do dono, 01/11/2026:
 * "disputa iFood/cancelamento 99: só gerente e presidente respondem").
 */
export const NIVEIS_DA_PLATAFORMA = ['presidente', 'gerente'] as const;

export async function autorizarPorSenhaDeGestor(
  db: any,
  tenantId: string,
  senha?: string | null,
  // Quem pode liberar AQUI (padrão: presidente, gerente e supervisão). A plataforma usa `NIVEIS_DA_PLATAFORMA`.
  niveis: readonly string[] = NIVEIS_QUE_LIBERAM,
): Promise<{ id: string; nome: string }> {
  if (!senha) throw new BadRequestException('Informe a senha de autorização.');
  const candidatos = await db
    .select({
      id: colaborador.id,
      nome: colaborador.nome,
      senhaHash: colaborador.senhaHash,
      nivel: perfilAcesso.nivel,
      categoria: funcao.categoria,
    })
    .from(colaborador)
    .leftJoin(funcao, eq(funcao.id, colaborador.funcaoId))
    .leftJoin(perfilAcesso, eq(perfilAcesso.id, colaborador.perfilAcessoId))
    .where(
      and(
        eq(colaborador.tenantId, tenantId),
        isNotNull(colaborador.senhaHash),
        isNull(colaborador.deletedAt),
        eq(colaborador.status, 'ativo'),
        // Só quem pode liberar entra na conta: cada senha conferida custa um bcrypt.
        inArray(sql`coalesce(${perfilAcesso.nivel}, ${funcao.categoria}::text)`, [...niveis]),
      ),
    );
  for (const c of candidatos) {
    const nivel = c.nivel ?? c.categoria;
    if (!niveis.includes(nivel)) continue;
    if (c.senhaHash && (await bcrypt.compare(senha, c.senhaHash))) return { id: c.id, nome: c.nome };
  }
  throw new ForbiddenException('Senha de gestor inválida.');
}

/**
 * O PIN DE QUEM ESTÁ NO APP (app "Regem Atendimento", mig 353): no celular, quem decide confirma com o PRÓPRIO PIN — a
 * pessoa já entrou com ele; o PIN só prova que é ela agora. Vale só para quem está no nível pedido (a plataforma:
 * presidente e gerente) e ainda tem acesso (excluído, bloqueado ou desligado não decide — V48). Quem não é gestor ouve
 * "chame o gerente".
 */
export async function autorizarPorPinDoUsuario(
  db: any,
  tenantId: string,
  colaboradorId: string | null | undefined,
  pin: string | null | undefined,
  niveis: readonly string[] = NIVEIS_QUE_LIBERAM,
): Promise<{ id: string; nome: string }> {
  if (!pin) throw new BadRequestException('Confirme com o seu PIN.');
  if (!colaboradorId) throw new ForbiddenException('Entre com o seu PIN no app para responder.');
  const [c] = await db
    .select({
      id: colaborador.id,
      nome: colaborador.nome,
      pinHash: colaborador.pinHash,
      status: colaborador.status,
      deletedAt: colaborador.deletedAt,
      nivel: perfilAcesso.nivel,
      categoria: funcao.categoria,
    })
    .from(colaborador)
    .leftJoin(funcao, eq(funcao.id, colaborador.funcaoId))
    .leftJoin(perfilAcesso, eq(perfilAcesso.id, colaborador.perfilAcessoId))
    .where(and(eq(colaborador.tenantId, tenantId), eq(colaborador.id, colaboradorId)));
  if (!c || c.deletedAt || c.status !== 'ativo') throw new ForbiddenException('O seu acesso não vale mais.');
  if (!niveis.includes(c.nivel ?? c.categoria)) throw new ForbiddenException('Só gerente e presidente respondem. Chame o gerente.');
  if (!c.pinHash || !(await bcrypt.compare(String(pin), c.pinHash))) throw new ForbiddenException('PIN inválido.');
  return { id: c.id, nome: c.nome };
}
