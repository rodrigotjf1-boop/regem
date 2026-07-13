import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../db/drizzle.module';
import { empresa } from '../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Restringe rotas ao DISTRIBUIDOR (DMS/revenda). A conta comum (o presidente do
// próprio negócio) NÃO passa — mesmo sendo 'presidente'. Autoritativo pelo banco
// (não depende do token), então marcar/desmarcar vale na hora, sem re-login.
@Injectable()
export class DistribuidorGuard implements CanActivate {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req: any = ctx.switchToHttp().getRequest();
    const tenantId = req.user?.tenantId;
    if (!tenantId) throw new ForbiddenException('Acesso restrito.');
    const [e] = await this.db
      .select({ dist: empresa.isDistribuidor })
      .from(empresa)
      .where(eq(empresa.id, tenantId))
      .limit(1);
    if (!e?.dist) throw new ForbiddenException('Acesso restrito à distribuição.');
    return true;
  }
}
