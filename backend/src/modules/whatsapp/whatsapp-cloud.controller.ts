import { Controller, Get, HttpCode, Logger, Post, Query, Req, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CloudOnly } from '../../common/cloud-only.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Webhook da API OFICIAL do WhatsApp (Meta Cloud API). Fase 1: SÓ RECEBE e loga.
// Não toca no fluxo do Evolution (whatsapp.controller/service) — é uma via paralela,
// para a loja poder migrar por provedor sem derrubar quem está no Evolution.
//
// Config (secrets no servidor):
//   WA_CLOUD_VERIFY_TOKEN — segredo do desafio de verificação (você inventa; o mesmo
//                           valor vai no campo "Verificar token" do painel da Meta).
//   WA_CLOUD_APP_SECRET   — "Chave secreta do app" (Configurações do app → Básico).
//                           Valida a assinatura X-Hub-Signature-256 de cada evento.
//   WA_CLOUD_DEBUG=1      — (opcional) loga o payload inteiro. Só para diagnóstico:
//                           o corpo traz telefone e texto do cliente (LGPD).
//
// A Meta NÃO reenvia indefinidamente: se o endpoint falhar demais ela desativa a
// assinatura. Por isso todo erro de processamento é engolido e respondemos 200 —
// só assinatura inválida devolve 401 (aí é alguém se passando pela Meta).

// Confere a assinatura da Meta em tempo constante (evita timing attack).
// Fail-closed: sem APP_SECRET configurado, nada passa.
function assinaturaOk(rawBody: Buffer | undefined, header: string | undefined): boolean {
  const segredo = process.env.WA_CLOUD_APP_SECRET ?? '';
  if (!segredo || !rawBody || !header?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', segredo).update(rawBody).digest('hex');
  const a = Buffer.from(header.slice('sha256='.length), 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

// Telefone só com os 4 últimos dígitos — o log não guarda o número do cliente.
function mascarar(tel?: string): string {
  const s = String(tel ?? '');
  return s.length > 4 ? `***${s.slice(-4)}` : '***';
}

@Controller()
@CloudOnly()
export class WhatsappCloudController {
  private readonly logger = new Logger('WhatsappCloud');

  // Desafio de verificação. A Meta chama UMA vez, ao salvar a URL no painel, e
  // exige o hub.challenge cru no corpo — qualquer JSON em volta reprova.
  @Get('publico/whatsapp/cloud/webhook')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  verificar(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const esperado = process.env.WA_CLOUD_VERIFY_TOKEN ?? '';
    if (!esperado) {
      this.logger.error('WA_CLOUD_VERIFY_TOKEN não configurado — verificação recusada.');
      throw new UnauthorizedException('Webhook não configurado.');
    }
    const a = Buffer.from(String(token ?? ''), 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    const confere = a.length === b.length && timingSafeEqual(a, b);
    if (mode !== 'subscribe' || !confere) {
      this.logger.warn(`Verificação recusada (mode=${mode ?? '-'}).`);
      throw new UnauthorizedException('Verificação inválida.');
    }
    this.logger.log('Webhook verificado pela Meta.');
    return String(challenge ?? '');
  }

  // Eventos (mensagens recebidas + status de entrega das que enviamos).
  @Post('publico/whatsapp/cloud/webhook')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  evento(@Req() req: any) {
    if (!assinaturaOk(req.rawBody, req.headers?.['x-hub-signature-256'])) {
      this.logger.warn('Evento com assinatura inválida — descartado.');
      throw new UnauthorizedException('Assinatura inválida.');
    }
    try {
      const body = req.body ?? {};
      if (process.env.WA_CLOUD_DEBUG === '1') {
        this.logger.debug(JSON.stringify(body));
      }
      for (const entry of body.entry ?? []) {
        for (const ch of entry.changes ?? []) {
          const v = ch.value ?? {};
          const numeroLoja = v.metadata?.display_phone_number ?? '?';
          for (const m of v.messages ?? []) {
            this.logger.log(
              `msg loja=${numeroLoja} de=${mascarar(m.from)} tipo=${m.type} id=${m.id}`,
            );
          }
          for (const s of v.statuses ?? []) {
            this.logger.log(`status loja=${numeroLoja} ${s.status} id=${s.id}`);
          }
        }
      }
    } catch (e: any) {
      // Nunca propaga: erro nosso não pode virar retry/desativação do webhook na Meta.
      this.logger.error(`Falha ao processar evento: ${e?.message ?? e}`);
    }
    return { ok: true };
  }
}
