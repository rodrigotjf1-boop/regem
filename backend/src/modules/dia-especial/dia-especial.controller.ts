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
import { DiaEspecialService } from './dia-especial.service';
import { CreateDiaEspecialDto } from './dto/create-dia-especial.dto';

// Dias importantes (feriado/férias/evento) — leitura p/ qualquer autenticado
// (a escala precisa marcar os dias); criar/remover é gestão.
@Controller('dias-especiais')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class DiaEspecialController {
  constructor(private readonly service: DiaEspecialService) {}

  @Get()
  @RequirePerm('escalas', 'ver')
  listar(
    @CurrentUser() user: AuthUser,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.listar(user.tenantId, de, ate);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('escalas', 'criar')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDiaEspecialDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('escalas', 'editar')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateDiaEspecialDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('escalas', 'excluir')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remover(user.tenantId, id);
  }
}
