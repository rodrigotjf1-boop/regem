import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { janelaPico, unidade } from '../../db/schema';
import { condUnidade } from '../../common/filtro-unidade';
import { CreateJanelaPicoDto } from './dto/create-janela-pico.dto';

// ERR-646 (rodada 7 de segurança, MIS-B-01): a janela de pico é dado de UMA loja (`unidade_id` NOT NULL). A leitura, a
// alteração e a exclusão filtravam só a empresa, e a criação gravava a loja do corpo sem conferir — o gerente de uma loja lia
// e mexia nas janelas das outras. `loja` = a loja de quem pede (null = o presidente, todas).

@Injectable()
export class PicoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  /** `loja`: a de quem pede (quem tem loja só cria na sua); null = o presidente, que escolhe a loja no corpo. */
  async create(tenantId: string, dto: CreateJanelaPicoDto, loja: string | null = null) {
    if (loja && dto.unidadeId !== loja) throw new BadRequestException('A janela de pico é da sua loja: escolha a sua loja.');
    const [daEmpresa] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(and(eq(unidade.id, dto.unidadeId), eq(unidade.tenantId, tenantId)));
    if (!daEmpresa) throw new BadRequestException('Loja não encontrada.');
    const [row] = await this.db
      .insert(janelaPico)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        diaSemana: dto.diaSemana ?? null,
        diaSemanaFim: dto.diaSemanaFim ?? null,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string, unidadeId?: string) {
    const conds = [
      eq(janelaPico.tenantId, tenantId),
      isNull(janelaPico.deletedAt),
    ];
    if (unidadeId) conds.push(eq(janelaPico.unidadeId, unidadeId));
    return this.db
      .select()
      .from(janelaPico)
      .where(and(...conds))
      .orderBy(asc(janelaPico.horaInicio));
  }

  async update(
    tenantId: string,
    id: string,
    dto: {
      nome?: string;
      diaSemana?: number | null;
      diaSemanaFim?: number | null;
      horaInicio?: string;
      horaFim?: string;
    },
    loja: string | null = null,
  ) {
    const [row] = await this.db
      .update(janelaPico)
      .set({
        nome: dto.nome,
        diaSemana: dto.diaSemana ?? null,
        diaSemanaFim: dto.diaSemanaFim ?? null,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
      })
      .where(
        and(
          eq(janelaPico.id, id),
          eq(janelaPico.tenantId, tenantId),
          isNull(janelaPico.deletedAt),
          condUnidade(janelaPico.unidadeId, loja),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Janela de pico não encontrada.');
    return row;
  }

  async remove(tenantId: string, id: string, loja: string | null = null) {
    const apagadas = await this.db
      .update(janelaPico)
      .set({ deletedAt: new Date() })
      .where(and(eq(janelaPico.tenantId, tenantId), eq(janelaPico.id, id), condUnidade(janelaPico.unidadeId, loja)))
      .returning({ id: janelaPico.id });
    if (!apagadas.length) throw new NotFoundException('Janela de pico não encontrada.');
    return { ok: true };
  }
}
