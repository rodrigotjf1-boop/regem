import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ProducaoService } from './producao.service';
import { ProduzirDto } from './dto/produzir.dto';

@Controller('producao')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('producao_kds')
export class ProducaoController {
  constructor(private readonly service: ProducaoService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  produzir(@CurrentUser() user: AuthUser, @Body() dto: ProduzirDto) {
    return this.service.produzir(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }
}
