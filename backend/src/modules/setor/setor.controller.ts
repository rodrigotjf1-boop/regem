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
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SetorService } from './setor.service';
import { CreateSetorDto } from './dto/create-setor.dto';

@Controller('setores')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('cadastros')
export class SetorController {
  constructor(private readonly service: SetorService) {}

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateSetorDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { nome?: string; icone?: string; cor?: string },
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
  ) {
    return this.service.findAll(user.tenantId, unidadeId);
  }
}
