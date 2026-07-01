import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { OcorrenciaService } from './ocorrencia.service';
import { CreateTipoOcorrenciaDto } from './dto/create-tipo.dto';
import { CreateOcorrenciaDto } from './dto/create-ocorrencia.dto';

@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
export class OcorrenciaController {
  constructor(private readonly service: OcorrenciaService) {}

  @Post('tipos-ocorrencia')
  @Roles('presidente', 'gerente')
  createTipo(@CurrentUser() user: AuthUser, @Body() dto: CreateTipoOcorrenciaDto) {
    return this.service.createTipo(user.tenantId, dto);
  }

  @Get('tipos-ocorrencia')
  @Roles('presidente', 'gerente', 'supervisao')
  listTipos(@CurrentUser() user: AuthUser) {
    return this.service.listTipos(user.tenantId);
  }

  @Post('ocorrencias')
  @Roles('presidente', 'gerente', 'supervisao')
  createOcorrencia(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateOcorrenciaDto,
  ) {
    return this.service.createOcorrencia(user.tenantId, user.colaboradorId, dto);
  }

  @Patch('ocorrencias/:id/anular')
  @Roles('presidente', 'gerente')
  anular(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.anular(user.tenantId, id);
  }

  // Ranking/pontuação: exclusivo do Presidente/C&O (opacidade).
  @Get('ocorrencias/ranking')
  @Roles('presidente')
  ranking(@CurrentUser() user: AuthUser) {
    return this.service.ranking(user.tenantId);
  }
}
