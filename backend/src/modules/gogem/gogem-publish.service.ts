import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { tokenDoGogem } from './credencial-gogem';

// A API do GoGeM é multi-tenant numa URL só; o tenant é identificado pelo
// X-Sync-Token (o da integração dele). Configurável por env se mudar.
const GOGEM_URL_PADRAO =
  'https://api.gogem.com.br/api/v1/sync/regem/publicar';
const TIMEOUT_MS = 15_000;

/**
 * "Publicar no GoGeM": empurra na hora as pausas/edições deste tenant para o
 * GoGeM (que re-sincroniza os produtos linkados e republica o cardápio). Usa o
 * token do equipamento que o GoGeM marcou como a credencial dele (mig 290) —
 * nunca "um servidor_local qualquer", que o GoGeM recusa (ERR-108). Best-effort
 * com erro claro.
 */
@Injectable()
export class GogemPublishService {
  private readonly logger = new Logger(GogemPublishService.name);
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async publicar(
    tenantId: string,
  ): Promise<{ ok: true; alterados?: number }> {
    const token = await tokenDoGogem(this.db, tenantId);
    if (!token) {
      this.logger.warn(`Publicar no GoGeM: o GoGeM ainda não se identificou para a empresa ${tenantId}`);
      throw new BadRequestException(
        'O GoGeM ainda não se identificou para esta empresa — ele faz isso sozinho na próxima ' +
          'sincronização do cardápio. Tente de novo em alguns minutos; se continuar, confira a ' +
          'integração no painel do GoGeM.',
      );
    }

    const url = process.env.GOGEM_PUBLISH_URL ?? GOGEM_URL_PADRAO;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'X-Sync-Token': token,
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
