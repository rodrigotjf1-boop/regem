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

  // Escalados de uma função (+setor) numa data, para escolher o responsável.
  @Get('responsaveis')
  @Roles('presidente', 'gerente', 'supervisao')
  responsaveis(
    @CurrentUser() user: AuthUser,
    @Query('data') data: string,
    @Query('funcaoId') funcaoId: string,
    @Query('setorId') setorId?: string,
  ) {
    if (!data || !funcaoId) return [];
    return this.service.responsaveis(user.tenantId, data, funcaoId, setorId || undefined);
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

  // Política de foto (presidente/C&O): exigir foto na conclusão e/ou na parcial.
  @Get('politica-foto')
  @Roles('presidente', 'gerente', 'supervisao')
  politicaFoto(@CurrentUser() user: AuthUser) {
    return this.service.politicaFoto(user.tenantId);
  }

  @Post('politica-foto')
  @Roles('presidente')
  setPoliticaFoto(@CurrentUser() user: AuthUser, @Body() dto: { conclusao?: boolean; parcial?: boolean }) {
    return this.service.setPoliticaFoto(user.tenantId, dto);
  }

  // Editar a tarefa (título/horário/setor/função/responsável) — gestão.
  @Patch(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  async editar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    const res = await this.service.editar(user.tenantId, id, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'checklist',
      acao: 'editou_tarefa',
      entidadeTipo: 'tarefa_instancia',
      entidadeId: id,
      detalhe: { titulo: dto?.titulo },
    });
    return res;
  }

  // Excluir a tarefa (soft-delete) exigindo motivo — gestão.
  @Delete(':id')
  @Roles('presidente', 'gerente', 'supervisao')
  async excluir(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { motivo?: string }) {
    const res = await this.service.excluir(user.tenantId, id, dto?.motivo ?? '');
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'checklist',
      acao: 'excluiu_tarefa',
      entidadeTipo: 'tarefa_instancia',
      entidadeId: id,
      detalhe: { motivo: dto?.motivo },
    });
    return res;
  }
}
