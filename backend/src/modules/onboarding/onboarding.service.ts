import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  unidade,
  setor,
  funcao,
  etiqueta,
  tipoOcorrencia,
  itemEstoque,
} from '../../db/schema';
import { AplicarTemplateDto } from './dto/aplicar-template.dto';
import { TEMPLATES } from './templates';

@Injectable()
export class OnboardingService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async aplicarTemplate(tenantId: string, dto: AplicarTemplateDto) {
    const ramo = dto.ramo ?? 'food_service';

    const [uni] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(
        and(
          eq(unidade.id, dto.unidadeId),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      );
    if (!uni) throw new BadRequestException('Unidade inválida para este tenant');

    const tpl = TEMPLATES[ramo];
    if (!tpl) throw new BadRequestException(`Sem template para o ramo "${ramo}"`);

    const criados = { setores: 0, funcoes: 0, etiquetas: 0, tipos: 0, itens: 0 };

    await this.db.transaction(async (tx) => {
      for (const s of tpl.setores) {
        const [setorRow] = await tx
          .insert(setor)
          .values({ tenantId, unidadeId: dto.unidadeId, nome: s.nome, icone: s.icone })
          .returning();
        criados.setores++;

        for (const f of s.funcoes) {
          const [funcaoRow] = await tx
            .insert(funcao)
            .values({ tenantId, nome: f.nome, categoria: f.categoria, setorId: setorRow.id })
            .returning();
          criados.funcoes++;

          await tx.insert(etiqueta).values({
            tenantId,
            unidadeId: dto.unidadeId,
            setorId: setorRow.id,
            funcaoId: funcaoRow.id,
            sigla: f.sigla,
            contador: 1,
          });
          criados.etiquetas++;
        }
      }

      for (const t of tpl.tipos) {
        await tx
          .insert(tipoOcorrencia)
          .values({ tenantId, nome: t.nome, sinal: t.sinal, pontos: t.pontos });
        criados.tipos++;
      }

      for (const it of tpl.itens) {
        await tx.insert(itemEstoque).values({
          tenantId,
          unidadeId: dto.unidadeId,
          nome: it.nome,
          unidadeMedida: it.unidadeMedida,
          estoqueMinimo: String(it.estoqueMinimo),
        });
        criados.itens++;
      }
    });

    return { ramo, criados };
  }

  ramosDisponiveis() {
    return Object.keys(TEMPLATES);
  }
}
