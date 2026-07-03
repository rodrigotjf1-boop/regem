import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { VendasService } from './vendas.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';

// PDV — qualquer usuário autenticado (operador de balcão) pode vender.
@Controller('vendas')
@UseGuards(JwtAuthGuard)
export class VendasController {
  constructor(private readonly service: VendasService) {}

  @Post('balcao')
  balcao(@CurrentUser() user: AuthUser, @Body() dto: VendaBalcaoDto) {
    return this.service.vendaBalcao(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }
}
