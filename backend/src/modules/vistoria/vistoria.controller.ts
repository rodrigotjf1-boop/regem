import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { VistoriaService } from './vistoria.service';
import { CreateVistoriaDto } from './dto/create-vistoria.dto';

@Controller('vistorias')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('vistoria')
export class VistoriaController {
  constructor(private readonly service: VistoriaService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  create(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateVistoriaDto,
  ) {
    return this.service.create(user.tenantId, dto, atual);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.findAll(user.tenantId, atual);
  }
}
