import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { EquipamentoService } from './equipamento.service';

// Pareamento do PC por CÓDIGO (mig 142). É público de propósito: o PC ainda não
// tem sessão nem credencial — é justamente isso que ele vem buscar. A proteção
// é o código ser de 6 dígitos, de uso único, expirar em 15 min e ter rate-limit
// apertado (10/min por IP), o que torna a tentativa por força bruta inviável.
@Controller('publico/terminal')
export class PareamentoController {
  constructor(private readonly service: EquipamentoService) {}

  @Post('parear')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  parear(@Body() dto: { codigo?: string }) {
    return this.service.parearPorCodigo(dto?.codigo ?? '');
  }
}
