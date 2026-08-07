import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F9 — lado da LOJA da sessão de suporte: o presidente vê os acessos do técnico e
// pode BLOQUEAR/DESBLOQUEAR o acesso de suporte (revogação). Bloquear encerra as
// sessões ativas na hora (o JwtAuthGuard revalida e derruba o técnico em ~30s).
@Injectable()
export class SuporteService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async estado(tenantId: string) {
    const emp: any = await this.db.execute(
      sql`select suporte_bloqueado as "bloqueado" from empresa where id = ${tenantId} limit 1`,
    );
    const ativ: any = await this.db.execute(sql`
      select id, tecnico_nome as "tecnicoNome", motivo, iniciada_em as "iniciadaEm", expira_em as "expiraEm"
      from suporte_sessao
      where tenant_id = ${tenantId} and encerrada_em is null and expira_em > now()
      order by iniciada_em desc`);
    return {
      bloqueado: !!(emp.rows ?? emp)[0]?.bloqueado,
      sessoesAtivas: (ativ.rows ?? ativ) as any[],
    };
  }

  // Histórico (para a tela "Acessos de suporte").
  async sessoes(tenantId: string, limite = 50) {
    const r: any = await this.db.execute(sql`
      select id, tecnico_nome as "tecnicoNome", motivo, ip,
             iniciada_em as "iniciadaEm", expira_em as "expiraEm",
             encerrada_em as "encerradaEm", encerrada_por as "encerradaPor"
      from suporte_sessao where tenant_id = ${tenantId}
      order by iniciada_em desc limit ${limite}`);
    return (r.rows ?? r) as any[];
  }

  async bloquear(tenantId: string, atorId: string, atorPerfil: string, bloquear: boolean) {
    await this.db.execute(
      sql`update empresa set suporte_bloqueado = ${bloquear} where id = ${tenantId}`,
    );
    if (bloquear) {
      // Corta as sessões ativas imediatamente (o guard revalida e nega em ~30s).
      await this.db.execute(sql`
        update suporte_sessao set encerrada_em = now(), encerrada_por = 'loja'
        where tenant_id = ${tenantId} and encerrada_em is null`);
    }
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'acessos',
      acao: bloquear ? 'suporte_bloqueado' : 'suporte_liberado',
      detalhe: {},
    });
    return this.estado(tenantId);
  }
}
