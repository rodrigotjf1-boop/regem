import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EventosCardapioService } from './eventos-cardapio.service';

// Eventos sazonais do cardápio (Delivery → Configurações → Eventos). Quem tem a permissão da loja
// VÊ a agenda; só o presidente LIGA, desliga e personaliza um evento — é ele quem decide quando o
// cardápio muda de cara.
@Controller('cardapio/eventos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class EventosCardapioController {
  constructor(private readonly service: EventosCardapioService) {}

  @Get()
  @RequirePerm('loja')
  obter(@CurrentUser() user: AuthUser) {
    return this.service.obter(user.tenantId, user.categoria);
  }

  @Put()
  @Roles('presidente')
  @RequirePerm('loja')
  salvar(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.service.salvar(user, dto);
  }
}
