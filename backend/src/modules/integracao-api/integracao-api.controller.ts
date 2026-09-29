import { Controller, Get, HttpCode, Post, UseFilters, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { IntegracaoCtx, IntegracaoCtxData, IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaFilter } from './problema';

// API DE INTEGRAÇÃO (trilha C) — `/api/v1/integracao/*`, SÓ NUVEM. Autentica pelo token POR
// LOJA (`Authorization: Bearer rgm_it_…`); a empresa e a loja vêm SEMPRE do token (não existe
// parâmetro de loja). Erros em `application/problem+json` (RFC 9457). As rotas de vendas e de
// cupons (C1c) entram nos próximos PRs, com o `@Escopos(...)` de cada uma.
@Controller('integracao')
@CloudOnly()
@UseGuards(IntegracaoTokenGuard)
@UseFilters(ProblemaFilter)
export class IntegracaoApiController {
  constructor(private readonly tokens: IntegracaoTokenService) {}

  // Quem é a loja do token — qualquer escopo.
  @Get('loja')
  loja(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.dadosDaLoja(ctx);
  }

  // A integração desliga o próprio token (o Liame chama ao desconectar). Depois disso, toda
  // chamada com ele — inclusive repetir esta — volta 401, que é o sinal de "desconectada".
  @Post('autorizacao/revogar')
  @HttpCode(200)
  revogar(@IntegracaoCtx() ctx: IntegracaoCtxData) {
    return this.tokens.revogarPelaIntegracao(ctx);
  }
}
