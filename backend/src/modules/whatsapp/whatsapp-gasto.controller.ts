import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { WhatsappGastoService } from './whatsapp-gasto.service';

// WHATSAPP › USO E GASTO (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado em 18/11/2026; mig 445). O gasto
// que a Meta cobra da empresa, do que a rotina da nuvem guardou. SÓ O PRESIDENTE (decisão 2: é dinheiro da empresa, no
// cartão dela) e só na nuvem (quem lê a Meta é ela).
@Controller('whatsapp/gasto')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsappGastoController {
  constructor(private readonly gasto: WhatsappGastoService) {}

  /** O resumo do período: `periodo` = mes | passado | tres | outro (com `de` e `ate`); `numero` filtra um número. */
  @Get()
  @CloudOnly()
  @Roles('presidente')
  resumo(
    @CurrentUser() user: AuthUser,
    @Query('periodo') periodo?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('numero') numero?: string,
  ) {
    return this.gasto.resumo(user.tenantId, { periodo, de, ate, numero });
  }

  /** "Tentar de novo": lê a Meta agora (não antes de 2 minutos da última tentativa) e devolve o resumo. */
  @Post('ler')
  @CloudOnly()
  @Roles('presidente')
  lerAgora(
    @CurrentUser() user: AuthUser,
    @Query('periodo') periodo?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('numero') numero?: string,
  ) {
    return this.gasto.lerAgora(user.tenantId, { periodo, de, ate, numero });
  }
}
