import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { periodoDaConsulta } from '../../common/periodo';
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
    return this.service.create(user.tenantId, dto, atual, user.colaboradorId);
  }

  // `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` limita pela data da vistoria; sem eles, tudo.
  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.findAll(user.tenantId, atual, periodoDaConsulta(inicio, fim));
  }
}
