import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// QR do entregador (Fase 4) — PÚBLICO (sem login): o entregador escaneia o QR do
// cupom, abre esta página pelo token e confirma a saída. Token curto + throttle.
@Controller('publico/despacho')
export class DespachoPublicoController {
  constructor(private readonly service: DeliveryService) {}

  @Get(':token')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  info(@Param('token') token: string) {
    return this.service.despachoInfo(token);
  }

  @Post(':token')
  @Throttle({ default: { ttl: 60000, limit: 15 } })
  confirmar(@Param('token') token: string, @Body() dto: any) {
    return this.service.despachoConfirmar(token, {
      entregadorId: dto?.entregadorId ?? undefined,
      entregadorNome: dto?.entregadorNome ?? undefined,
    });
  }
}
