import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EquipamentoService } from './equipamento.service';
import { CreateEquipamentoDto } from './dto/create-equipamento.dto';

// Gestão de equipamentos (KDS / Terminal de Ponto) — só presidente/gerente.
@Controller('equipamento')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EquipamentoController {
  constructor(private readonly service: EquipamentoService) {}

  @Get()
  @Roles('presidente', 'gerente')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post()
  @Roles('presidente', 'gerente')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateEquipamentoDto) {
    return this.service.criar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }

  // ----- Impressoras (cadastro manual: direcionamento + vias) -----
  @Get('impressoras')
  @Roles('presidente', 'gerente')
  impressoras(@CurrentUser() user: AuthUser) {
    return this.service.listarImpressoras(user.tenantId);
  }

  @Put('impressoras')
  @Roles('presidente', 'gerente')
  salvarImpressora(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarImpressora(user.tenantId, dto);
  }

  @Delete('impressoras/:id')
  @Roles('presidente', 'gerente')
  removerImpressora(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerImpressora(user.tenantId, id);
  }

  // ----- Terminal de PDV: pareamento do PC (qualquer autenticado; o token é a prova) -----
  @Post('parear')
  parear(@CurrentUser() user: AuthUser, @Body() dto: { token?: string }) {
    return this.service.parear(user.tenantId, dto?.token ?? '');
  }

  // Gestor gera um código de 6 dígitos (uso único, 15 min) para o PC parear.
  @Post(':id/codigo')
  @Roles('presidente', 'gerente')
  gerarCodigo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.gerarCodigo(user.tenantId, id, user.colaboradorId, user.categoria);
  }

  // Terminal de PDV: amarra (ou limpa) a impressora de cupom do terminal.
  @Patch(':id/impressora')
  @Roles('presidente', 'gerente')
  setImpressora(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { impressoraId?: string | null },
  ) {
    return this.service.setImpressoraTerminal(
      user.tenantId,
      id,
      dto?.impressoraId ?? null,
    );
  }

  // KDS: impressão guiada por etapa (mig 129).
  @Patch(':id/impressao-etapa')
  @Roles('presidente', 'gerente')
  setImpressaoEtapa(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setImpressaoEtapa(user.tenantId, id, dto ?? {});
  }

  @Patch(':id/revogar')
  @Roles('presidente', 'gerente')
  revogar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revogar(
      user.tenantId,
      id,
      user.colaboradorId,
      user.categoria,
    );
  }
}
