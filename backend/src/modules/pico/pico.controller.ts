import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PicoService } from './pico.service';
import { CreateJanelaPicoDto } from './dto/create-janela-pico.dto';

@Controller('janelas-pico')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class PicoController {
  constructor(private readonly service: PicoService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.findAll(user.tenantId, unidadeId || undefined);
  }

  @Post()
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJanelaPicoDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    dto: {
      nome?: string;
      diaSemana?: number | null;
      horaInicio?: string;
      horaFim?: string;
    },
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
