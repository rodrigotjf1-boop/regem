import { BadRequestException, ForbiddenException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { colaborador, funcao, perfilAcesso } from '../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LIBERAÇÃO POR SENHA DE GESTOR — a mesma regra em todo lugar que pede "senha do gestor" na hora (cancelar e reabrir
// pedido de delivery; despachar o pedido sem todas as estações, no KDS de despacho).
// Vale a senha de quem é presidente ou gerente pelo NÍVEL DE ACESSO, como no login (o perfil de acesso; sem perfil, a
// função), e que ainda tem acesso: excluído, bloqueado ou desligado não libera nada. Antes, a liberação do delivery
// olhava só a função e aceitava a senha de quem já tinha saído (ERR-192 / V48: tirar o acesso fecha TODAS as portas —
// login, PIN e esta senha). Devolve quem liberou, para a auditoria.
export async function autorizarPorSenhaDeGestor(
  db: any,
  tenantId: string,
  senha?: string | null,
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
      ),
    );
  for (const c of candidatos) {
    const nivel = c.nivel ?? c.categoria;
    if (nivel !== 'presidente' && nivel !== 'gerente') continue;
    if (c.senhaHash && (await bcrypt.compare(senha, c.senhaHash))) return { id: c.id, nome: c.nome };
  }
  throw new ForbiddenException('Senha de gestor inválida.');
}
