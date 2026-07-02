import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  @Get()
  findAll(@CurrentUser() user: AuthUser, @Query('data') data?: string) {
    return this.service.findAll(user.tenantId, data);
  }
}
