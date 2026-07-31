import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { LoteService } from './lote.service';

@Controller('lotes')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('estoque', 'ver')
export class LoteController {
  constructor(private readonly service: LoteService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }
}
