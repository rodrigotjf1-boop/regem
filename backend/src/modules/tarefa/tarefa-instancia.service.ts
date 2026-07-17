import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  tarefaDef,
  tarefaInstancia,
  escalaAlocacao,
  etiqueta,
  setor,
  funcao,
  colaborador,
  entitlement,
} from '../../db/schema';
import { resolverColaboradorTarefa } from '../../common/regras-negocio';
import { InstanciarTarefaDto } from './dto/instanciar-tarefa.dto';
import { ConcluirTarefaDto } from './dto/concluir-tarefa.dto';

@Injectable()
export class TarefaInstanciaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Late-binding: resolve o colaborador da tarefa pela escala do dia.
  async instanciar(tenantId: string, dto: InstanciarTarefaDto) {
    const [def] = await this.db
      .select()
      .from(tarefaDef)
      .where(
        and(
          eq(tarefaDef.id, dto.tarefaDefId),
          eq(tarefaDef.tenantId, tenantId),
          isNull(tarefaDef.deletedAt),
        ),
      );
    if (!def) throw new NotFoundException('Tarefa não encontrada');

    // 1) override explícito vence; 2) senão, quem está na etiqueta naquela data.
    let alocacaoColaboradorId: string | null = null;
    if (!def.colaboradorOverrideId && def.etiquetaId) {
      const [aloc] = await this.db
        .select({ colaboradorId: escalaAlocacao.colaboradorId })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.etiquetaId, def.etiquetaId),
            eq(escalaAlocacao.data, dto.data),
            isNull(escalaAlocacao.deletedAt),
          ),
        )
        .limit(1);
      alocacaoColaboradorId = aloc?.colaboradorId ?? null;
    }
    // Prioridade do responsável: escolha explícita de quem cria (um escalado da
    // função/setor) > override do def > escalado da etiqueta. Ausente = em aberto.
    const colaboradorResolvidoId =
      dto.colaboradorResolvidoId ??
      resolverColaboradorTarefa(def.colaboradorOverrideId, alocacaoColaboradorId);

    const [row] = await this.db
      .insert(tarefaInstancia)
      .values({
        tenantId,
        unidadeId: def.unidadeId,
        tarefaDefId: def.id,
        data: dto.data,
        etiquetaId: def.etiquetaId,
        funcaoId: def.funcaoId, // snapshot da função-alvo
        setorId: def.setorId,
        colaboradorResolvidoId,
      })
      .returning();
    return row;
  }

  // Escalados de uma função (+setor opcional) numa data — para quem cria a tarefa
  // escolher o responsável (ou deixar "em aberto"). Resolve o caso de vários
  // escalados na mesma função (lojas grandes).
  async responsaveis(
    tenantId: string,
    data: string,
    funcaoId: string,
    setorId?: string,
  ) {
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      eq(escalaAlocacao.data, data),
      isNull(escalaAlocacao.deletedAt),
      eq(etiqueta.funcaoId, funcaoId),
    ];
    if (setorId) conds.push(eq(etiqueta.setorId, setorId));
    return this.db
      .selectDistinct({ id: colaborador.id, nome: colaborador.nome })
      .from(escalaAlocacao)
      .innerJoin(etiqueta, eq(etiqueta.id, escalaAlocacao.etiquetaId))
      .innerJoin(colaborador, eq(colaborador.id, escalaAlocacao.colaboradorId))
      .where(and(...conds))
      .orderBy(colaborador.nome);
  }

  // Lista enriquecida (título, setor, responsável) para a tela "Meu Dia".
  findAll(tenantId: string, data?: string) {
    const conds = [
      eq(tarefaInstancia.tenantId, tenantId),
      isNull(tarefaInstancia.deletedAt),
    ];
    if (data) conds.push(eq(tarefaInstancia.data, data));
    return this.db
      .select({
        id: tarefaInstancia.id,
        data: tarefaInstancia.data,
        estado: tarefaInstancia.estado,
        motivo: tarefaInstancia.motivo,
        titulo: tarefaDef.titulo,
        horario: tarefaDef.horario,
        etiquetaSigla: etiqueta.sigla,
        etiquetaContador: etiqueta.contador,
        // Setor/função: snapshot da instância (novo cadastro) ou via etiqueta (legado).
        setorId: sql<string | null>`coalesce(${tarefaInstancia.setorId}, ${etiqueta.setorId})`,
        setorNome: setor.nome,
        setorIcone: setor.icone,
        funcaoId: tarefaInstancia.funcaoId,
        funcaoNome: funcao.nome,
        colaboradorId: tarefaInstancia.colaboradorResolvidoId,
        colaboradorNome: colaborador.nome,
        fotos: tarefaInstancia.fotos,
        concluidoEm: tarefaInstancia.concluidoEm,
      })
      .from(tarefaInstancia)
      .leftJoin(tarefaDef, eq(tarefaInstancia.tarefaDefId, tarefaDef.id))
      .leftJoin(etiqueta, eq(tarefaInstancia.etiquetaId, etiqueta.id))
      .leftJoin(
        setor,
        eq(setor.id, sql`coalesce(${tarefaInstancia.setorId}, ${etiqueta.setorId})`),
      )
      .leftJoin(funcao, eq(funcao.id, tarefaInstancia.funcaoId))
      .leftJoin(
        colaborador,
        eq(tarefaInstancia.colaboradorResolvidoId, colaborador.id),
      )
      .where(and(...conds));
  }

  // Política de foto (presidente/C&O): exigir foto na conclusão e/ou na parcial.
  // Guardada em entitlement (sem tabela nova), como o pdv_caixa_livre.
  async politicaFoto(tenantId: string): Promise<{ conclusao: boolean; parcial: boolean }> {
    const rows = await this.db
      .select({ modulo: entitlement.modulo, ativo: entitlement.ativo })
      .from(entitlement)
      .where(eq(entitlement.tenantId, tenantId));
    const on = (m: string) => rows.find((r) => r.modulo === m)?.ativo ?? false;
    return { conclusao: on('tarefa_foto_conclusao'), parcial: on('tarefa_foto_parcial') };
  }

  async setPoliticaFoto(
    tenantId: string,
    dto: { conclusao?: boolean; parcial?: boolean },
  ) {
    const upsert = async (modulo: string, ativo: boolean) =>
      this.db
        .insert(entitlement)
        .values({ tenantId, modulo, ativo })
        .onConflictDoUpdate({
          target: [entitlement.tenantId, entitlement.modulo],
          set: { ativo, updatedAt: new Date() },
        });
    if (dto.conclusao !== undefined) await upsert('tarefa_foto_conclusao', !!dto.conclusao);
    if (dto.parcial !== undefined) await upsert('tarefa_foto_parcial', !!dto.parcial);
    return this.politicaFoto(tenantId);
  }

  // Muda o status da tarefa. Aplica a política de foto no servidor:
  //  - feita: foto obrigatória se o presidente exigir;
  //  - parcial: foto obrigatória se o presidente exigir;
  //  - nao_feita: nunca tem foto, só motivo (obrigatório).
  // Fotos com comprovação recebem data_expurgo = hoje + 30 dias (LGPD).
  async concluir(
    tenantId: string,
    id: string,
    dto: ConcluirTarefaDto,
    colaboradorId: string,
  ) {
    let fotos = (dto.fotos ?? (dto.fotoRef ? [dto.fotoRef] : [])).filter(Boolean).slice(0, 3);
    const pol = await this.politicaFoto(tenantId);

    if (dto.estado === 'nao_feita') {
      if (!dto.motivo?.trim())
        throw new BadRequestException('Informe o motivo da não conclusão.');
      fotos = []; // não concluída não guarda foto
    }
    if (dto.estado === 'feita' && pol.conclusao && fotos.length === 0)
      throw new BadRequestException('Foto de comprovação é obrigatória na conclusão.');
    if (dto.estado === 'parcial' && pol.parcial && fotos.length === 0)
      throw new BadRequestException('Foto de comprovação é obrigatória na conclusão parcial.');

    const expurgo = fotos.length
      ? new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)
      : null;

    const [row] = await this.db
      .update(tarefaInstancia)
      .set({
        estado: dto.estado,
        motivo: dto.motivo,
        fotoRef: fotos[0] ?? null,
        fotos,
        dataExpurgo: expurgo,
        concluidoPorId: colaboradorId,
        concluidoEm: new Date(),
        conclusaoEmMassa: dto.conclusaoEmMassa ?? false,
      })
      .where(
        and(eq(tarefaInstancia.id, id), eq(tarefaInstancia.tenantId, tenantId)),
      )
      .returning();
    if (!row) throw new NotFoundException('Instância não encontrada');
    return row;
  }

  // Exclui a tarefa (soft-delete) exigindo motivo. Guarda o motivo e a auditoria
  // fica no controller.
  async excluir(tenantId: string, id: string, motivo: string) {
    if (!motivo?.trim()) throw new BadRequestException('Informe o motivo da exclusão.');
    const [row] = await this.db
      .update(tarefaInstancia)
      .set({ deletedAt: new Date(), motivo })
      .where(
        and(
          eq(tarefaInstancia.id, id),
          eq(tarefaInstancia.tenantId, tenantId),
          isNull(tarefaInstancia.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Tarefa não encontrada');
    return { ok: true };
  }

  // Edita a tarefa: responsável (instância) + título/horário/setor/função (no def,
  // que numa tarefa avulsa é 1:1 com a instância).
  async editar(
    tenantId: string,
    id: string,
    dto: {
      titulo?: string;
      horario?: string;
      setorId?: string | null;
      funcaoId?: string | null;
      colaboradorResolvidoId?: string | null;
    },
  ) {
    const [inst] = await this.db
      .select()
      .from(tarefaInstancia)
      .where(
        and(
          eq(tarefaInstancia.id, id),
          eq(tarefaInstancia.tenantId, tenantId),
          isNull(tarefaInstancia.deletedAt),
        ),
      );
    if (!inst) throw new NotFoundException('Tarefa não encontrada');

    await this.db
      .update(tarefaInstancia)
      .set({
        setorId: dto.setorId ?? inst.setorId,
        funcaoId: dto.funcaoId ?? inst.funcaoId,
        colaboradorResolvidoId:
          dto.colaboradorResolvidoId === undefined
            ? inst.colaboradorResolvidoId
            : dto.colaboradorResolvidoId,
        updatedAt: new Date(),
      })
      .where(eq(tarefaInstancia.id, id));

    // Título/horário vivem no def; atualiza quando a tarefa é avulsa (1:1).
    if (inst.tarefaDefId && (dto.titulo !== undefined || dto.horario !== undefined)) {
      const patch: Record<string, unknown> = {};
      if (dto.titulo !== undefined) patch.titulo = dto.titulo;
      if (dto.horario !== undefined) patch.horario = dto.horario || null;
      if (dto.setorId !== undefined) patch.setorId = dto.setorId;
      if (dto.funcaoId !== undefined) patch.funcaoId = dto.funcaoId;
      if (Object.keys(patch).length)
        await this.db.update(tarefaDef).set(patch).where(eq(tarefaDef.id, inst.tarefaDefId));
    }
    return { ok: true };
  }
}
