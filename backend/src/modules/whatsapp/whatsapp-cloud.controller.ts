import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { WhatsappCloudService } from './whatsapp-cloud.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Webhook da API OFICIAL do WhatsApp (Meta Cloud API).
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

@Controller()
@CloudOnly()
export class WhatsappCloudController {
  private readonly logger = new Logger('WhatsappCloud');
  constructor(private readonly service: WhatsappCloudService) {}

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
  // Responde 200 na hora e processa em seguida: a Meta tem timeout curto, e
  // segurar a resposta esperando o n8n é o caminho para ela desativar a assinatura.
  @Post('publico/whatsapp/cloud/webhook')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  evento(@Req() req: any) {
    if (!assinaturaOk(req.rawBody, req.headers?.['x-hub-signature-256'])) {
      this.logger.warn('Evento com assinatura inválida — descartado.');
      throw new UnauthorizedException('Assinatura inválida.');
    }
    const body = req.body ?? {};
    if (process.env.WA_CLOUD_DEBUG === '1') {
      this.logger.debug(JSON.stringify(body));
    }
    // Sem await de propósito (ver comentário acima). O processar() nunca lança,
    // mas o catch fica como rede de segurança contra rejeição não tratada.
    this.service
      .processar(body)
      .catch((e: any) => this.logger.error(`Falha ao processar evento: ${e?.message ?? e}`));
    return { ok: true };
  }

  // Envio chamado pelo workflow "Bot Regem (Cloud)" no n8n para responder o cliente.
  // Autenticado pelo BOT_RESOLVER_SECRET (o mesmo do resolver do Evolution), com a
  // loja identificada pelo phoneNumberId que o próprio workflow recebeu.
  @Post('publico/bot/cloud/enviar')
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  enviarBot(
    @Body() dto: { secret?: string; phoneNumberId?: string; para?: string; texto?: string },
  ) {
    return this.service.enviarPeloBot(
      dto?.secret ?? '',
      dto?.phoneNumberId ?? '',
      dto?.para ?? '',
      dto?.texto ?? '',
    );
  }

  // Envio de MODELO pelo workflow de avisos (pedido confirmado, saiu para entrega).
  // Fora da janela de 24h a Meta so aceita modelo aprovado — texto livre e recusado.
  @Post('publico/bot/cloud/template')
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  enviarTemplateBot(
    @Body()
    dto: {
      secret?: string;
      phoneNumberId?: string;
      para?: string;
      template?: string;
      idioma?: string;
      params?: string[];
    },
  ) {
    return this.service.enviarTemplatePeloBot(
      dto?.secret ?? '',
      dto?.phoneNumberId ?? '',
      dto?.para ?? '',
      dto?.template ?? '',
      dto?.idioma ?? 'pt_BR',
      Array.isArray(dto?.params) ? dto.params : [],
    );
  }

  // Proxy de mídia: o workflow do n8n pede o arquivo aqui (com o secret do bot) em
  // vez de falar com a Meta. Assim ele transcreve áudio sem nunca receber o
  // WA_CLOUD_TOKEN, que é a credencial-mestre da conta.
  @Get('publico/bot/cloud/midia')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async midia(
    @Query('secret') secret: string,
    @Query('phoneNumberId') phoneNumberId: string,
    @Query('mediaId') mediaId: string,
    @Res({ passthrough: true }) res: any,
  ) {
    const { buffer, mime } = await this.service.baixarMidia(
      secret ?? '',
      phoneNumberId ?? '',
      mediaId ?? '',
    );
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    return new StreamableFile(buffer);
  }
}
