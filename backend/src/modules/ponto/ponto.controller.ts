import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PontoService } from './ponto.service';
import { MarcarPontoDto } from './dto/marcar-ponto.dto';

const GESTOR = ['presidente', 'gerente', 'supervisao'];
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

@Controller('ponto')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PontoController {
  constructor(private readonly service: PontoService) {}

  // Qualquer autenticado bate o próprio ponto; gestor/terminal pode informar colaboradorId.
  @Post('marcar')
  marcar(@CurrentUser() user: AuthUser, @Body() dto: MarcarPontoDto) {
    const gestor = GESTOR.includes(user.categoria);
    if (dto.colaboradorId && dto.colaboradorId !== user.colaboradorId && !gestor) {
      throw new ForbiddenException('Sem permissão para marcar por outro colaborador');
    }
    return this.service.marcar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
      'web',
    );
  }

  @Get('dia')
  dia(
    @CurrentUser() user: AuthUser,
    @Query('data') data?: string,
    @Query('colaboradorId') colaboradorId?: string,
  ) {
    const gestor = GESTOR.includes(user.categoria);
    const alvo = colaboradorId && gestor ? colaboradorId : user.colaboradorId;
    return this.service.listarDia(user.tenantId, data ?? hojeISO(), alvo);
  }

  @Get('espelho')
  espelho(
    @CurrentUser() user: AuthUser,
    @Query('colaboradorId') colaboradorId?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const alvo = colaboradorId || user.colaboradorId;
    const gestor = GESTOR.includes(user.categoria);
    if (alvo !== user.colaboradorId && !gestor) {
      throw new ForbiddenException('Sem permissão para ver o espelho de outro');
    }
    const ini = inicio ?? hojeISO();
    const f = fim ?? hojeISO();
    return this.service.espelho(user.tenantId, alvo, ini, f);
  }

  @Get('pessoas')
  @Roles('presidente', 'gerente', 'supervisao')
  pessoas(@CurrentUser() user: AuthUser, @Query('data') data?: string) {
    return this.service.pessoas(user.tenantId, data ?? hojeISO());
  }
}
