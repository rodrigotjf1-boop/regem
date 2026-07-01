import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EscalaService } from './escala.service';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';

@Controller('escala')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EscalaController {
  constructor(private readonly service: EscalaService) {}

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAlocacaoDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('data') data?: string) {
    return this.service.findAll(user.tenantId, data);
  }
}
