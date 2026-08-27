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
import {
  CATALOGO_PERMISSOES,
  perfilPadrao,
  type Permissoes,
} from '../../auth/permissoes';

const ORDEM: Record<string, number> = {
  presidente: 0,
  gerente: 1,
  supervisao: 2,
  execucao: 3,
};
const NIVEIS = ['presidente', 'gerente', 'supervisao', 'execucao'];

@Injectable()
export class PerfilService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Catálogo de permissões (para o editor renderizar tudo, mesmo o que um perfil
  // ainda não tem gravado). Estático, não depende de tenant.
  catalogo() {
    return CATALOGO_PERMISSOES;
  }

  async listar(tenantId: string) {
    const rows = await this.db
      .select()
      .from(perfilAcesso)
      .where(eq(perfilAcesso.tenantId, tenantId));
    return rows.sort(
      (a, b) => (ORDEM[a.nivel] ?? 9) - (ORDEM[b.nivel] ?? 9) || a.nome.localeCompare(b.nome),
    );
  }

  // Cria um novo perfil (o presidente pode acrescentar perfis além dos 4 base).
  // O `nivel` define a hierarquia/escopo; as permissões partem do default do nível
  // e o presidente ajusta. Nome único por tenant.
  async criar(
    ator: AuthUser,
    dto: { nome?: string; nivel?: string; loginWeb?: boolean; permissoes?: Permissoes },
  ) {
    const nome = (dto.nome ?? '').trim();
    if (!nome) throw new BadRequestException('Informe o nome do perfil.');
    const nivel = NIVEIS.includes(dto.nivel ?? '') ? (dto.nivel as string) : 'execucao';
    // Só existe UM C&O (semeado no onboarding). Não deixa criar outro presidente por API.
    if (nivel === 'presidente')
      throw new BadRequestException('Não é possível criar um perfil de nível presidente/C&O.');
    const [ja] = await this.db
      .select({ id: perfilAcesso.id })
      .from(perfilAcesso)
      .where(and(eq(perfilAcesso.tenantId, ator.tenantId), eq(perfilAcesso.nome, nome)));
    if (ja) throw new BadRequestException('Já existe um perfil com esse nome.');
    const [row] = await this.db
      .insert(perfilAcesso)
      .values({
        tenantId: ator.tenantId,
        nome,
        nivel,
        loginWeb: dto.loginWeb ?? true,
        permissoes: dto.permissoes ?? perfilPadrao(nivel).permissoes,
      })
      .returning();
    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'perfil_criado',
      entidadeTipo: 'perfil_acesso',
      entidadeId: row.id,
      detalhe: { nome, nivel },
    });
    return row;
  }

  async remover(ator: AuthUser, id: string) {
    const [alvo] = await this.db
      .select()
      .from(perfilAcesso)
      .where(and(eq(perfilAcesso.id, id), eq(perfilAcesso.tenantId, ator.tenantId)));
    if (!alvo) throw new NotFoundException('Perfil não encontrado.');
    if (alvo.nivel === 'presidente')
      throw new BadRequestException('O perfil Presidente/C&O não pode ser removido.');
    try {
      await this.db
        .delete(perfilAcesso)
        .where(and(eq(perfilAcesso.id, id), eq(perfilAcesso.tenantId, ator.tenantId)));
    } catch (e: any) {
      if (e?.code === '23503')
        throw new BadRequestException(
          'Este perfil está em uso por colaboradores. Reatribua-os antes de remover.',
        );
      throw e;
    }
    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'perfil_removido',
      entidadeTipo: 'perfil_acesso',
      entidadeId: id,
      detalhe: { nome: alvo.nome, nivel: alvo.nivel },
    });
    return { ok: true };
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
