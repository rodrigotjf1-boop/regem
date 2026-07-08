import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DiaEspecialService } from './dia-especial.service';
import { CreateDiaEspecialDto } from './dto/create-dia-especial.dto';

// Dias importantes (feriado/férias/evento) — leitura p/ qualquer autenticado
// (a escala precisa marcar os dias); criar/remover é gestão.
@Controller('dias-especiais')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DiaEspecialController {
  constructor(private readonly service: DiaEspecialService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.listar(user.tenantId, de, ate);
  }

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDiaEspecialDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remover(user.tenantId, id);
  }
}
