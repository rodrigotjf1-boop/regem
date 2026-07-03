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
import { EquipamentoService } from './equipamento.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';

// Gestão de equipamentos (KDS / Terminal de Ponto) — só presidente/gerente.
@Controller('equipamento')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EquipamentoController {
  constructor(private readonly service: EquipamentoService) {}

  @Get()
  @Roles('presidente', 'gerente')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post()
  @Roles('presidente', 'gerente')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateEquipamentoDto) {
    return this.service.criar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }

  @Patch(':id/revogar')
  @Roles('presidente', 'gerente')
  revogar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revogar(
      user.tenantId,
      id,
      user.colaboradorId,
      user.categoria,
    );
  }
}
