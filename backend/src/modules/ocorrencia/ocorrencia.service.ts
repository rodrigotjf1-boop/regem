import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { tipoOcorrencia, ocorrencia } from '../../db/schema';
import { CreateTipoOcorrenciaDto } from './dto/create-tipo.dto';
import { CreateOcorrenciaDto } from './dto/create-ocorrencia.dto';

@Injectable()
export class OcorrenciaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async createTipo(tenantId: string, dto: CreateTipoOcorrenciaDto) {
    const [row] = await this.db
      .insert(tipoOcorrencia)
      .values({
        tenantId,
        nome: dto.nome,
        sinal: dto.sinal,
        pontos: dto.pontos ?? 0,
      })
      .returning();
    return row;
  }

  listTipos(tenantId: string) {
    return this.db
      .select()
      .from(tipoOcorrencia)
      .where(
        and(
          eq(tipoOcorrencia.tenantId, tenantId),
          isNull(tipoOcorrencia.deletedAt),
        ),
      );
  }

  // Registro só descendente (garantido pelo RBAC do controller). Sinal/pontos
  // são snapshot do tipo, para o histórico não mudar se o catálogo mudar.
  async createOcorrencia(
    tenantId: string,
    autorId: string,
    dto: CreateOcorrenciaDto,
  ) {
    const [tipo] = await this.db
      .select()
      .from(tipoOcorrencia)
      .where(
        and(
          eq(tipoOcorrencia.id, dto.tipoId),
          eq(tipoOcorrencia.tenantId, tenantId),
          isNull(tipoOcorrencia.deletedAt),
        ),
      );
    if (!tipo) throw new BadRequestException('Tipo de ocorrência inválido');

    const [row] = await this.db
      .insert(ocorrencia)
      .values({
        tenantId,
        colaboradorId: dto.colaboradorId,
        tipoId: tipo.id,
        autorId,
        sinal: tipo.sinal,
        pontos: tipo.pontos,
        gravidade: dto.gravidade ?? 'leve',
        descricao: dto.descricao,
        setorId: dto.setorId,
      })
      .returning();
    return row;
  }

  async anular(tenantId: string, id: string) {
    const [row] = await this.db
      .update(ocorrencia)
      .set({ status: 'anulada' })
      .where(and(eq(ocorrencia.id, id), eq(ocorrencia.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Ocorrência não encontrada');
    return row;
  }

  // Ranking agregado — exclusivo do topo (opacidade).
  async ranking(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select c.id, c.nome,
        coalesce(sum(case o.sinal when 'positiva' then o.pontos else -o.pontos end), 0) as pontos,
        count(o.id) as ocorrencias
      from colaborador c
      left join ocorrencia o
        on o.colaborador_id = c.id and o.status = 'vigente'
      where c.tenant_id = ${tenantId} and c.deleted_at is null
      group by c.id
      order by pontos desc, c.nome`);
    return r.rows.map((x: any) => ({
      id: x.id,
      nome: x.nome,
      pontos: Number(x.pontos),
      ocorrencias: Number(x.ocorrencias),
    }));
  }
}
