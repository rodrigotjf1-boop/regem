import { Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_ASSINATURA_EVOLUTION, assinaturaDaInstanciaOk } from '../../common/segredo-robo';
import { EvolutionEntradaService } from './evolution-entrada.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Webhook da EVOLUTION passando pelo Regem (Fase 2 do robô; só com EVOLUTION_PELO_REGEM — o "Reconectar" aponta a
// instância para cá). A assinatura da instância vai no cabeçalho `x-regem-evolution` (configurado ao conectar);
// sem ela, 401. Responde 200 antes de processar: a Evolution reenvia quem demora. Só na nuvem.
@Controller('publico/whatsapp/evolution')
@CloudOnly()
export class EvolutionEntradaController {
  constructor(private readonly service: EvolutionEntradaService) {}

  @Post('webhook')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  webhook(@Body() corpo: any, @Headers(CABECALHO_ASSINATURA_EVOLUTION) assinatura?: string) {
    const instancia = String(corpo?.instance ?? '').trim();
    if (!instancia || !assinaturaDaInstanciaOk(instancia, assinatura)) throw new UnauthorizedException('Assinatura inválida.');
    void this.service.processar(corpo, instancia);
    return { ok: true };
  }
}
