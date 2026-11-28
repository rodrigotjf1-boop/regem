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
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PicoService } from './pico.service';
import { CreateJanelaPicoDto } from './dto/create-janela-pico.dto';

/** ERR-646: a loja de quem pede — o presidente, null (todas; escolhe no corpo ou na consulta); os outros, a sua. */
const lojaDe = (user: AuthUser, atual: string | null) => (user.categoria === 'presidente' ? null : atual);

@Controller('janelas-pico')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class PicoController {
  constructor(private readonly service: PicoService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    // ERR-646 (rodada 7, MIS-B-01): a consulta escolhia qualquer loja da empresa (e sem ela, todas) para qualquer pessoa.
    return this.service.findAll(user.tenantId, (user.categoria === 'presidente' ? unidadeId || atual : atual) || undefined);
  }

  @Post()
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  create(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Body() dto: CreateJanelaPicoDto) {
    return this.service.create(user.tenantId, dto, lojaDe(user, atual));
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  update(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
    @Body()
    dto: {
      nome?: string;
      diaSemana?: number | null;
      horaInicio?: string;
      horaFim?: string;
    },
  ) {
    return this.service.update(user.tenantId, id, dto, lojaDe(user, atual));
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('cadastros')
  remove(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id, lojaDe(user, atual));
  }
}
