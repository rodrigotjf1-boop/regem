import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { TarefaDefService } from './tarefa-def.service';
import { CreateTarefaDefDto } from './dto/create-tarefa-def.dto';

@Controller('tarefas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TarefaDefController {
  constructor(private readonly service: TarefaDefService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateTarefaDefDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }
}
