import { Controller, Delete, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterAprendizadoService } from './mister-aprendizado.service';

// A PARTE "O QUE APRENDI" DO MISTER NA LOJA (versão 10, fase C7, mig 508; protótipo `mockups/regem-mister-v10.html`, "Na loja"):
// as tarefas que a empresa confirmou e viraram exemplo. Só o presidente, só na nuvem e só com o módulo ligado.
@Controller('mister/aprendizados')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterAprendizadoController {
  constructor(private readonly aprendizado: MisterAprendizadoService) {}

  @Get()
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  listar(@CurrentUser() user: AuthUser) {
    return this.aprendizado.listar(user);
  }

  @Delete(':id')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  esquecer(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.aprendizado.esquecer(user, id);
  }
}
