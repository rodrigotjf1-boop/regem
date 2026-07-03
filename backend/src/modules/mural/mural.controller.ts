import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { MuralService } from './mural.service';
import { CreateComunicadoDto } from './dto/create-comunicado.dto';
import { CreatePesquisaDto } from './dto/create-pesquisa.dto';
import { ResponderClimaDto } from './dto/responder-clima.dto';

@Controller('mural')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MuralController {
  constructor(private readonly service: MuralService) {}

  // ── Mural ──────────────────────────────────────────────────────────────────
  @Get()
  feed(@CurrentUser() user: AuthUser) {
    return this.service.feed(user);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  publicar(@CurrentUser() user: AuthUser, @Body() dto: CreateComunicadoDto) {
    return this.service.publicar(user, dto);
  }

  @Post(':id/leitura')
  confirmarLeitura(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.confirmarLeitura(user, id);
  }

  // ── Clima (anônimo) ──────────────────────────────────────────────────────────
  @Get('clima')
  climaAtual(@CurrentUser() user: AuthUser) {
    return this.service.climaAtual(user);
  }

  @Post('clima')
  @Roles('presidente', 'gerente', 'supervisao')
  criarPesquisa(@CurrentUser() user: AuthUser, @Body() dto: CreatePesquisaDto) {
    return this.service.criarPesquisa(user, dto);
  }

  @Post('clima/:id/responder')
  responder(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ResponderClimaDto,
  ) {
    return this.service.responder(user, id, dto);
  }
}
