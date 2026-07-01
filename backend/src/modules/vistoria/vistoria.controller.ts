import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { VistoriaService } from './vistoria.service';
import { CreateVistoriaDto } from './dto/create-vistoria.dto';

@Controller('vistorias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class VistoriaController {
  constructor(private readonly service: VistoriaService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateVistoriaDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }
}
