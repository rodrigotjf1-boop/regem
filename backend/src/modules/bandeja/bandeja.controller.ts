import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { BandejaGuard } from './bandeja.guard';
import { BandejaService } from './bandeja.service';

// O ícone do servidor da loja (`RegemServidor.exe`) lê e age por aqui — só no próprio servidor e com a chave dele
// (`BandejaGuard`). Ver `bandeja.service.ts`.
@Controller('edge/bandeja')
@UseGuards(BandejaGuard)
export class BandejaController {
  constructor(private readonly service: BandejaService) {}

  // O ícone relê a cada 5 s: fora do limite de chamadas (é o próprio computador).
  @Get('estado')
  @SkipThrottle()
  estado() {
    return this.service.estado();
  }

  @Post('equipamento/:id/codigo')
  @HttpCode(200)
  gerarCodigo(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: { maquina?: unknown; usuario?: unknown }) {
    return this.service.agir('codigo', id, dto ?? {});
  }

  @Post('equipamento/:id/revogar')
  @HttpCode(200)
  revogar(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: { maquina?: unknown; usuario?: unknown }) {
    return this.service.agir('revogar', id, dto ?? {});
  }

  @Post('equipamento/:id/reativar')
  @HttpCode(200)
  reativar(@Param('id', new ParseUUIDPipe()) id: string, @Body() dto: { maquina?: unknown; usuario?: unknown }) {
    return this.service.agir('reativar', id, dto ?? {});
  }
}
