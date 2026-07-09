import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ModuloService } from './modulo.service';

@Controller('modulos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ModuloController {
  constructor(private readonly service: ModuloService) {}

  // Estado dos toggles (rede + por loja) — só presidente/C&O gerencia.
  @Get()
  @Roles('presidente')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.estado(user.tenantId);
  }

  // Estado resolvido para a unidade do usuário — qualquer autenticado (apps checam).
  @Get('meus')
  meus(@CurrentUser() user: AuthUser) {
    return this.service.meus(user);
  }

  @Post()
  @Roles('presidente')
  setar(
    @CurrentUser() user: AuthUser,
    @Body() dto: { unidadeId?: string | null; modulo: string; ativo: boolean },
  ) {
    return this.service.setar(user, dto);
  }
}
