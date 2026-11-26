import { BadRequestException, ForbiddenException, Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import type { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { DIAS_PARA_PARADA, FEITO_MAX, PEDIDO_MAX, chaveDoAprendizado, escolherExemplos, linhasDosExemplos, podeAprender, textoAprendido } from './mister-aprendizado';
import { MisterConversaConfigService } from './mister-conversa-config.service';
import { MisterPropostasService } from './mister-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// APRENDER PELA TAREFA FEITA (Mister, versão 10, fase C7; `mister-aprendizado.ts`, mig 508). Grava o exemplo quando a tarefa dá
// certo (com o ajuste "Aprender pela tarefa feita" ligado), entrega até 3 exemplos à próxima pergunta parecida e serve a parte
// "O que aprendi" (o presidente vê e esquece). Só na nuvem.

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';

export interface LinhaAprendida {
  id: string;
  pedido: string;
  feito: string;
  quem: string | null;
  /** Quem ensinou é quem está vendo (a tela diz "com você"). */
  souEu: boolean;
  criadoEm: string;
  usadoVezes: number;
  usadoEm: string | null;
  /** Dias desde o último uso (ou desde que foi aprendido): a mesma régua do "parada". */
  diasSemUso: number;
  parada: boolean;
}

@Injectable()
export class MisterAprendizadoService implements OnModuleInit {
  private readonly logger = new Logger('MisterAprendizado');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly propostas: MisterPropostasService,
    private readonly conversa: MisterConversaConfigService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  onModuleInit(): void {
    this.propostas.registrarAprender((p) => this.aprender(p));
  }

  /**
   * A proposta que terminou "feita": vira exemplo se o ajuste está ligado, o procedimento pode ser aprendido e a proposta
   * guardou o pedido da pessoa e o "Vou fazer". A mesma tarefa pedida do mesmo jeito atualiza a linha. Nunca lança.
   */
  async aprender(p: { tenantId: string; procedimento?: string; parametros?: any; autorizadaPor: string | null }): Promise<void> {
    try {
      const procedimento = String(p.procedimento ?? '');
      if (!procedimento || !podeAprender(procedimento)) return;
      const par = (p.parametros ?? {}) as Record<string, unknown>;
      // O passo de um plano não vira exemplo sozinho (o plano é a tarefa inteira).
      if (par.planoId) return;
      const pedido = textoAprendido(par.pedidoDaPessoa, PEDIDO_MAX);
      const feito = textoAprendido(par.resumoDaAcao ?? par.resumo, FEITO_MAX);
      if (!pedido || !feito) return;
      if (!(await this.conversa.daEmpresa(p.tenantId)).aprenderTarefas) return;
      await this.db.execute(sql`
        insert into mister_aprendizado (tenant_id, colaborador_id, procedimento, pedido, feito, chave)
        values (${p.tenantId}::uuid, ${p.autorizadaPor}::uuid, ${procedimento}, ${pedido}, ${feito}, ${chaveDoAprendizado(procedimento, pedido)})
        on conflict (tenant_id, chave) do update
          set pedido = excluded.pedido, feito = excluded.feito, colaborador_id = excluded.colaborador_id, atualizado_em = clock_timestamp()`);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`o exemplo não foi gravado — ${e?.message ?? e}`);
    }
  }

  /** As linhas dos exemplos para a pergunta (até 3), contando o uso. Com o ajuste desligado ou sem nada parecido, nada. Nunca lança. */
  async exemplosParaAConversa(tenantId: string, pergunta: string, verValores: boolean): Promise<string[]> {
    try {
      if (!(await this.conversa.daEmpresa(tenantId)).aprenderTarefas) return [];
      const lista = linhas(
        await this.db.execute(sql`
          select id::text as id, pedido, feito, atualizado_em as "atualizadoEm" from mister_aprendizado
           where tenant_id = ${tenantId}::uuid order by atualizado_em desc limit 200`),
      );
      const escolhidos = escolherExemplos(pergunta, lista);
      if (!escolhidos.length) return [];
      await this.db.execute(sql`
        update mister_aprendizado set usado_vezes = usado_vezes + 1, usado_em = clock_timestamp()
         where tenant_id = ${tenantId}::uuid and id in (${sql.join(escolhidos.map((x) => sql`${x.id}::uuid`), sql`, `)})`);
      return linhasDosExemplos(escolhidos, verValores);
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`os exemplos não foram lidos — a resposta vai sem eles (${e?.message ?? e})`);
      return [];
    }
  }

  /** A parte "O que aprendi": só o presidente. As situações contadas pela régua da tela ("parada" = sem uso há 30 dias). */
  async listar(user: AuthUser): Promise<{ ligado: boolean; total: number; usadas: number; paradas: number; aprendidos: LinhaAprendida[] }> {
    if (user.categoria !== 'presidente') throw new ForbiddenException('Só o presidente vê o que o Mister aprendeu.');
    const l = linhas(
      await this.db.execute(sql`
        select a.id::text as id, a.pedido, a.feito, c.nome as quem,
               (a.colaborador_id is not distinct from ${user.colaboradorId ?? null}::uuid) as "souEu",
               to_char(a.criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "criadoEm",
               a.usado_vezes as "usadoVezes",
               to_char(a.usado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "usadoEm",
               floor(extract(epoch from clock_timestamp() - coalesce(a.usado_em, a.atualizado_em)) / 86400)::int as "diasSemUso",
               coalesce(a.usado_em, a.atualizado_em) < clock_timestamp() - make_interval(days => ${DIAS_PARA_PARADA}::int) as parada
          from mister_aprendizado a
          left join colaborador c on c.id = a.colaborador_id and c.tenant_id = a.tenant_id
         where a.tenant_id = ${user.tenantId}::uuid
         order by coalesce(a.usado_em, a.atualizado_em) desc, a.id
         limit 500`),
    );
    const aprendidos: LinhaAprendida[] = l.map((x) => ({
      id: String(x.id),
      pedido: String(x.pedido),
      feito: String(x.feito),
      quem: x.quem ? String(x.quem) : null,
      souEu: x.souEu === true,
      criadoEm: String(x.criadoEm),
      usadoVezes: Number(x.usadoVezes ?? 0),
      usadoEm: x.usadoEm ? String(x.usadoEm) : null,
      diasSemUso: Math.max(0, Number(x.diasSemUso ?? 0)),
      parada: x.parada === true,
    }));
    // O ajuste ligado ou não (a tela avisa que, desligado, nada novo é aprendido e os exemplos não vão à conversa).
    const ligado = (await this.conversa.daEmpresa(user.tenantId)).aprenderTarefas === true;
    return { ligado, total: aprendidos.length, usadas: aprendidos.filter((a) => !a.parada).length, paradas: aprendidos.filter((a) => a.parada).length, aprendidos };
  }

  /** Esquecer um exemplo (só o presidente, só da empresa dele). Auditado. */
  async esquecer(user: AuthUser, id: string): Promise<{ esquecido: boolean }> {
    if (user.categoria !== 'presidente') throw new ForbiddenException('Só o presidente esquece o que o Mister aprendeu.');
    if (!UUID.test(String(id ?? ''))) throw new BadRequestException('Exemplo inválido.');
    const r = linhas(await this.db.execute(sql`delete from mister_aprendizado where tenant_id = ${user.tenantId}::uuid and id = ${id}::uuid returning id`));
    if (r.length)
      await this.auditoria
        ?.registrar({ tenantId: user.tenantId, atorId: user.colaboradorId, atorPerfil: user.categoria, tipo: 'mister', acao: 'mister_aprendizado_esquecido', entidadeTipo: 'mister_aprendizado', entidadeId: id, origem: 'web' } as any)
        .catch(() => undefined);
    return { esquecido: r.length > 0 };
  }
}
