import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { perfilAcesso } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import type { Permissoes } from '../../auth/permissoes';

const ORDEM: Record<string, number> = {
  presidente: 0,
  gerente: 1,
  supervisao: 2,
  execucao: 3,
};

@Injectable()
export class PerfilService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(tenantId: string) {
    const rows = await this.db
      .select()
      .from(perfilAcesso)
      .where(eq(perfilAcesso.tenantId, tenantId));
    return rows.sort((a, b) => (ORDEM[a.nivel] ?? 9) - (ORDEM[b.nivel] ?? 9));
  }

  async atualizar(
    ator: AuthUser,
    id: string,
    dto: { loginWeb?: boolean; permissoes?: Permissoes },
  ) {
    const [alvo] = await this.db
      .select()
      .from(perfilAcesso)
      .where(and(eq(perfilAcesso.id, id), eq(perfilAcesso.tenantId, ator.tenantId)));
    if (!alvo) throw new NotFoundException('Perfil não encontrado.');
    // O perfil Presidente/C&O é sempre pleno — não pode ser rebaixado (evita lockout).
    if (alvo.nivel === 'presidente') {
      throw new BadRequestException(
        'O perfil Presidente/C&O tem acesso total e não é editável.',
      );
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.loginWeb !== undefined) patch.loginWeb = dto.loginWeb;
    if (dto.permissoes !== undefined) patch.permissoes = dto.permissoes;

    const [row] = await this.db
      .update(perfilAcesso)
      .set(patch)
      .where(and(eq(perfilAcesso.id, id), eq(perfilAcesso.tenantId, ator.tenantId)))
      .returning();

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'perfil_atualizado',
      entidadeTipo: 'perfil_acesso',
      entidadeId: id,
      detalhe: { nivel: alvo.nivel, loginWeb: dto.loginWeb },
    });
    return row;
  }
}
