import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { TotemCtx, TotemCtxData, TotemTokenGuard } from './totem-token.guard';
import { TotemService } from './totem.service';
import { VendaTotemGogem } from './venda-gogem';

// R3b — venda do totem no servidor local. Caminho e corpo são os do contrato GoGeM
// (`POST /vendas`, `POST /vendas/falha`), então o app não muda ao apontar para o edge.
//
// O corpo entra como objeto cru de propósito: quem faz o recorte é o tradutor
// (`venda-gogem.ts`), que só lê campo conhecido — nada do corpo chega ao Regem sem
// passar por ele. Tenant e loja vêm SEMPRE do aparelho, nunca do corpo.
@Controller('vendas')
export class TotemVendasController {
  constructor(private readonly service: TotemService) {}

  @Post()
  @UseGuards(TotemTokenGuard)
  vender(@TotemCtx() ctx: TotemCtxData, @Body() dto: VendaTotemGogem) {
    return this.service.registrarVenda(ctx, dto ?? {});
  }

  // R4 — pedido RETIDO (cartão/PIX): entra no Regem ANTES do pagamento, sem ir para a
  // cozinha, e já devolve a senha que o totem imprime. Depois:
  //   • pagou     → POST /vendas/:id/liberar   (vira venda: comanda, caixa, produção)
  //   • desistiu  → POST /vendas/:id/cancelar  (fica registrado com o motivo)
  //   • sumiu     → o servidor encerra sozinho em 5 min
  @Post('retido')
  @UseGuards(TotemTokenGuard)
  abrirRetido(@TotemCtx() ctx: TotemCtxData, @Body() dto: any) {
    return this.service.abrirPedidoRetido(ctx, dto ?? {});
  }

  @Post(':id/liberar')
  @UseGuards(TotemTokenGuard)
  liberar(
    @TotemCtx() ctx: TotemCtxData,
    @Param('id') id: string,
    @Body() dto: VendaTotemGogem,
  ) {
    return this.service.liberarPedido(ctx, id, dto ?? {});
  }

  @Post(':id/cancelar')
  @UseGuards(TotemTokenGuard)
  cancelar(
    @TotemCtx() ctx: TotemCtxData,
    @Param('id') id: string,
    @Body() dto: { motivo?: string },
  ) {
    return this.service.cancelarPedido(ctx, id, dto?.motivo);
  }

  @Post('falha')
  @UseGuards(TotemTokenGuard)
  falha(@TotemCtx() ctx: TotemCtxData, @Body() dto: any) {
    return this.service.registrarFalha(ctx, dto ?? {});
  }
}
