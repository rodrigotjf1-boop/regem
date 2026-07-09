import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { funcao, setor, etiqueta } from '../../db/schema';
import { CreateFuncaoDto } from './dto/create-funcao.dto';

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
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateFuncaoDto) {
    const [row] = await this.db
      .insert(funcao)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'execucao',
        setorId: dto.setorId,
      })
      .returning();

    // Fase 3: gera a etiqueta (vaga) da função. Precisa de setor (a etiqueta
    // exige setorId + unidadeId). Sem setor, cria só a função.
    let etiquetaGerada: typeof etiqueta.$inferSelect | null = null;
    if (dto.gerarEtiqueta !== false && dto.setorId) {
      const [s] = await this.db
        .select({ id: setor.id, unidadeId: setor.unidadeId })
        .from(setor)
        .where(
          and(
            eq(setor.id, dto.setorId),
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
            setorId: dto.setorId,
            funcaoId: row.id,
            sigla,
            contador,
          })
          .returning();
        etiquetaGerada = et;
      }
    }
    return { ...row, etiqueta: etiquetaGerada };
  }

  async update(tenantId: string, id: string, dto: CreateFuncaoDto) {
    const [row] = await this.db
      .update(funcao)
      .set({
        nome: dto.nome,
        categoria: dto.categoria ?? 'execucao',
        setorId: dto.setorId ?? null,
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
    return row;
  }

  async remove(tenantId: string, id: string) {
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
    return { ok: true };
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(funcao)
      .where(and(eq(funcao.tenantId, tenantId), isNull(funcao.deletedAt)));
  }
}
