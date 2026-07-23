import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EtiquetaValidadeService } from './etiqueta-validade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTAO = ['presidente', 'gerente', 'supervisao'];

@Controller('etiquetas-validade')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...GESTAO)
export class EtiquetaValidadeController {
  constructor(private readonly service: EtiquetaValidadeService) {}

  @Get('template')
  template(@CurrentUser() user: AuthUser) {
    return this.service.getTemplate(user.tenantId);
  }

  @Put('template')
  salvarTemplate(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarTemplate(user.tenantId, dto);
  }

  @Get('fontes')
  fontes(@CurrentUser() user: AuthUser) {
    return this.service.fontes(user.tenantId);
  }

  @Get()
  listar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listar(user.tenantId, atual);
  }

  @Post()
  criar(@CurrentUser() user: AuthUser, @Body() dto: any, @UnidadeAtual() atual: string | null) {
    return this.service.criar(user.tenantId, user.colaboradorId, dto, atual);
  }

  // Leitura do código (baixa por uso).
  @Post('ler')
  ler(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.lerCodigo(user.tenantId, user.colaboradorId, dto?.codigo);
  }

  @Post(':id/finalizar')
  finalizar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.finalizar(user.tenantId, user.colaboradorId, id);
  }

  @Post(':id/perda')
  perda(@CurrentUser() user: AuthUser, @Param('id') id: string, @UnidadeAtual() atual: string | null) {
    return this.service.perda(user.tenantId, user.colaboradorId, id, atual);
  }
}
