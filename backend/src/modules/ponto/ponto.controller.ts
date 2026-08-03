import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PontoService } from './ponto.service';
import { MarcarPontoDto } from './dto/marcar-ponto.dto';
import { IncluirMarcacaoDto } from './dto/incluir-marcacao.dto';
import { CriarAjusteDto } from './dto/criar-ajuste.dto';

const GESTOR = ['presidente', 'gerente', 'supervisao'];
function hojeISO() {
  // Data "de hoje" no fuso da operação (BRT), não UTC.
  return new Date().toLocaleDateString('en-CA', {
    timeZone: 'America/Sao_Paulo',
  });
}

@Controller('ponto')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class PontoController {
  constructor(private readonly service: PontoService) {}

  // Qualquer autenticado bate o próprio ponto; gestor/terminal pode informar colaboradorId.
  @Post('marcar')
  marcar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: MarcarPontoDto,
  ) {
    const gestor = GESTOR.includes(user.categoria);
    if (dto.colaboradorId && dto.colaboradorId !== user.colaboradorId && !gestor) {
      throw new ForbiddenException('Sem permissão para marcar por outro colaborador');
    }
    return this.service.marcar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
      dto.origem ?? 'web',
      undefined,
      atual,
    );
  }

  @Get('dia')
  dia(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('data') data?: string,
    @Query('colaboradorId') colaboradorId?: string,
  ) {
    const gestor = GESTOR.includes(user.categoria);
    const alvo = colaboradorId && gestor ? colaboradorId : user.colaboradorId;
    return this.service.listarDia(user.tenantId, data ?? hojeISO(), alvo, atual);
  }

  @Get('espelho')
  espelho(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('colaboradorId') colaboradorId?: string,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const alvo = colaboradorId || user.colaboradorId;
    const gestor = GESTOR.includes(user.categoria);
    if (alvo !== user.colaboradorId && !gestor) {
      throw new ForbiddenException('Sem permissão para ver o espelho de outro');
    }
    const ini = inicio ?? hojeISO();
    const f = fim ?? hojeISO();
    return this.service.espelho(user.tenantId, alvo, ini, f, atual);
  }

  @Get('pessoas')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('ponto_gerencial')
  pessoas(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('data') data?: string,
  ) {
    return this.service.pessoas(user.tenantId, data ?? hojeISO(), atual);
  }

  // Gestão de ponto: incluir marcação esquecida (permissão ponto.criar).
  @Post('marcacao-manual')
  @RequirePerm('ponto', 'criar')
  incluirMarcacao(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: IncluirMarcacaoDto,
  ) {
    return this.service.incluirMarcacao(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
      atual,
    );
  }

  // Gestão de ponto: ajuste (desconsideração / abono / atestado / justificativa).
  @Post('ajuste')
  @RequirePerm('ponto', 'editar')
  criarAjuste(@CurrentUser() user: AuthUser, @Body() dto: CriarAjusteDto) {
    return this.service.criarAjuste(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }

  // ---- Fechamento mensal / espelho de ponto (Épico #2) ----

  // Fechamentos recentes (alerta de pendências em Gerenciamento de ponto).
  @Get('fechamentos')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('ponto_gerencial')
  fechamentos(@CurrentUser() user: AuthUser) {
    return this.service.listarFechamentos(user.tenantId);
  }

  // Gera/recalcula o fechamento do mês (sem competência = mês anterior). Idempotente.
  @Post('fechamentos/gerar')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('ponto_gerencial')
  gerarFechamento(
    @CurrentUser() user: AuthUser,
    @Body() dto: { competencia?: string },
  ) {
    return this.service.gerarFechamento(user.tenantId, dto?.competencia);
  }

  // PDF consolidado do espelho de ponto do mês (todos os colaboradores).
  @Get('fechamentos/:competencia/pdf')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('ponto_gerencial')
  async espelhoPdf(
    @CurrentUser() user: AuthUser,
    @Param('competencia') competencia: string,
    @Res() res: Response,
  ) {
    const { buffer, nomeArquivo } = await this.service.gerarEspelhoMensalPdf(
      user.tenantId,
      competencia,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${nomeArquivo}"`);
    res.send(buffer);
  }

  // Encaminha o espelho do mês ao RH (contador) por WhatsApp. Sem responsável
  // cadastrado e sem nome/telefone no corpo → responde { precisaResponsavel: true }.
  @Post('fechamentos/:competencia/enviar')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('ponto_gerencial')
  enviarEspelho(
    @CurrentUser() user: AuthUser,
    @Param('competencia') competencia: string,
    @Body() dto: { contadorId?: string; nome?: string; telefone?: string },
  ) {
    return this.service.enviarEspelhoContador(
      user.tenantId,
      user.colaboradorId,
      competencia,
      dto ?? {},
    );
  }
}
