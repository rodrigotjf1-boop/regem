import {
  Body,
  Controller,
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
import { TarefaInstanciaService } from './tarefa-instancia.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloService } from '../modulo/modulo.service';
import { InstanciarTarefaDto } from './dto/instanciar-tarefa.dto';
import { ConcluirTarefaDto } from './dto/concluir-tarefa.dto';
import { ForbiddenException } from '@nestjs/common';

@Controller('tarefas-instancias')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TarefaInstanciaController {
  constructor(
    private readonly service: TarefaInstanciaService,
    private readonly auditoria: AuditoriaService,
    private readonly modulos: ModuloService,
  ) {}

  // Módulo "App do Colaborador" ativável: quando desligado, corta o acesso do
  // perfil de execução (o app dele). Gestores (que veem tarefas pela gestão) passam.
  private async exigeAppColaborador(user: AuthUser) {
    if (user.categoria !== 'execucao') return;
    if (!(await this.modulos.ativo(user.tenantId, user.unidadeId ?? null, 'app_colaborador')))
      throw new ForbiddenException('App do Colaborador está desativado para esta unidade.');
  }

  @Post('instanciar')
  @Roles('presidente', 'gerente', 'supervisao')
  instanciar(@CurrentUser() user: AuthUser, @Body() dto: InstanciarTarefaDto) {
    return this.service.instanciar(user.tenantId, dto);
  }

  @Get()
  async findAll(@CurrentUser() user: AuthUser, @Query('data') data?: string) {
    await this.exigeAppColaborador(user);
    return this.service.findAll(user.tenantId, data);
  }

  @Patch(':id/estado')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  async concluir(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ConcluirTarefaDto,
  ) {
    await this.exigeAppColaborador(user);
    const res = await this.service.concluir(
      user.tenantId,
      id,
      dto,
      user.colaboradorId,
    );
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'checklist',
      acao: 'concluiu_tarefa',
      entidadeTipo: 'tarefa_instancia',
      entidadeId: id,
      detalhe: { estado: (dto as { estado?: string })?.estado },
    });
    return res;
  }
}
