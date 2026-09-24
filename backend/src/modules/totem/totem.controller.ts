import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { TotemCtx, TotemCtxData, TotemTokenGuard } from './totem-token.guard';
import { TotemService } from './totem.service';

// R3 — rotas que o TOTEM GoGeM chama, servidas pelo servidor local.
//
// O caminho e o formato são os do contrato GoGeM de propósito: o app não muda ao apontar
// para o edge. Autenticação por `X-Device-Token` do aparelho (o guard só aceita tipo
// 'totem' e só no servidor local — na nuvem estas rotas respondem 401).
@Controller('catalogo')
export class TotemController {
  constructor(private readonly service: TotemService) {}

  @Get('publicado')
  @UseGuards(TotemTokenGuard)
  publicado(
    @TotemCtx() ctx: TotemCtxData,
    @Req() req: any,
    @Query('desde') desde?: string,
  ) {
    const n = desde == null || desde === '' ? undefined : Number(desde);
    // Base das fotos = o MESMO endereço por onde o totem chegou até aqui (IP/porta da
    // LAN). Assim a foto é buscada pelo caminho que já funciona, sem configurar host.
    const host = req.headers?.host;
    const base = host
      ? `${req.protocol ?? 'http'}://${host}/api/v1/publico/midia`
      : undefined;
    return this.service.catalogoPublicado(
      ctx.tenantId,
      ctx.unidadeId,
      Number.isFinite(n) ? (n as number) : undefined,
      base,
    );
  }
}
