import {
  Body,
  Controller,
  Delete,
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
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateChecklistDto } from './dto/create-checklist.dto';
import { CreateChecklistItemDto } from './dto/create-item.dto';

@Controller('checklists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChecklistController {
  constructor(
    private readonly service: ChecklistService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post()
  @Roles('presidente', 'gerente', 'supervisao')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateChecklistDto) {
    return this.service.create(user.tenantId, dto, user.colaboradorId);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  // Modelos por ramo (rota estática antes de :id).
  @Get('sugestoes')
  sugestoes(@CurrentUser() user: AuthUser) {
    return this.service.sugestoesRamo(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Delete('itens/:itemId')
  @Roles('presidente', 'gerente', 'supervisao')
  removeItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.service.removeItem(user.tenantId, itemId);
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
  async submeter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const res = await this.service.submeter(user.tenantId, id);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'checklist',
      acao: 'submeteu_checklist',
      entidadeTipo: 'checklist',
      entidadeId: id,
    });
    return res;
  }

  @Post(':id/publicar')
  @Roles('presidente', 'gerente')
  async publicar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const res = await this.service.publicar(user.tenantId, id, user.colaboradorId);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'checklist',
      acao: 'publicou_pop',
      entidadeTipo: 'checklist',
      entidadeId: id,
    });
    return res;
  }

  @Get(':id/pops')
  listPops(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listPops(user.tenantId, id);
  }
}
