import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador, colaboradorFuncao, funcao } from '../../db/schema';
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
  createdAt: colaborador.createdAt,
  updatedAt: colaborador.updatedAt,
};

@Injectable()
export class ColaboradorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(tenantId: string, dto: CreateColaboradorDto) {
    const pinHash = dto.pin ? await bcrypt.hash(dto.pin, 10) : undefined;

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

    const [row] = await this.db
      .insert(colaborador)
      .values({
        tenantId,
        nome: dto.nome,
        fotoRef: dto.fotoRef,
        funcaoId: principal,
        vinculo: dto.vinculo ?? 'clt',
        jornadaTipo: dto.jornadaTipo ?? 'outro',
        pinHash,
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

    const senhaHash = await bcrypt.hash(senha, 10);
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
