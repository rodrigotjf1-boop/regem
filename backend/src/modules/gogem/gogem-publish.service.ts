import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { notarEnvioAoGogem, registroDoGogem } from './credencial-gogem';
import { CONTRATO_AVISO_ASSINADO, TIPO_ASSINADO } from './aviso-gogem';
import { cabecalhosDoAviso } from '../integracao-api/webhook-integracao';
import { causaDeRede } from '../../common/causa-de-rede';

const TIMEOUT_MS = 15_000;

/** Sem o registro do GoGeM para a loja: a publicação não tem para onde ir (e o Regem não chuta outro caminho). */
export const MSG_PUBLICAR_SEM_REGISTRO =
  'O GoGeM ainda não ligou os avisos desta loja, então a publicação não tem para onde ir. ' +
  'Confira a integração no painel do GoGeM e tente de novo.';

/**
 * "Publicar no GoGeM": empurra na hora as pausas/edições deste tenant para o
 * GoGeM (que re-sincroniza os produtos linkados e republica o cardápio).
 *
 * Sai ASSINADO (`catalogo.publicar`) para o endereço que o GoGeM registrou para a
 * loja em uso (`docs/integracao-gogem/AVISOS-ASSINADOS.md` §5). Desde a fase 4
 * (24/11/2026, P-7 do "Fim das portas antigas") o caminho antigo
 * (`/sync/regem/publicar` com o `X-Sync-Token`) não é mais chamado e o token antigo
 * não vai junto. Best-effort com erro claro.
 */
@Injectable()
export class GogemPublishService {
  private readonly logger = new Logger(GogemPublishService.name);
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async publicar(
    tenantId: string,
    unidadeId: string | null = null,
  ): Promise<{ ok: true; alterados?: number }> {
    const registro = await registroDoGogem(this.db, tenantId, unidadeId);
    if (!registro) {
      this.logger.warn(`Publicar no GoGeM: sem o registro dos avisos (empresa ${tenantId})`);
      throw new BadRequestException(MSG_PUBLICAR_SEM_REGISTRO);
    }

    const body = JSON.stringify({
      tipo: TIPO_ASSINADO.publicar,
      contrato: CONTRATO_AVISO_ASSINADO,
      loja_id: registro.lojaId ?? unidadeId,
      pedido_em: new Date().toISOString(),
    });
    const headers: Record<string, string> = {
      ...cabecalhosDoAviso(registro.chave, `publicar_${randomUUID()}`, body),
      Accept: 'application/json',
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(registro.url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        // O endereço registrado foi conferido no registro: redirecionamento não se segue.
        redirect: 'manual',
      });
      await notarEnvioAoGogem(this.db, registro.tokenId, res.status);
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
      // O "fetch failed" sozinho não diz o porquê (ERR-239): a causa vai para o log e para a tela.
      const causa = causaDeRede(err);
      this.logger.warn(`Publicar no GoGeM falhou (tenant ${tenantId}): ${msg}${causa ? ` — ${causa}` : ''}`);
      throw new BadRequestException(causa ? `Não foi possível conectar ao GoGeM (${causa}).` : `Falha ao publicar no GoGeM: ${msg}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
