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
import { AplicarWizardDto } from './dto/aplicar-wizard.dto';
import { TEMPLATES, ESCALAS } from './templates';

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

  // Cards do passo 1 do wizard: ramo + rótulo + emoji.
  ramosDetalhados() {
    return Object.entries(TEMPLATES).map(([ramo, t]) => ({
      ramo,
      label: t.label,
      emoji: t.emoji,
    }));
  }

  // Blueprint sugerido para o ramo (setores + funções + modelos de escala) —
  // alimenta os chips selecionáveis do wizard.
  blueprint(ramo: string) {
    const tpl = TEMPLATES[ramo];
    if (!tpl) throw new BadRequestException(`Sem template para o ramo "${ramo}"`);
    return {
      ramo,
      label: tpl.label,
      emoji: tpl.emoji,
      setores: tpl.setores.map((s) => ({
        nome: s.nome,
        icone: s.icone,
        funcoes: s.funcoes.map((f) => ({
          nome: f.nome,
          categoria: f.categoria,
          sigla: f.sigla,
        })),
      })),
      escalas: ESCALAS,
    };
  }

  // Aplica apenas o que o usuário selecionou no wizard (setores + funções + vagas).
  // Modelos de escala são informativos (sem alvo de criação hoje) e voltam no resumo.
  async aplicarWizard(tenantId: string, dto: AplicarWizardDto) {
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

    const tpl = TEMPLATES[dto.ramo];
    if (!tpl) throw new BadRequestException(`Sem template para o ramo "${dto.ramo}"`);

    const setoresSel = new Set(dto.setores ?? []);
    const funcoesSel = new Set(dto.funcoes ?? []);
    const criados = { setores: 0, funcoes: 0, etiquetas: 0 };

    await this.db.transaction(async (tx) => {
      for (const s of tpl.setores) {
        if (!setoresSel.has(s.nome)) continue;
        const [setorRow] = await tx
          .insert(setor)
          .values({ tenantId, unidadeId: dto.unidadeId, nome: s.nome, icone: s.icone })
          .returning();
        criados.setores++;

        for (const f of s.funcoes) {
          if (!funcoesSel.has(f.nome)) continue;
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
    });

    return { ramo: dto.ramo, criados, escalas: dto.escalas ?? [] };
  }
}
