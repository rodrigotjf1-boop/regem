import { Controller, Get, Param } from '@nestjs/common';
import { EntregadorService } from './entregador.service';

// Rastreio PÚBLICO do cliente (sem login) — só pelo token do link enviado no WhatsApp.
// Sem @UseGuards(JwtAuthGuard) → rota aberta, igual ao padrão do cardápio público.
@Controller('rastreio')
export class RastreioController {
  constructor(private readonly service: EntregadorService) {}

  @Get(':token')
  rastreio(@Param('token') token: string) {
    return this.service.rastreioPublico(token);
  }
}
