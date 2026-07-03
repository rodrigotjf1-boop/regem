import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { botRegra, botAtendimento } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { casarRegraBot } from '../../common/regras-negocio';
import { CreateRegraDto } from './dto/create-regra.dto';
import { UpdateRegraDto } from './dto/update-regra.dto';
import { PerguntarDto } from './dto/perguntar.dto';

const SEM_MATCH =
  'Não consegui responder isso automaticamente — vou encaminhar para um responsável.';

@Injectable()
export class BotService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  listarRegras(tenantId: string) {
    return this.db
      .select()
      .from(botRegra)
      .where(and(eq(botRegra.tenantId, tenantId), isNull(botRegra.deletedAt)))
      .orderBy(desc(botRegra.createdAt));
  }

  async criarRegra(tenantId: string, dto: CreateRegraDto) {
    const [row] = await this.db
      .insert(botRegra)
      .values({
        tenantId,
        tipo: dto.tipo,
        gatilhos: dto.gatilhos,
        resposta: dto.resposta,
        escala: dto.escala ?? 'nunca',
        escalaCondicao: dto.escalaCondicao,
        ativa: dto.ativa ?? true,
      })
      .returning();
    return row;
  }

  async atualizarRegra(tenantId: string, id: string, dto: UpdateRegraDto) {
    const [row] = await this.db
      .update(botRegra)
      .set({ ...dto, updatedAt: new Date() })
      .where(and(eq(botRegra.id, id), eq(botRegra.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Regra não encontrada.');
    return row;
  }

  async removerRegra(tenantId: string, id: string) {
    const [row] = await this.db
      .update(botRegra)
      .set({ deletedAt: new Date() })
      .where(and(eq(botRegra.id, id), eq(botRegra.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Regra não encontrada.');
    return { ok: true };
  }

  // Casa a pergunta contra as regras ativas, registra o atendimento e devolve a
  // resposta. Sem match → escala para humano. Regra 'sempre' → escala sempre.
  async perguntar(user: AuthUser, dto: PerguntarDto) {
    const regras = await this.listarRegras(user.tenantId);
    const regra = casarRegraBot(
      dto.pergunta,
      regras.map((r) => ({ id: r.id, gatilhos: r.gatilhos, ativa: r.ativa })),
    );
    const cheia = regra ? regras.find((r) => r.id === regra.id)! : null;

    const escalado = cheia ? cheia.escala === 'sempre' : true;
    const resposta = cheia ? cheia.resposta : SEM_MATCH;

    await this.db.insert(botAtendimento).values({
      tenantId: user.tenantId,
      colaboradorId: user.colaboradorId,
      pergunta: dto.pergunta,
      regraId: cheia?.id,
      escalado,
    });

    return {
      resposta,
      escalado,
      regraTipo: cheia?.tipo ?? null,
      escalaCondicao: cheia?.escala === 'condicional' ? cheia.escalaCondicao : null,
    };
  }

  async metricas(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select
        count(*) filter (where created_at::date = current_date)::int as "hoje",
        count(*) filter (where created_at::date = current_date and escalado)::int as "escaladosHoje"
      from bot_atendimento
      where tenant_id = ${tenantId}
    `);
    const row = (r.rows ?? r)[0] ?? {};
    return { hoje: Number(row.hoje ?? 0), escaladosHoje: Number(row.escaladosHoje ?? 0) };
  }
}
