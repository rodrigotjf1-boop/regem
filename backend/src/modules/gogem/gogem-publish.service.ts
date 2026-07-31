import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { equipamento } from '../../db/schema';

// A API do GoGeM é multi-tenant numa URL só; o tenant é identificado pelo
// X-Sync-Token (o mesmo do servidor_local). Configurável por env se mudar.
const GOGEM_URL_PADRAO =
  'https://api.gogem.com.br/api/v1/sync/regem/publicar';
const TIMEOUT_MS = 15_000;

/**
 * "Publicar no GoGeM": empurra na hora as pausas/edições deste tenant para o
 * GoGeM (que re-sincroniza os produtos linkados e republica o cardápio). Usa o
 * token do equipamento `servidor_local` (o mesmo par que já autentica a
 * integração) — o GoGeM acha a loja por ele. Best-effort com erro claro.
 */
@Injectable()
export class GogemPublishService {
  private readonly logger = new Logger(GogemPublishService.name);
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async publicar(
    tenantId: string,
  ): Promise<{ ok: true; alterados?: number }> {
    const [srv] = await this.db
      .select({ token: equipamento.token })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'servidor_local'),
          eq(equipamento.ativo, true),
        ),
      )
      .limit(1);
    if (!srv?.token) {
      throw new BadRequestException(
        'Nenhum servidor GoGeM (servidor_local) ativo — configure a integração primeiro.',
      );
    }

    const url = process.env.GOGEM_PUBLISH_URL ?? GOGEM_URL_PADRAO;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Sync-Token': srv.token,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: '{}',
        signal: controller.signal,
      });
      if (!res.ok) {
        const corpo = await res.text().catch(() => '');
        throw new BadRequestException(
          `GoGeM respondeu ${res.status}: ${corpo}`,
        );
      }
      const data = (await res.json().catch(() => ({}))) as {
        alterados?: number;
      };
      return { ok: true, alterados: data.alterados };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Publicar no GoGeM falhou (tenant ${tenantId}): ${msg}`);
      throw new BadRequestException(`Falha ao publicar no GoGeM: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
