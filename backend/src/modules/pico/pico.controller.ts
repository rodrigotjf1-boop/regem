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
import { PicoService } from './pico.service';
import { CreateJanelaPicoDto } from './dto/create-janela-pico.dto';

@Controller('janelas-pico')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PicoController {
  constructor(private readonly service: PicoService) {}

  @Get()
  findAll(
    @CurrentUser() user: AuthUser,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.findAll(user.tenantId, unidadeId || undefined);
  }

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJanelaPicoDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
