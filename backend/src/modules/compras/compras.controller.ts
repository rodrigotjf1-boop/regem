import {
  Body,
  Controller,
  Delete,
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
import { AuthUser } from '../../auth/auth-user';
import { ComprasService } from './compras.service';
import { CreateCompraListaDto } from './dto/create-compra-lista.dto';

// Lista de compras — listar/receber = autenticado (o delegado pode receber);
// criar/remover = gestão.
@Controller('compras')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  @Get('listas')
  @RequirePerm('estoque', 'ver')
  listListas(@CurrentUser() user: AuthUser) {
    return this.service.listListas(user.tenantId);
  }

  @Get('sugestao')
  @RequirePerm('estoque', 'ver')
  sugerir(@CurrentUser() user: AuthUser) {
    return this.service.sugerir(user.tenantId);
  }

  @Get('listas/:id')
  @RequirePerm('estoque', 'ver')
  getLista(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getLista(user.tenantId, id);
  }

  @Post('listas')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'criar')
  createLista(@CurrentUser() user: AuthUser, @Body() dto: CreateCompraListaDto) {
    return this.service.createLista(user.tenantId, dto);
  }

  @Delete('listas/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'excluir')
  removerLista(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerLista(user.tenantId, id);
  }

  @Post('listas/:id/receber')
  @RequirePerm('estoque', 'editar')
  receber(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.receber(user.tenantId, id);
  }
}
