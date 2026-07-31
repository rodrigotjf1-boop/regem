import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DiretoriaService } from './diretoria.service';

@Controller('diretoria')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('visao_co')
export class DiretoriaController {
  constructor(private readonly service: DiretoriaService) {}

  @Get('multiunidade')
  @Roles('presidente')
  multiunidade(@CurrentUser() user: AuthUser) {
    return this.service.multiunidade(user.tenantId);
  }
}
