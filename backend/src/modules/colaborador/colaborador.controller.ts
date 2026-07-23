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
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ColaboradorService } from './colaborador.service';
import { CreateColaboradorDto } from './dto/create-colaborador.dto';

@Controller('colaboradores')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ColaboradorController {
  constructor(private readonly service: ColaboradorService) {}

  @Post()
  @Roles('presidente', 'gerente')
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateColaboradorDto,
    @UnidadeAtual() unidadeId: string | null,
  ) {
    return this.service.create(user.tenantId, dto, user.categoria, unidadeId);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
  ) {
    return this.service.findAll(user.tenantId, unidadeId);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateColaboradorDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  // Reset de senha pelo gestor (recuperação sem e-mail).
  @Post(':id/senha')
  @Roles('presidente', 'gerente')
  definirSenha(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { email?: string; senha: string },
  ) {
    return this.service.definirSenha(user, id, dto);
  }

  // Acesso ao sistema (presidente/C&O): associa perfil, libera app, bloqueia/ativa.
  @Patch(':id/acesso')
  @Roles('presidente')
  atualizarAcesso(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { perfilAcessoId?: string; appHabilitado?: boolean; status?: string },
  ) {
    return this.service.atualizarAcesso(user, id, dto);
  }
}
