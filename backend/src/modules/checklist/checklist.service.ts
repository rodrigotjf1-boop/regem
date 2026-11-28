import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { checklist, checklistItem, empresa, pop, unidade } from '../../db/schema';
import { SUGESTOES_CHECKLIST } from './sugestoes-checklist';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { CreateChecklistItemDto } from './dto/create-item.dto';

@Injectable()
export class ChecklistService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateChecklistDto, autorId: string) {
    const [u] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(
        and(
          eq(unidade.id, dto.unidadeId),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      );
    if (!u) throw new BadRequestException('Unidade inválida para este tenant');

    const [row] = await this.db
      .insert(checklist)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto.setorId,
        nome: dto.nome,
        autorId,
      })
      .returning();
    return row;
  }

  private async getOwned(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(checklist)
      .where(
        and(
          eq(checklist.id, id),
          eq(checklist.tenantId, tenantId),
          isNull(checklist.deletedAt),
        ),
      );
    if (!row) throw new NotFoundException('Checklist não encontrado');
    return row;
  }

  /**
   * Rodada 7, MIS-C-07 (ERR-650): os itens mudam só antes da aprovação (rascunho e "pendente de aprovação"). O VIGENTE é o
   * que o gerente aprovou e o POP guardou (`publicar` grava a cópia da versão): mudar um item dele deixava a lista diferente
   * do POP sem aprovação nenhuma. A tela só acrescenta itens ao checklist recém-criado; a API e o Mister seguem a mesma regra.
   */
  private naoVigente(cl: { estado: string | null }) {
    if (cl.estado === 'vigente')
      throw new ConflictException('Este checklist já foi aprovado (está vigente, com o POP publicado): os itens dele não mudam. Para mudar, crie um checklist novo com os itens e publique.');
  }

  /** O checklist travado (`for update`) na transação: a publicação que chega no meio espera esta mudança de item. */
  private async travarParaItens(tx: DrizzleDB, tenantId: string, checklistId: string) {
    const r: any = await tx.execute(sql`
      select estado from checklist where id = ${checklistId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null for update`);
    const [cl] = r.rows ?? r;
    if (!cl) throw new NotFoundException('Checklist não encontrado');
    this.naoVigente(cl);
  }

  async addItem(
    tenantId: string,
    checklistId: string,
    dto: CreateChecklistItemDto,
  ) {
    return this.db.transaction(async (tx) => {
      await this.travarParaItens(tx as unknown as DrizzleDB, tenantId, checklistId);
      const [row] = await tx
        .insert(checklistItem)
        .values({
          tenantId,
          checklistId,
          descricao: dto.descricao,
          procedimento: dto.procedimento,
          ordem: dto.ordem ?? 0,
          fotoRef: dto.fotoRef,
        })
        .returning();
      return row;
    });
  }

  async findAll(tenantId: string) {
    const rows = await this.db
      .select()
      .from(checklist)
      .where(and(eq(checklist.tenantId, tenantId), isNull(checklist.deletedAt)));
    if (rows.length === 0) return [];
    const ids = rows.map((c) => c.id);
    const itens = await this.db
      .select()
      .from(checklistItem)
      .where(inArray(checklistItem.checklistId, ids))
      .orderBy(asc(checklistItem.ordem));
    return rows.map((c) => ({
      ...c,
      itens: itens.filter((i) => i.checklistId === c.id),
    }));
  }

  async removeItem(tenantId: string, itemId: string) {
    // MIS-C-07: o item do checklist vigente fica.
    const [item] = await this.db
      .select({ checklistId: checklistItem.checklistId })
      .from(checklistItem)
      .where(and(eq(checklistItem.id, itemId), eq(checklistItem.tenantId, tenantId)));
    if (!item) return { ok: true };
    await this.db.transaction(async (tx) => {
      await this.travarParaItens(tx as unknown as DrizzleDB, tenantId, item.checklistId);
      await tx.delete(checklistItem).where(and(eq(checklistItem.id, itemId), eq(checklistItem.tenantId, tenantId)));
    });
    return { ok: true };
  }

  // Modelos de checklist sugeridos pelo ramo da empresa (itens editáveis).
  async sugestoesRamo(tenantId: string) {
    const [emp] = await this.db
      .select({ ramo: empresa.ramo })
      .from(empresa)
      .where(eq(empresa.id, tenantId));
    const ramo = emp?.ramo ?? 'food_service';
    return {
      ramo,
      sugestoes: SUGESTOES_CHECKLIST[ramo] ?? SUGESTOES_CHECKLIST.geral,
    };
  }

  async findOne(tenantId: string, id: string) {
    const cl = await this.getOwned(tenantId, id);
    const itens = await this.db
      .select()
      .from(checklistItem)
      .where(eq(checklistItem.checklistId, id));
    return { ...cl, itens };
  }

  // Supervisão submete para aprovação do gerente.
  async submeter(tenantId: string, id: string) {
    const cl = await this.getOwned(tenantId, id);
    if (cl.estado !== 'rascunho') {
      throw new BadRequestException('Apenas rascunho pode ser submetido');
    }
    const [row] = await this.db
      .update(checklist)
      .set({ estado: 'pendente_aprovacao' })
      .where(eq(checklist.id, id))
      .returning();
    return row;
  }

  // Gerente/presidente publica: vira vigente e gera o snapshot do POP.
  async publicar(tenantId: string, id: string, aprovadorId: string) {
    const cl = await this.getOwned(tenantId, id);

    const [row] = await this.db
      .update(checklist)
      .set({ estado: 'vigente', aprovadorId, aprovadoEm: new Date() })
      .where(eq(checklist.id, id))
      .returning();

    const itens = await this.db
      .select()
      .from(checklistItem)
      .where(eq(checklistItem.checklistId, id));

    const [popRow] = await this.db
      .insert(pop)
      .values({
        tenantId,
        checklistId: id,
        versao: cl.versao,
        conteudoSnapshot: { nome: cl.nome, versao: cl.versao, itens },
      })
      .onConflictDoNothing()
      .returning();

    return { checklist: row, pop: popRow ?? null };
  }

  listPops(tenantId: string, checklistId: string) {
    return this.db
      .select()
      .from(pop)
      .where(and(eq(pop.tenantId, tenantId), eq(pop.checklistId, checklistId)));
  }
}
