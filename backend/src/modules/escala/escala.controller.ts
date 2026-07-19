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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EscalaService } from './escala.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';
import { GerarEscalaDto } from './dto/gerar-escala.dto';

@Controller('escala')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('escalas')
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

  // Geração recorrente: cria a regra + preenche o período (calendário).
  @Post('gerar')
  @Roles('presidente', 'gerente')
  async gerar(@CurrentUser() user: AuthUser, @Body() dto: GerarEscalaDto) {
    const res = await this.service.gerarEscala(user.tenantId, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'gerou_escala',
      entidadeTipo: 'escala_regra',
      entidadeId: res.regraId,
      detalhe: {
        colaboradorId: dto.colaboradorId,
        jornadaTipo: dto.jornadaTipo,
        dataInicio: dto.dataInicio,
        dataFim: dto.dataFim,
        criadas: res.criadas,
      },
    });
    return res;
  }

  // Relatório de faltas do período (gestão).
  @Get('faltas')
  @Roles('presidente', 'gerente')
  faltas(
    @CurrentUser() user: AuthUser,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.faltas(user.tenantId, de, ate);
  }

  // Marca a presença de uma alocação (presente / falta justificada / injustificada).
  @Patch(':id/presenca')
  @Roles('presidente', 'gerente', 'supervisao')
  async presenca(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { presenca: string; comprovanteRef?: string | null; obs?: string | null },
  ) {
    const res = await this.service.marcarPresenca(user.tenantId, id, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'marcou_presenca',
      entidadeTipo: 'alocacao',
      entidadeId: id,
      detalhe: { presenca: dto.presenca },
    });
    return res;
  }

  // Edita horário/pausa de um dia com escopo (dia | futuras | datas).
  @Patch(':id/horario')
  @Roles('presidente', 'gerente')
  async editarHorario(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    dto: {
      escopo: 'dia' | 'futuras' | 'datas';
      horaInicio?: string | null;
      horaFim?: string | null;
      pausaInicio?: string | null;
      pausaFim?: string | null;
      datas?: string[];
    },
  ) {
    const res = await this.service.editarHorario(user.tenantId, id, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'escala',
      acao: 'editou_horario_escala',
      entidadeTipo: 'alocacao',
      entidadeId: id,
      detalhe: { escopo: dto.escopo, atualizadas: res.atualizadas },
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
  findAll(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('data') data?: string,
  ) {
    return this.service.findAll(user.tenantId, data, unidadeId);
  }

  // Grade semanal a partir de `inicio` (YYYY-MM-DD, segunda-feira). Default: hoje.
  @Get('semana')
  semana(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('inicio') inicio?: string,
  ) {
    const ini = inicio ?? new Date().toISOString().slice(0, 10);
    return this.service.semana(user.tenantId, ini, unidadeId);
  }

  // Alocações num período [de, ate] (visões por dia e por mês).
  @Get('periodo')
  periodo(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('de') de: string,
    @Query('ate') ate: string,
  ) {
    return this.service.periodo(user.tenantId, de, ate, unidadeId);
  }
}
