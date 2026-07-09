import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
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

// Acima deste % de cadastro o wizard fica bloqueado (é ferramenta de início).
export const LIMITE_WIZARD = 35;

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

  // Progresso do cadastro (0–100%): marcos básicos de configuração. O wizard só
  // fica disponível abaixo de LIMITE_WIZARD% (ferramenta de início de operação).
  async progresso(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select
        (select count(*) from unidade where tenant_id=${tenantId} and deleted_at is null)::int as unidades,
        (select count(*) from setor where tenant_id=${tenantId} and deleted_at is null)::int as setores,
        (select count(*) from funcao where tenant_id=${tenantId} and deleted_at is null)::int as funcoes,
        (select count(*) from colaborador where tenant_id=${tenantId} and deleted_at is null)::int as colaboradores,
        (select count(*) from turno where tenant_id=${tenantId} and deleted_at is null)::int as turnos,
        (select count(*) from item_estoque where tenant_id=${tenantId} and deleted_at is null)::int as itens,
        (select count(*) from produto where tenant_id=${tenantId} and deleted_at is null)::int as produtos
    `);
    const c = (r.rows ?? r)[0] ?? {};
    // Função "Presidente" e o colaborador admin já vêm do cadastro inicial, então
    // funções/colaboradores exigem ≥2 para contar como "começou a cadastrar".
    const milestones = [
      { chave: 'unidade', label: 'Unidade cadastrada', ok: Number(c.unidades) >= 1 },
      { chave: 'setor', label: 'Setores', ok: Number(c.setores) >= 1 },
      { chave: 'funcao', label: 'Funções', ok: Number(c.funcoes) >= 2 },
      { chave: 'colaborador', label: 'Colaboradores', ok: Number(c.colaboradores) >= 2 },
      { chave: 'turno', label: 'Turnos', ok: Number(c.turnos) >= 1 },
      { chave: 'estoque', label: 'Insumos no estoque', ok: Number(c.itens) >= 1 },
      { chave: 'produto', label: 'Produtos / cardápio', ok: Number(c.produtos) >= 1 },
    ];
    const feitos = milestones.filter((m) => m.ok).length;
    const pct = Math.round((feitos / milestones.length) * 100);
    return { pct, feitos, total: milestones.length, milestones };
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
      itens: tpl.itens ?? [], // insumos básicos sugeridos (opcional no wizard)
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

    // Gate: o wizard é para o início da operação. Acima do limite, bloqueia
    // (evita reaplicar sobre um cadastro já avançado). Trava no servidor.
    const prog = await this.progresso(tenantId);
    if (prog.pct >= LIMITE_WIZARD) {
      throw new BadRequestException(
        `O wizard é só para o início da configuração (cadastro já em ${prog.pct}%). Use os Cadastros para ajustes.`,
      );
    }

    const setoresSel = new Set(dto.setores ?? []);
    const funcoesSel = new Set(dto.funcoes ?? []);
    const criados = { setores: 0, funcoes: 0, etiquetas: 0, itens: 0, reaproveitados: 0 };

    // Idempotência: reusa setores/funções que já existem (rodar o wizard 2× não
    // duplica). Setor casa por nome na unidade; função por nome dentro do setor.
    const setoresExist = await this.db
      .select({ id: setor.id, nome: setor.nome })
      .from(setor)
      .where(
        and(
          eq(setor.tenantId, tenantId),
          eq(setor.unidadeId, dto.unidadeId),
          isNull(setor.deletedAt),
        ),
      );
    const setorPorNome = new Map(setoresExist.map((s) => [s.nome, s.id]));
    const funcoesExist = await this.db
      .select({ nome: funcao.nome, setorId: funcao.setorId })
      .from(funcao)
      .where(and(eq(funcao.tenantId, tenantId), isNull(funcao.deletedAt)));
    const funcaoExiste = new Set(
      funcoesExist.map((f) => `${f.setorId}::${f.nome}`),
    );

    await this.db.transaction(async (tx) => {
      for (const s of tpl.setores) {
        if (!setoresSel.has(s.nome)) continue;
        let setorId = setorPorNome.get(s.nome);
        if (setorId) {
          criados.reaproveitados++;
        } else {
          const [setorRow] = await tx
            .insert(setor)
            .values({ tenantId, unidadeId: dto.unidadeId, nome: s.nome, icone: s.icone })
            .returning();
          setorId = setorRow.id;
          criados.setores++;
        }

        for (const f of s.funcoes) {
          if (!funcoesSel.has(f.nome)) continue;
          if (funcaoExiste.has(`${setorId}::${f.nome}`)) continue; // já existe → pula
          const [funcaoRow] = await tx
            .insert(funcao)
            .values({ tenantId, nome: f.nome, categoria: f.categoria, setorId })
            .returning();
          criados.funcoes++;

          await tx.insert(etiqueta).values({
            tenantId,
            unidadeId: dto.unidadeId,
            setorId,
            funcaoId: funcaoRow.id,
            sigla: f.sigla,
            contador: 1,
          });
          criados.etiquetas++;
        }
      }

      // Insumos básicos do ramo (opcional, idempotente por nome na unidade).
      if (dto.criarInsumos && (tpl.itens?.length ?? 0) > 0) {
        const itensExist = await tx
          .select({ nome: itemEstoque.nome })
          .from(itemEstoque)
          .where(
            and(
              eq(itemEstoque.tenantId, tenantId),
              isNull(itemEstoque.deletedAt),
            ),
          );
        const jaTem = new Set(itensExist.map((i) => i.nome.toLowerCase()));
        for (const it of tpl.itens) {
          if (jaTem.has(it.nome.toLowerCase())) continue;
          await tx.insert(itemEstoque).values({
            tenantId,
            unidadeId: dto.unidadeId,
            nome: it.nome,
            unidadeMedida: it.unidadeMedida,
            estoqueMinimo: String(it.estoqueMinimo),
          });
          criados.itens++;
        }
      }
    });

    return { ramo: dto.ramo, criados, escalas: dto.escalas ?? [] };
  }
}
