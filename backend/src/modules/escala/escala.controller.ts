import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EscalaService } from './escala.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';

@Controller('escala')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EscalaController {
  constructor(
    private readonly service: EscalaService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Post()
  @Roles('presidente', 'gerente')
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateAlocacaoDto) {
    const res = await this.service.create(user.tenantId, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'criou_alocacao',
      entidadeTipo: 'alocacao',
      entidadeId: (res as { id?: string })?.id,
      detalhe: {
        data: dto.data,
        turnoId: dto.turnoId,
        etiquetaId: dto.etiquetaId,
        colaboradorId: dto.colaboradorId,
        tipo: dto.tipo,
      },
    });
    return res;
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  async alterar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { colaboradorId?: string | null; tipo?: string },
  ) {
    const res = await this.service.alterar(user.tenantId, id, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'alterou_alocacao',
      entidadeTipo: 'alocacao',
      entidadeId: id,
      detalhe: { colaboradorId: dto.colaboradorId, tipo: dto.tipo },
    });
    return res;
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  async remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const res = await this.service.remover(user.tenantId, id);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'removeu_alocacao',
      entidadeTipo: 'alocacao',
      entidadeId: id,
    });
    return res;
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('data') data?: string) {
    return this.service.findAll(user.tenantId, data);
  }

  // Grade semanal a partir de `inicio` (YYYY-MM-DD, segunda-feira). Default: hoje.
  @Get('semana')
  semana(@CurrentUser() user: AuthUser, @Query('inicio') inicio?: string) {
    const ini = inicio ?? new Date().toISOString().slice(0, 10);
    return this.service.semana(user.tenantId, ini);
  }

  // Alocações num período [de, ate] (visões por dia e por mês).
  @Get('periodo')
  periodo(
    @CurrentUser() user: AuthUser,
    @Query('de') de: string,
    @Query('ate') ate: string,
  ) {
    return this.service.periodo(user.tenantId, de, ate);
  }
}
