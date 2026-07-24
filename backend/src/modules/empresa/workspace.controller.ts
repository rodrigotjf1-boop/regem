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
    return this.montar(dono.tenantId);
  }

  // No EDGE a empresa/unidade são fixas (definidas na instalação, EDGE_UNIDADE_ID):
  // o app não pergunta e-mail — abre direto no login já com nome/logo da loja.
  // Só responde quando roda no edge com a unidade configurada; na nuvem é 404.
  @Get('local')
  async local() {
    const uniId = process.env.EDGE_UNIDADE_ID?.trim();
    if (!uniId) throw new BadRequestException('Sem unidade local configurada.');
    const [uni] = await this.db
      .select({ tenantId: unidade.tenantId, id: unidade.id })
      .from(unidade)
      .where(and(eq(unidade.id, uniId), isNull(unidade.deletedAt)));
    if (!uni) throw new BadRequestException('Unidade local não encontrada.');
    // Fixa a unidade instalada (não deixa escolher outra no edge).
    return this.montar(uni.tenantId, uni.id);
  }

  // Monta a identidade do workspace (nome, logo, unidades, plano). `fixarUnidade`
  // trava numa unidade só (edge) — senão devolve todas para o app escolher.
  private async montar(tenantId: string, fixarUnidade?: string) {
    const [emp] = await this.db
      .select({ id: empresa.id, nome: empresa.nome })
      .from(empresa)
      .where(eq(empresa.id, tenantId));
    if (!emp) throw new BadRequestException('Empresa não encontrada.');

    // Logo da loja (cardapio_config.logo_ref) — o modal mostra a marca da empresa.
    const lg: any = await this.db.execute(sql`
      select logo_ref as logo from cardapio_config
      where tenant_id = ${emp.id} order by (unidade_id is null) desc limit 1
    `);
    const logo = (lg?.rows ?? lg)?.[0]?.logo ?? null;

    const todas = await this.db
      .select({ id: unidade.id, nome: unidade.nome, tipo: unidade.tipo })
      .from(unidade)
      .where(and(eq(unidade.tenantId, emp.id), isNull(unidade.deletedAt)))
      .orderBy(sql`(tipo = 'matriz') desc`, unidade.createdAt);
    const unidades = fixarUnidade ? todas.filter((u) => u.id === fixarUnidade) : todas;

    const r: any = await this.db.execute(sql`
      select modulos, plano from ativacao
      where tenant_id = ${emp.id} and status = 'ativado'
      order by atualizado_em desc nulls last limit 1
    `);
    const at = (r?.rows ?? r)?.[0];

    return {
      tenantId: emp.id,
      nome: emp.nome,
      logo,
      plano: at?.plano ?? null,
      modulos: Array.isArray(at?.modulos) ? at.modulos : [],
      unidades: unidades.map((u) => ({ id: u.id, nome: u.nome, tipo: u.tipo })),
    };
  }
}
