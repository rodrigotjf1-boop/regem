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
import { podeAcessar } from '../../auth/permissoes';
import { FichasService } from './fichas.service';
import { fichaSemCusto } from './ficha-sem-custo';
import { CreateFichaDto } from './dto/create-ficha.dto';
import { UpdateFichaDto } from './dto/update-ficha.dto';
import { CreateIngredienteDto } from './dto/create-ingrediente.dto';

@Controller('fichas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class FichasController {
  constructor(private readonly service: FichasService) {}

  // A LEITURA das fichas é aberta a quem está logado: as telas de produto e de ordem de produção
  // escolhem a ficha por esta lista. O CUSTO, não: só vai para quem tem a permissão "Fichas
  // técnicas" (decisão do dono, 07/10/2026) — a mesma regra do `PermissoesGuard`, presidente
  // incluído. Para os outros o custo é cortado aqui, no servidor.
  private veCusto(user: AuthUser) {
    return user.categoria === 'presidente' || podeAcessar(user.permissoes, 'fichas');
  }

  @Get()
  async list(@CurrentUser() user: AuthUser) {
    const fichas = await this.service.list(user.tenantId);
    return this.veCusto(user) ? fichas : fichas.map(fichaSemCusto);
  }

  @Get(':id')
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const ficha = await this.service.getOne(user.tenantId, id);
    return this.veCusto(user) ? ficha : fichaSemCusto(ficha);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('fichas')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFichaDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('fichas')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateFichaDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('fichas')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(':id/ingredientes')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('fichas')
  addIngrediente(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateIngredienteDto,
  ) {
    return this.service.addIngrediente(user.tenantId, id, dto);
  }

  @Delete('ingredientes/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('fichas')
  removeIngrediente(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removeIngrediente(user.tenantId, id);
  }
}
