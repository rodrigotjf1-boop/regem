import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EmpresaService } from './empresa.service';

// Empresa é criada só via /auth/register. Aqui apenas leitura da PRÓPRIA empresa.
@Controller('empresas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('loja')
export class EmpresaController {
  constructor(private readonly service: EmpresaService) {}

  // Retorna somente a empresa do token (nunca lista todas).
  @Get()
  minha(@CurrentUser() user: AuthUser) {
    return this.service.findOne(user.tenantId);
  }
}
