import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PerfilService } from './perfil.service';
import type { Permissoes } from '../../auth/permissoes';

// Perfis de acesso — só o presidente/C&O configura os perfis e suas permissões.
@Controller('perfis')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente')
export class PerfilController {
  constructor(private readonly service: PerfilService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  // Catálogo de permissões (estático) — o editor usa para renderizar tudo.
  @Get('catalogo')
  catalogo() {
    return this.service.catalogo();
  }

  @Post()
  criar(
    @CurrentUser() user: AuthUser,
    @Body() dto: { nome?: string; nivel?: string; loginWeb?: boolean; permissoes?: Permissoes },
  ) {
    return this.service.criar(user, dto);
  }

  @Delete(':id')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remover(user, id);
  }

  @Patch(':id')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { loginWeb?: boolean; permissoes?: Permissoes },
  ) {
    return this.service.atualizar(user, id, dto);
  }
}
