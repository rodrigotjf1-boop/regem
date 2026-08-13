import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { RLS_ENABLED, runWithTenantTx } from '../db/tenant-context';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * RLS por tenant (defesa em profundidade).
 *
 * Quando RLS_ENABLED=true e o request tem tenant no JWT, abre UMA transação para o
 * request inteiro, fixa `app.tenant` com `set_config(..., true)` (local à transação)
 * e roda o handler dentro dela — o proxy do DRIZZLE roteia todo query dessa request
 * para essa transação, então a policy RLS enxerga o tenant certo. Se o handler
 * lança, a transação faz rollback (comportamento melhor, não pior).
 *
 * Deve ser o interceptor MAIS EXTERNO (registrado primeiro) para que a transação
 * cubra também os demais interceptors e seus queries.
 *
 * NÃO cobre (de propósito):
 *  - rotas sem tenant no JWT (cardápio público via token, webhooks): o GUC não é
 *    fixado; sob role sem bypass essas tabelas precisam ser tratadas na ativação
 *    (ver docs/rls-multitenant.md — usar `comTenant` ao resolver o tenant do token).
 *  - jobs/pollers (fora do ciclo HTTP): idem, wrap explícito por tenant na ativação.
 *
 * GATE: com RLS_ENABLED=false (default), é passthrough puro — zero efeito.
 */
@Injectable()
export class RlsInterceptor implements NestInterceptor {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!RLS_ENABLED || context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest();
    const tenantId = req?.user?.tenantId;
    if (!tenantId) return next.handle(); // público/token/sem tenant → sem GUC
    return from(
      (this.db as any).transaction(async (tx: any) => {
        await tx.execute(sql`select set_config('app.tenant', ${tenantId}, true)`);
        return runWithTenantTx(tenantId, tx, () => lastValueFrom(next.handle()));
      }),
    );
  }
}
