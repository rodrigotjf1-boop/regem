import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { funcao, funcaoSetor, setor, etiqueta } from '../../db/schema';
import { CreateFuncaoDto } from './dto/create-funcao.dto';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { podeCriarNivel } from '../../auth/permissoes';

// Ator da operação (para auditoria) — vem do @CurrentUser do controller.
type Ator = { colaboradorId?: string; categoria?: string };

// Abrevia o nome numa sigla (sem acento, só letras, 4 chars). "Aux. Cozinha" → "AUXC".
export function gerarSigla(nome: string): string {
  const limpo = (nome ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return limpo.slice(0, 4) || 'FUNC';
}

@Injectable()
export class FuncaoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Sincroniza os setores (N:N) de uma função com a lista informada.
  private async syncSetores(tenantId: string, funcaoId: string, setorIds: string[]) {
    await this.db.delete(funcaoSetor).where(eq(funcaoSetor.funcaoId, funcaoId));
    const ids = [...new Set(setorIds.filter(Boolean))];
    if (ids.length) {
      await this.db
        .insert(funcaoSetor)
        .values(ids.map((setorId) => ({ tenantId, funcaoId, setorId })))
        .onConflictDoNothing();
    }
  }

  async create(tenantId: string, dto: CreateFuncaoDto, ator?: Ator) {
    // RBAC de hierarquia (CL-1): a categoria da função define o nível de quem a
    // recebe. Um gerente não pode criar uma função 'presidente'/'gerente' (senão
    // atribuiria a si mesmo e escalaria). Só valida se veio acima de 'execucao'.
    const cat = dto.categoria ?? 'execucao';
    if (cat !== 'execucao' && !podeCriarNivel(ator?.categoria ?? 'execucao', cat)) {
      throw new ForbiddenException(
        `Seu perfil não pode criar uma função de nível "${cat}".`,
      );
    }
    // Setor primário = o informado ou o 1º da lista N:N.
    const setorPrimario = dto.setorId ?? dto.setorIds?.[0] ?? null;
    const [row] = await this.db
      .insert(funcao)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'execucao',
        setorId: setorPrimario ?? undefined,
      })
      .returning();

    await this.syncSetores(tenantId, row.id, dto.setorIds ?? (setorPrimario ? [setorPrimario] : []));

    // Geração de etiqueta só quando EXPLICITAMENTE pedida (o cadastro de funções
    // não gera mais etiqueta — isso ficou só no card Etiquetas).
    let etiquetaGerada: typeof etiqueta.$inferSelect | null = null;
    if (dto.gerarEtiqueta === true && setorPrimario) {
      const [s] = await this.db
        .select({ id: setor.id, unidadeId: setor.unidadeId })
        .from(setor)
        .where(
          and(
            eq(setor.id, setorPrimario),
            eq(setor.tenantId, tenantId),
            isNull(setor.deletedAt),
          ),
        );
      if (s) {
        const sigla = (dto.sigla?.trim() || gerarSigla(dto.nome)).toUpperCase();
        // Próximo contador livre para (sigla, unidade) — evita colisão do índice único.
        const existentes = await this.db
          .select({ contador: etiqueta.contador })
          .from(etiqueta)
          .where(
            and(
              eq(etiqueta.tenantId, tenantId),
              eq(etiqueta.unidadeId, s.unidadeId),
              eq(etiqueta.sigla, sigla),
              isNull(etiqueta.deletedAt),
            ),
          );
        const contador =
          existentes.reduce((m, e) => Math.max(m, e.contador), 0) + 1;
        const [et] = await this.db
          .insert(etiqueta)
          .values({
            tenantId,
            unidadeId: s.unidadeId,
            setorId: setorPrimario,
            funcaoId: row.id,
            sigla,
            contador,
          })
          .returning();
        etiquetaGerada = et;
      }
    }
    // Auditoria: função criada.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'funcao_criada',
      entidadeTipo: 'funcao',
      entidadeId: row.id,
      origem: 'web',
    });
    return { ...row, etiqueta: etiquetaGerada };
  }

  async update(tenantId: string, id: string, dto: CreateFuncaoDto, ator?: Ator) {
    // RBAC de hierarquia (CL-1): não deixar um gerente editar uma função de nível
    // acima do seu, nem elevar a categoria para um nível que ele não pode atribuir.
    const atorCat = ator?.categoria ?? 'execucao';
    const [antes] = await this.db
      .select({ categoria: funcao.categoria })
      .from(funcao)
      .where(
        and(eq(funcao.id, id), eq(funcao.tenantId, tenantId), isNull(funcao.deletedAt)),
      );
    if (!antes) throw new NotFoundException('Função não encontrada.');
    const catAtual = (antes.categoria as string) ?? 'execucao';
    if (catAtual !== 'execucao' && !podeCriarNivel(atorCat, catAtual)) {
      throw new ForbiddenException(
        `Seu perfil não pode editar uma função de nível "${catAtual}".`,
      );
    }
    const catNova = dto.categoria ?? 'execucao';
    if (catNova !== 'execucao' && !podeCriarNivel(atorCat, catNova)) {
      throw new ForbiddenException(
        `Seu perfil não pode definir uma função de nível "${catNova}".`,
      );
    }
    const setorPrimario = dto.setorId ?? dto.setorIds?.[0] ?? null;
    const [row] = await this.db
      .update(funcao)
      .set({
        nome: dto.nome,
        categoria: dto.categoria ?? 'execucao',
        setorId: setorPrimario,
      })
      .where(
        and(
          eq(funcao.id, id),
          eq(funcao.tenantId, tenantId),
          isNull(funcao.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Função não encontrada.');
    // Re-sincroniza os setores N:N quando a lista é informada.
    if (dto.setorIds !== undefined)
      await this.syncSetores(tenantId, id, dto.setorIds);
    // Auditoria: função editada.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'funcao_editada',
      entidadeTipo: 'funcao',
      entidadeId: id,
      origem: 'web',
    });
    return row;
  }

  async remove(tenantId: string, id: string, ator?: Ator) {
    // Guarda: não excluir função vinculada a colaboradores ou etiquetas ativas.
    const r: any = await this.db.execute(sql`
      select
        (select count(*) from colaborador_funcao where funcao_id = ${id})
      + (select count(*) from etiqueta where funcao_id = ${id} and deleted_at is null)
        as n
    `);
    if (Number((r.rows ?? r)[0]?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Função em uso por colaboradores ou etiquetas. Desvincule antes.',
      );
    }
    const [row] = await this.db
      .update(funcao)
      .set({ deletedAt: new Date() })
      .where(and(eq(funcao.id, id), eq(funcao.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Função não encontrada.');
    // Auditoria: função removida.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'funcao_removida',
      entidadeTipo: 'funcao',
      entidadeId: id,
      origem: 'web',
    });
    return { ok: true };
  }

  async findAll(tenantId: string) {
    const rows = await this.db
      .select()
      .from(funcao)
      .where(and(eq(funcao.tenantId, tenantId), isNull(funcao.deletedAt)));
    if (rows.length === 0) return rows;
    // Anexa os setores (N:N) de cada função.
    const links = await this.db
      .select({ funcaoId: funcaoSetor.funcaoId, setorId: funcaoSetor.setorId })
      .from(funcaoSetor)
      .where(
        and(
          eq(funcaoSetor.tenantId, tenantId),
          inArray(funcaoSetor.funcaoId, rows.map((r) => r.id)),
        ),
      );
    const porFuncao = new Map<string, string[]>();
    for (const l of links) {
      const arr = porFuncao.get(l.funcaoId) ?? [];
      arr.push(l.setorId);
      porFuncao.set(l.funcaoId, arr);
    }
    return rows.map((r) => ({
      ...r,
      setorIds: porFuncao.get(r.id) ?? (r.setorId ? [r.setorId] : []),
    }));
  }
}
