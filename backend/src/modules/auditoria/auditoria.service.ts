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

  async listar(tenantId: string, tipo?: string) {
    const res: any = await this.db.execute(sql`
      select a.id, a.tipo, a.acao, a.detalhe,
             a.actor_perfil as "atorPerfil", a.origem,
             a.created_at as "criadoEm", c.nome as "atorNome"
      from audit_log a
      left join colaborador c on c.id = a.actor_id
      where a.tenant_id = ${tenantId}
      ${tipo ? sql`and a.tipo = ${tipo}` : sql``}
      order by a.created_at desc
      limit 200
    `);
    return res.rows ?? res;
  }
}
