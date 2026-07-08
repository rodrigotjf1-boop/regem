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
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ContagemService } from './contagem.service';
import { CreateContagemListaDto } from './dto/create-contagem-lista.dto';

// Contagem de estoque — listar/iniciar/salvar = qualquer autenticado (o
// executor pode ser o colaborador delegado); criar/remover lista = gestão.
@Controller('contagem')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ContagemController {
  constructor(private readonly service: ContagemService) {}

  @Get('listas')
  listListas(@CurrentUser() user: AuthUser) {
    return this.service.listListas(user.tenantId);
  }

  @Post('listas')
  @Roles('presidente', 'gerente', 'supervisao')
  createLista(@CurrentUser() user: AuthUser, @Body() dto: CreateContagemListaDto) {
    return this.service.createLista(user.tenantId, dto);
  }

  @Delete('listas/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  removerLista(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerLista(user.tenantId, id);
  }

  @Post('listas/:id/iniciar')
  iniciar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.iniciarExecucao(user.tenantId, id, user.colaboradorId);
  }

  @Get('execucoes/:id')
  execucao(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getExecucao(user.tenantId, id);
  }

  @Post('execucoes/:id/salvar')
  salvar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.salvarContagem(user.tenantId, id, user.colaboradorId, dto);
  }
}
