import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DesperdicioService } from './desperdicio.service';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';

@Controller('desperdicios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DesperdicioController {
  constructor(private readonly service: DesperdicioService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDesperdicioDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user);
  }
}
