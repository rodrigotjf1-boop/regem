import { Controller, Get, HttpCode, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { Escopos, IntegracaoCtx, IntegracaoCtxData, IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaFilter } from './problema';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { PaginaClientesAnonimizadosIntegracao, PaginaVendasIntegracao } from './dto/vendas-integracao.dto';

// API DE INTEGRAÇÃO (trilha C) — `/api/v1/integracao/*`, SÓ NUVEM. Autentica pelo token POR
// LOJA (`Authorization: Bearer rgm_it_…`); a empresa e a loja vêm SEMPRE do token (não existe
// parâmetro de loja). Erros em `application/problem+json` (RFC 9457). As rotas de cupons (C1c,
// PR3) entram no próximo PR, com o `@Escopos(...)` de cada uma.
@ApiTags('Integração (token por loja)')
@ApiBearerAuth()
@Controller('integracao')
@CloudOnly()
@UseGuards(IntegracaoTokenGuard)
@UseFilters(ProblemaFilter)
export class IntegracaoApiController {
  constructor(
    private readonly tokens: IntegracaoTokenService,
    private readonly vendas: VendasIntegracaoService,
  ) {}

  // Quem é a loja do token — qualquer escopo.
  @Get('loja')
  @ApiOperation({ summary: 'Loja do token: nome, fuso, moeda, escopos concedidos e o cardápio online.' })
  loja(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.dadosDaLoja(ctx);
  }

  // A integração desliga o próprio token (o Liame chama ao desconectar). Depois disso, toda
  // chamada com ele — inclusive repetir esta — volta 401, que é o sinal de "desconectada".
  @Post('autorizacao/revogar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga o próprio token (a chamada seguinte já volta 401).' })
  revogar(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.revogarPelaIntegracao(ctx);
  }

  // Vendas da loja (confirmadas, canceladas depois de confirmadas e removidas), com cursor.
  @Get('pedidos')
  @Escopos('pedidos.ler')
  @ApiOperation({
    summary: 'Vendas da loja com cursor (ordem por atualizado_em, id; só o carimbado há mais de 15 s).',
    description:
      'Receita = "Faturamento" do Painel ao centavo (pedido: criação; comanda: fechamento — `faturado_em`). ' +
      'Cliente só com clientes.telefone.ler (marketplace: sempre null); custo por item só com custos.ler e ' +
      'se quem autorizou ainda vê valores em R$.',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'O `proximo_cursor` da página anterior.' })
  @ApiQuery({ name: 'limite', required: false, description: 'Itens por página: 1 a 500 (padrão 200).' })
  @ApiQuery({
    name: 'confirmados_desde',
    required: false,
    description: 'Instante ISO 8601 com fuso — só na primeira página da carga inicial; depois segue dentro do cursor.',
  })
  @ApiOkResponse({ type: PaginaVendasIntegracao })
  pedidos(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
    @Query('confirmados_desde') confirmadosDesde?: string,
  ) {
    return this.vendas.pedidos(ctx, { cursor, limite, confirmados_desde: confirmadosDesde });
  }

  // Avisos de cliente anonimizado (o "esquecer" da LGPD): o Liame apaga o cliente dele em 1 dia.
  @Get('clientes/anonimizados')
  @Escopos('clientes.anonimizacao.ler')
  @ApiOperation({ summary: 'Clientes anonimizados (excluídos) da empresa, com cursor — só o id.' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limite', required: false, description: '1 a 500 (padrão 200).' })
  @ApiOkResponse({ type: PaginaClientesAnonimizadosIntegracao })
  clientesAnonimizados(
    @IntegracaoCtx() ctx: IntegracaoCtxData,
    @Query('cursor') cursor?: string,
    @Query('limite') limite?: string,
  ) {
    return this.vendas.clientesAnonimizados(ctx, { cursor, limite });
  }
}
