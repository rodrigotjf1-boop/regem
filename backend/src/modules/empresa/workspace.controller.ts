import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador, empresa, unidade } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Workspace da empresa (Fase 2).
 *
 * Antes, o atendente do balcão entrava na MESMA tela em que logam os presidentes
 * de todas as empresas do Regem — sem identidade da loja e exigindo e-mail, que
 * ele não tem. Aqui o PC informa o e-mail da empresa UMA vez e recebe a
 * identidade dela: nome, unidades e os módulos do plano contratado. A partir
 * daí a tela é "o workspace daquela loja" e o login é por apelido + senha.
 *
 * Público de propósito (é o passo anterior ao login), mas devolve só o que já
 * apareceria na fachada: nome da empresa, nomes das unidades e quais módulos
 * estão no plano. Nada de dado pessoal, financeiro ou lista de colaboradores.
 * Rate-limit apertado para não virar sonda de "quais empresas existem".
 */
@Controller('publico/workspace')
export class WorkspaceController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get()
  @Throttle({ default: { limit: 12, ttl: 60000 } })
  async resolver(@Query('email') email: string) {
    const e = String(email ?? '').trim().toLowerCase();
    if (!e || !e.includes('@')) throw new BadRequestException('Informe o e-mail da empresa.');

    // Acha o tenant pelo e-mail de QUALQUER pessoa dela (normalmente o presidente
    // que fez o cadastro). Mensagem igual para "não existe" e "existe", para não
    // virar um oráculo de quais e-mails estão cadastrados.
    const [dono] = await this.db
      .select({ tenantId: colaborador.tenantId })
      .from(colaborador)
      .where(and(eq(sql`lower(${colaborador.email})`, e), isNull(colaborador.deletedAt)));
    if (!dono) throw new BadRequestException('Não encontrei um workspace com esse e-mail.');

    const [emp] = await this.db
      .select({ id: empresa.id, nome: empresa.nome })
      .from(empresa)
      .where(eq(empresa.id, dono.tenantId));
    if (!emp) throw new BadRequestException('Não encontrei um workspace com esse e-mail.');

    const unidades = await this.db
      .select({ id: unidade.id, nome: unidade.nome, tipo: unidade.tipo })
      .from(unidade)
      .where(and(eq(unidade.tenantId, emp.id), isNull(unidade.deletedAt)))
      .orderBy(sql`(tipo = 'matriz') desc`, unidade.createdAt);

    // Módulos do plano contratado (a distribuição edita quando a loja troca de
    // plano) — o workspace já abre sabendo o que essa empresa tem direito.
    const r: any = await this.db.execute(sql`
      select modulos, plano from ativacao
      where tenant_id = ${emp.id} and status = 'ativado'
      order by atualizado_em desc nulls last limit 1
    `);
    const at = (r?.rows ?? r)?.[0];

    return {
      tenantId: emp.id,
      nome: emp.nome,
      plano: at?.plano ?? null,
      modulos: Array.isArray(at?.modulos) ? at.modulos : [],
      // Só pergunta a unidade quando há mais de uma — com uma só não há escolha.
      unidades: unidades.map((u) => ({ id: u.id, nome: u.nome, tipo: u.tipo })),
    };
  }
}
