import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Loja única = sem filtro por unidade.
 *
 * O filtro por loja só faz sentido quando a rede tem MAIS DE UMA unidade. Com uma
 * só, filtrar não separa nada e ainda esconde todo registro antigo que ficou com
 * `unidade_id` nulo (dados criados antes do multi-unidade) — o usuário cadastra,
 * não vê na lista e acha que não salvou.
 *
 * Este interceptor conta as unidades do tenant (cache curto em memória) e marca a
 * requisição; o decorator `UnidadeAtual` lê essa marca e devolve `null` (= todas),
 * que com uma unidade só é exatamente essa unidade. Sem risco de vazamento: o
 * filtro de `tenant_id` continua em toda query.
 */
@Injectable()
export class UnidadeUnicaInterceptor implements NestInterceptor {
  private static cache = new Map<string, { unica: boolean; em: number }>();
  private static readonly TTL = 60_000; // 1 min: uma unidade nova vale rápido

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<any>> {
    const req = context.switchToHttp().getRequest();
    const tenantId = req?.user?.tenantId;
    if (tenantId) req.unidadeUnica = await this.unica(tenantId);
    return next.handle();
  }

  private async unica(tenantId: string): Promise<boolean> {
    const hit = UnidadeUnicaInterceptor.cache.get(tenantId);
    if (hit && Date.now() - hit.em < UnidadeUnicaInterceptor.TTL) return hit.unica;
    let unica = false;
    try {
      const r: any = await this.db.execute(sql`
        select count(*) as n from unidade
        where tenant_id = ${tenantId} and deleted_at is null
      `);
      unica = Number((r?.rows ?? r)?.[0]?.n ?? 0) <= 1;
    } catch {
      unica = false; // na dúvida, mantém o filtro (fail-closed)
    }
    UnidadeUnicaInterceptor.cache.set(tenantId, { unica, em: Date.now() });
    return unica;
  }
}
