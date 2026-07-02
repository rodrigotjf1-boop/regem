import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { fornecedor } from '../../db/schema';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';

@Injectable()
export class FornecedorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateFornecedorDto) {
    const [row] = await this.db
      .insert(fornecedor)
      .values({
        tenantId,
        nome: dto.nome,
        cnpj: dto.cnpj,
        contato: dto.contato,
        telefone: dto.telefone,
        email: dto.email,
        obs: dto.obs,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(fornecedor)
      .where(and(eq(fornecedor.tenantId, tenantId), isNull(fornecedor.deletedAt)))
      .orderBy(asc(fornecedor.nome));
  }

  // Índice de pendências: divergências acumuladas por fornecedor.
  async pendencias(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select f.id, f.nome,
        count(distinct r.id) as "recebimentos",
        count(ri.id) filter (where ri.divergencia <> 'ok') as "divergencias"
      from fornecedor f
      left join recebimento r
        on r.fornecedor_id = f.id and r.deleted_at is null
      left join recebimento_item ri on ri.recebimento_id = r.id
      where f.tenant_id = ${tenantId} and f.deleted_at is null
      group by f.id, f.nome
      order by "divergencias" desc, f.nome
    `);
    return (r.rows ?? r).map((x: any) => ({
      id: x.id,
      nome: x.nome,
      recebimentos: Number(x.recebimentos),
      divergencias: Number(x.divergencias),
    }));
  }
}
