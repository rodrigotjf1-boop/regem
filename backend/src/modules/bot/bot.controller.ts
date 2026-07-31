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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { BotService } from './bot.service';
import { CreateRegraDto } from './dto/create-regra.dto';
import { UpdateRegraDto } from './dto/update-regra.dto';
import { PerguntarDto } from './dto/perguntar.dto';
import { CloudOnly } from '../../common/cloud-only.decorator';

@Controller('bot')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class BotController {
  constructor(private readonly service: BotService) {}

  @Get('regras')
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listarRegras(user.tenantId);
  }

  // Editar regras: só Proprietário / C&O (per mockup).
  @Post('regras')
  @Roles('presidente')
  @RequirePerm('bot')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateRegraDto) {
    return this.service.criarRegra(user.tenantId, dto);
  }

  @Patch('regras/:id')
  @Roles('presidente')
  @RequirePerm('bot')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateRegraDto,
  ) {
    return this.service.atualizarRegra(user.tenantId, id, dto);
  }

  @Delete('regras/:id')
  @Roles('presidente')
  @RequirePerm('bot')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerRegra(user.tenantId, id);
  }

  @Get('metricas')
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  metricas(@CurrentUser() user: AuthUser) {
    return this.service.metricas(user.tenantId);
  }

  // Perguntar/testar: qualquer autenticado.
  @Post('perguntar')
  perguntar(@CurrentUser() user: AuthUser, @Body() dto: PerguntarDto) {
    return this.service.perguntar(user, dto);
  }
}
