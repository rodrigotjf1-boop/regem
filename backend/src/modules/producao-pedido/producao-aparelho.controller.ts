import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ProducaoPedidoService } from './producao-pedido.service';
import { AparelhoKds, KdsAparelhoGuard, type KdsAparelhoCtx } from './kds-aparelho.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

const CANAIS = new Set(['balcao', 'delivery', 'todos']);

// O KDS FÍSICO pelo token do aparelho (TV box, tela da cozinha — 16/11/2026): as três coisas que a tela da cozinha faz —
// ler a fila, avançar o cartão e o "Visto" do pedido alterado —, com a empresa, a loja e o KDS tirados do APARELHO (nunca
// da query nem do corpo). As mesmas regras das rotas de quem está logado (`ProducaoPedidoController`): o mesmo serviço, o
// `de` que impede o toque duplo de pular etapa, o "vai para" e o KDS de entrega pelo cadastro do aparelho.
@Controller('producao/aparelho')
@UseGuards(KdsAparelhoGuard)
export class ProducaoAparelhoController {
  constructor(private readonly service: ProducaoPedidoService) {}

  @Get('fila')
  fila(@AparelhoKds() kds: KdsAparelhoCtx, @Query('canal') canal?: string) {
    return this.service.filaKds(kds.tenantId, {
      unidadeId: kds.unidadeId ?? undefined,
      canal: canal && CANAIS.has(canal) ? canal : undefined,
      equipamentoId: kds.equipamentoId,
    });
  }

  @Post('pedidos/:id/avancar')
  async avancar(@AparelhoKds() kds: KdsAparelhoCtx, @Param('id', new ParseUUIDPipe()) id: string, @Body() dto: any) {
    await this.service.conferirCartaoDaLoja(kds.tenantId, id, kds.unidadeId);
    const de = typeof dto?.de === 'string' ? dto.de : undefined;
    return this.service.avancar(kds.tenantId, kds.equipamentoId, id, undefined, kds.equipamentoId, de);
  }

  @Post('pedidos/:id/visto')
  async visto(@AparelhoKds() kds: KdsAparelhoCtx, @Param('id', new ParseUUIDPipe()) id: string) {
    await this.service.conferirCartaoDaLoja(kds.tenantId, id, kds.unidadeId);
    return this.service.marcarVisto(kds.tenantId, id, { nome: kds.nome });
  }
}
