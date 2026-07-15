import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  colaborador,
  colaboradorFuncao,
  funcao,
  perfilAcesso,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AuthUser } from '../../auth/auth-user';
import { CreateColaboradorDto } from './dto/create-colaborador.dto';

// Colunas públicas: nunca expõe senha_hash / pin_hash.
const publicCols = {
  id: colaborador.id,
  tenantId: colaborador.tenantId,
  nome: colaborador.nome,
  fotoRef: colaborador.fotoRef,
  funcaoId: colaborador.funcaoId,
  vinculo: colaborador.vinculo,
  jornadaTipo: colaborador.jornadaTipo,
  email: colaborador.email,
  status: colaborador.status,
  perfilAcessoId: colaborador.perfilAcessoId,
  appHabilitado: colaborador.appHabilitado,
  createdAt: colaborador.createdAt,
  updatedAt: colaborador.updatedAt,
};

@Injectable()
export class ColaboradorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // O login casa por e-mail (sem filtro de tenant), então o e-mail precisa ser
  // único no sistema. Rejeita se já usado por outro colaborador.
  private async emailLivre(email: string, exceptId?: string) {
    const rows = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(and(eq(colaborador.email, email), isNull(colaborador.deletedAt)));
    if (rows.some((r) => r.id !== exceptId))
      throw new BadRequestException('Este e-mail já está em uso por outro colaborador.');
  }

  // Resolve o perfil de acesso: o informado (validado no tenant) ou o do nível
  // da função principal (perfil.nivel = funcao.categoria). Null se não achar.
  private async resolverPerfil(
    tenantId: string,
    perfilAcessoId?: string,
    funcaoId?: string,
  ): Promise<string | null> {
    if (perfilAcessoId) {
      const [p] = await this.db
        .select({ id: perfilAcesso.id })
        .from(perfilAcesso)
        .where(and(eq(perfilAcesso.id, perfilAcessoId), eq(perfilAcesso.tenantId, tenantId)));
      if (!p) throw new BadRequestException('Perfil de acesso inválido.');
      return p.id;
    }
    if (!funcaoId) return null;
    const [f] = await this.db
      .select({ categoria: funcao.categoria })
      .from(funcao)
      .where(eq(funcao.id, funcaoId));
    if (!f) return null;
    const [p] = await this.db
      .select({ id: perfilAcesso.id })
      .from(perfilAcesso)
      .where(
        and(eq(perfilAcesso.tenantId, tenantId), eq(perfilAcesso.nivel, f.categoria as string)),
      );
    return p?.id ?? null;
  }

  // Presidente/C&O: associa perfil, libera o app e bloqueia/desbloqueia o acesso.
  async atualizarAcesso(
    ator: AuthUser,
    id: string,
    dto: { perfilAcessoId?: string; appHabilitado?: boolean; status?: string },
  ) {
    const [alvo] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, ator.tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!alvo) throw new NotFoundException('Colaborador não encontrado.');
    if (id === ator.colaboradorId && dto.status === 'bloqueado') {
      throw new BadRequestException('Você não pode bloquear o seu próprio acesso.');
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.perfilAcessoId !== undefined) {
      patch.perfilAcessoId = await this.resolverPerfil(ator.tenantId, dto.perfilAcessoId);
    }
    if (dto.appHabilitado !== undefined) patch.appHabilitado = !!dto.appHabilitado;
    if (dto.status !== undefined) {
      if (!['ativo', 'bloqueado'].includes(dto.status))
        throw new BadRequestException('Status inválido (ativo | bloqueado).');
      patch.status = dto.status;
    }

    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, ator.tenantId)))
      .returning(publicCols);

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'config',
      acao: 'acesso_atualizado',
      entidadeTipo: 'colaborador',
      entidadeId: id,
      detalhe: { perfilAcessoId: dto.perfilAcessoId, status: dto.status, appHabilitado: dto.appHabilitado },
    });
    return row;
  }

  async create(tenantId: string, dto: CreateColaboradorDto) {
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 12) : undefined;
    const email = dto.email?.trim().toLowerCase() || undefined;
    if (email) await this.emailLivre(email);

    // Só aceita funções deste tenant (evita vínculo cross-tenant).
    const pedidas = [
      ...new Set([...(dto.funcaoIds ?? []), dto.funcaoId].filter(Boolean)),
    ] as string[];
    const validas = pedidas.length
      ? (
          await this.db
            .select({ id: funcao.id })
            .from(funcao)
            .where(
              and(
                eq(funcao.tenantId, tenantId),
                inArray(funcao.id, pedidas),
                isNull(funcao.deletedAt),
              ),
            )
        ).map((f) => f.id)
      : [];
    const principal = dto.funcaoId && validas.includes(dto.funcaoId)
      ? dto.funcaoId
      : validas[0];

    // Perfil de acesso: usa o informado ou resolve pelo nível da função principal.
    const perfilAcessoId =
      (await this.resolverPerfil(tenantId, dto.perfilAcessoId, principal)) ??
      undefined;

    const [row] = await this.db
      .insert(colaborador)
      .values({
        tenantId,
        nome: dto.nome,
        fotoRef: dto.fotoRef,
        funcaoId: principal,
        vinculo: dto.vinculo ?? 'clt',
        jornadaTipo: dto.jornadaTipo ?? 'outro',
        email,
        pinHash,
        perfilAcessoId,
      })
      .returning(publicCols);

    if (validas.length) {
      await this.db
        .insert(colaboradorFuncao)
        .values(
          validas.map((funcaoId) => ({
            tenantId,
            colaboradorId: row.id,
            funcaoId,
          })),
        )
        .onConflictDoNothing();
    }
    return { ...row, funcaoIds: validas };
  }

  // Edição geral (Cadastros): dados básicos + funções (N:N) + PIN opcional.
  async update(tenantId: string, id: string, dto: CreateColaboradorDto) {
    const [atual] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!atual) throw new NotFoundException('Colaborador não encontrado.');

    const pedidas = [
      ...new Set([...(dto.funcaoIds ?? []), dto.funcaoId].filter(Boolean)),
    ] as string[];
    const validas = pedidas.length
      ? (
          await this.db
            .select({ id: funcao.id })
            .from(funcao)
            .where(
              and(
                eq(funcao.tenantId, tenantId),
                inArray(funcao.id, pedidas),
                isNull(funcao.deletedAt),
              ),
            )
        ).map((f) => f.id)
      : [];
    const principal =
      dto.funcaoId && validas.includes(dto.funcaoId) ? dto.funcaoId : validas[0];

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.fotoRef !== undefined) patch.fotoRef = dto.fotoRef;
    if (dto.vinculo !== undefined) patch.vinculo = dto.vinculo;
    if (dto.jornadaTipo !== undefined) patch.jornadaTipo = dto.jornadaTipo;
    if (principal !== undefined) patch.funcaoId = principal;
    if (dto.email !== undefined) {
      const email = dto.email?.trim().toLowerCase() || null;
      if (email) await this.emailLivre(email, id);
      patch.email = email;
    }
    if (dto.pin) patch.pinHash = await bcrypt.hash(dto.pin, 12);

    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, tenantId)))
      .returning(publicCols);

    // Substitui os vínculos de função quando o campo é enviado.
    if (dto.funcaoIds !== undefined || dto.funcaoId !== undefined) {
      await this.db
        .delete(colaboradorFuncao)
        .where(eq(colaboradorFuncao.colaboradorId, id));
      if (validas.length) {
        await this.db
          .insert(colaboradorFuncao)
          .values(
            validas.map((funcaoId) => ({ tenantId, colaboradorId: id, funcaoId })),
          )
          .onConflictDoNothing();
      }
    }
    return { ...row, funcaoIds: validas };
  }

  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(colaborador)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, tenantId),
          isNull(colaborador.deletedAt),
        ),
      )
      .returning({ id: colaborador.id });
    if (!row) throw new NotFoundException('Colaborador não encontrado.');
    return { ok: true };
  }

  async findAll(tenantId: string) {
    const rows = await this.db
      .select(publicCols)
      .from(colaborador)
      .where(and(eq(colaborador.tenantId, tenantId), isNull(colaborador.deletedAt)));
    // Anexa as funções (N:N) de cada colaborador.
    const links = await this.db
      .select({
        colaboradorId: colaboradorFuncao.colaboradorId,
        funcaoId: colaboradorFuncao.funcaoId,
      })
      .from(colaboradorFuncao)
      .where(eq(colaboradorFuncao.tenantId, tenantId));
    const porColab = new Map<string, string[]>();
    for (const l of links) {
      const arr = porColab.get(l.colaboradorId) ?? [];
      arr.push(l.funcaoId);
      porColab.set(l.colaboradorId, arr);
    }
    return rows.map((r) => ({ ...r, funcaoIds: porColab.get(r.id) ?? [] }));
  }

  // Reset de senha pelo gestor (recuperação sem e-mail): define e-mail (opcional)
  // + nova senha do colaborador. Ação sensível → auditada.
  async definirSenha(
    ator: AuthUser,
    id: string,
    dto: { email?: string; senha: string },
  ) {
    const senha = (dto.senha ?? '').trim();
    if (senha.length < 6)
      throw new BadRequestException('A senha deve ter ao menos 6 caracteres.');
    const [alvo] = await this.db
      .select({ id: colaborador.id })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.id, id),
          eq(colaborador.tenantId, ator.tenantId),
          isNull(colaborador.deletedAt),
        ),
      );
    if (!alvo) throw new NotFoundException('Colaborador não encontrado.');

    const senhaHash = await bcrypt.hash(senha, 12);
    const patch: any = { senhaHash, updatedAt: new Date() };
    if (dto.email?.trim()) patch.email = dto.email.trim().toLowerCase();
    const [row] = await this.db
      .update(colaborador)
      .set(patch)
      .where(and(eq(colaborador.id, id), eq(colaborador.tenantId, ator.tenantId)))
      .returning(publicCols);

    await this.auditoria.registrar({
      tenantId: ator.tenantId,
      atorId: ator.colaboradorId,
      atorPerfil: ator.categoria,
      tipo: 'auth',
      acao: 'senha_redefinida',
      entidadeTipo: 'colaborador',
      entidadeId: id,
      origem: 'web',
    });
    return row;
  }
}
