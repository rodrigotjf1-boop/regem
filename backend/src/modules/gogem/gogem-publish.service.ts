import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { notarEnvioAoGogem, registroDoGogem, tokenDoGogem } from './credencial-gogem';
import { CONTRATO_AVISO_ASSINADO, TIPO_ASSINADO } from './aviso-gogem';
import { cabecalhosDoAviso } from '../integracao-api/webhook-integracao';
import { causaDeRede } from '../../common/causa-de-rede';

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
 *
 * Fase 2 (`docs/integracao-gogem/AVISOS-ASSINADOS.md` §5): se o GoGeM registrou o
 * endereço de aviso da loja em uso, sai ASSINADO para lá (`catalogo.publicar`),
 * com o `X-Sync-Token` junto até a fase 4. Sem registro, o caminho de antes.
 */
@Injectable()
export class GogemPublishService {
  private readonly logger = new Logger(GogemPublishService.name);
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async publicar(
    tenantId: string,
    unidadeId: string | null = null,
  ): Promise<{ ok: true; alterados?: number }> {
    const token = await tokenDoGogem(this.db, tenantId);
    const registro = await registroDoGogem(this.db, tenantId, unidadeId);
    if (!token && !registro) {
      this.logger.warn(`Publicar no GoGeM: o GoGeM ainda não se identificou para a empresa ${tenantId}`);
      throw new BadRequestException(
        'O GoGeM ainda não se identificou para esta empresa — ele faz isso sozinho na próxima ' +
          'sincronização do cardápio. Tente de novo em alguns minutos; se continuar, confira a ' +
          'integração no painel do GoGeM.',
      );
    }

    let url: string;
    let body: string;
    let headers: Record<string, string>;
    if (registro) {
      url = registro.url;
      body = JSON.stringify({
        tipo: TIPO_ASSINADO.publicar,
        contrato: CONTRATO_AVISO_ASSINADO,
        loja_id: registro.lojaId ?? unidadeId,
        pedido_em: new Date().toISOString(),
      });
      headers = {
        ...cabecalhosDoAviso(registro.chave, `publicar_${randomUUID()}`, body),
        Accept: 'application/json',
        ...(token ? { 'X-Sync-Token': token } : {}),
      };
    } else {
      url = process.env.GOGEM_PUBLISH_URL ?? GOGEM_URL_PADRAO;
      body = '{}';
      headers = {
        'X-Sync-Token': token as string,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
        // O endereço registrado foi conferido no registro: redirecionamento não se segue.
        ...(registro ? { redirect: 'manual' as const } : {}),
      });
      if (registro) await notarEnvioAoGogem(this.db, registro.tokenId, res.status);
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
