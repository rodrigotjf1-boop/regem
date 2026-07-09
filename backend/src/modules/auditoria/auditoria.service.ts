import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { auditLog } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AuditEntry = {
  tenantId: string;
  atorId?: string | null;
  atorPerfil?: string | null;
  tipo: string;
  acao: string;
  detalhe?: any;
  origem?: string;
  unidadeId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
};

@Injectable()
export class AuditoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Registro imutável. Nunca deve derrubar a operação principal.
  async registrar(e: AuditEntry) {
    try {
      await this.db.insert(auditLog).values({
        tenantId: e.tenantId,
        unidadeId: e.unidadeId ?? undefined,
        actorId: e.atorId ?? undefined,
        actorPerfil: e.atorPerfil ?? undefined,
        tipo: e.tipo,
        acao: e.acao,
        detalhe: e.detalhe ?? undefined,
        entidadeTipo: e.entidadeTipo ?? undefined,
        entidadeId: e.entidadeId ?? undefined,
        origem: e.origem ?? 'web',
      });
    } catch {
      /* auditoria não pode quebrar a operação */
    }
  }

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // Trilha filtrável: tipo + busca (ator/ação/tipo/detalhe) + período (de/até).
  // Devolve os registros e os tipos distintos existentes (para os chips do front).
  async listar(
    tenantId: string,
    f: { tipo?: string; busca?: string; de?: string; ate?: string } = {},
  ) {
    const cond = [sql`a.tenant_id = ${tenantId}`];
    if (f.tipo) cond.push(sql`a.tipo = ${f.tipo}`);
    if (f.de) cond.push(sql`a.created_at::date >= ${f.de}`);
    if (f.ate) cond.push(sql`a.created_at::date <= ${f.ate}`);
    if (f.busca?.trim()) {
      const q = `%${f.busca.trim().toLowerCase()}%`;
      cond.push(sql`(
        lower(coalesce(c.nome,'')) like ${q}
        or lower(a.acao) like ${q}
        or lower(coalesce(a.tipo,'')) like ${q}
        or lower(coalesce(a.detalhe::text,'')) like ${q}
      )`);
    }
    const where = sql.join(cond, sql` and `);

    const registros = await this.rows(sql`
      select a.id, a.tipo, a.acao, a.detalhe,
             a.actor_id as "atorId", a.actor_perfil as "atorPerfil", a.origem,
             a.created_at as "criadoEm", c.nome as "atorNome"
      from audit_log a
      left join colaborador c on c.id = a.actor_id
      where ${where}
      order by a.created_at desc
      limit 300
    `);
    const tipos = await this.rows(sql`
      select distinct tipo from audit_log
      where tenant_id = ${tenantId} and tipo is not null and tipo <> ''
      order by tipo`);
    return { registros, tipos: tipos.map((t) => t.tipo as string) };
  }
}
