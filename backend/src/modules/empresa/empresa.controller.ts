import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EmpresaService } from './empresa.service';
import { AtualizarConfigEmpresaDto } from './dto/atualizar-config-empresa.dto';

// Empresa é criada só via /auth/register. Aqui leitura da PRÓPRIA empresa + config.
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

  // Config da empresa — só presidente (ex.: janela de espelho do servidor local).
  @Patch('config')
  @Roles('presidente')
  atualizarConfig(
    @CurrentUser() user: AuthUser,
    @Body() dto: AtualizarConfigEmpresaDto,
  ) {
    return this.service.atualizarConfig(user.tenantId, dto);
  }
}
