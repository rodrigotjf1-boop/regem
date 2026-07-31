import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DesperdicioService } from './desperdicio.service';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';

@Controller('desperdicios')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class DesperdicioController {
  constructor(private readonly service: DesperdicioService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  @RequirePerm('estoque', 'criar')
  create(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateDesperdicioDto,
  ) {
    return this.service.create(user.tenantId, dto, atual);
  }

  @Get()
  @RequirePerm('estoque', 'ver')
  findAll(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.findAll(user, atual);
  }
}
