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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ModuloService } from './modulo.service';
import { CloudOnly } from '../../common/cloud-only.decorator';

@Controller('modulos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class ModuloController {
  constructor(private readonly service: ModuloService) {}

  // Estado dos toggles (rede + por loja) — só presidente/C&O gerencia.
  @Get()
  @Roles('presidente')
  @RequirePerm('visao_co')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.estado(user.tenantId);
  }

  // Estado resolvido para a unidade do usuário — qualquer autenticado (apps checam).
  @Get('meus')
  meus(@CurrentUser() user: AuthUser) {
    return this.service.meus(user);
  }

  // Ligar/desligar módulo é só da NUVEM (fase 3B): `modulo_ativacao` só desce — se a loja gravasse, a escolha ficaria
  // só nela (e, se subisse, reativaria o que a nuvem desligou). No servidor da loja a tela fica só leitura; aqui, 404.
  @Post()
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  setar(
    @CurrentUser() user: AuthUser,
    @Body() dto: { unidadeId?: string | null; modulo: string; ativo: boolean },
  ) {
    return this.service.setar(user, dto);
  }
}
