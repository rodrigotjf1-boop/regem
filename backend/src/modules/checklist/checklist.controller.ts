import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ChecklistService } from './checklist.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { CreateChecklistItemDto } from './dto/create-item.dto';

@Controller('checklists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChecklistController {
  constructor(private readonly service: ChecklistService) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateChecklistDto) {
    return this.service.create(user.tenantId, dto, user.colaboradorId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Post(':id/itens')
  @Roles('presidente', 'gerente', 'supervisao')
  addItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateChecklistItemDto,
  ) {
    return this.service.addItem(user.tenantId, id, dto);
  }

  @Post(':id/submeter')
  @Roles('supervisao')
  submeter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.submeter(user.tenantId, id);
  }

  @Post(':id/publicar')
  @Roles('presidente', 'gerente')
  publicar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.publicar(user.tenantId, id, user.colaboradorId);
  }

  @Get(':id/pops')
  listPops(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listPops(user.tenantId, id);
  }
}
