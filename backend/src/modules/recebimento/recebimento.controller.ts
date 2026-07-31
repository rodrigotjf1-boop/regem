import {
  Body,
  Controller,
  Get,
  Param,
  Post,
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
import { RecebimentoService } from './recebimento.service';
import { CreateRecebimentoDto } from './dto/create-recebimento.dto';

@Controller('recebimentos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class RecebimentoController {
  constructor(private readonly service: RecebimentoService) {}

  @Get()
  @RequirePerm('estoque', 'ver')
  findAll(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.findAll(user.tenantId, atual);
  }

  @Get(':id')
  @RequirePerm('estoque', 'ver')
  findOne(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id, atual);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'criar')
  create(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Body() dto: CreateRecebimentoDto) {
    return this.service.create(user.tenantId, dto, atual);
  }

  @Post(':id/confirmar')
  @Roles('presidente', 'gerente')
  @RequirePerm('estoque', 'editar')
  confirmar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Param('id') id: string) {
    return this.service.confirmar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
      atual,
    );
  }
}
