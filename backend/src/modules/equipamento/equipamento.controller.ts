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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
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
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post()
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
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
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  impressoras(@CurrentUser() user: AuthUser) {
    return this.service.listarImpressoras(user.tenantId);
  }

  @Put('impressoras')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  salvarImpressora(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarImpressora(user.tenantId, dto);
  }

  @Delete('impressoras/:id')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
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
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  gerarCodigo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.gerarCodigo(user.tenantId, id, user.colaboradorId, user.categoria);
  }

  // "Trocar máquina" (DR): reseta o binding (segredo + fingerprint + anti-rollback)
  // e gera um código novo — a máquina NOVA pareia do zero, a antiga fica inerte.
  @Post(':id/trocar-maquina')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  trocarMaquina(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.trocarMaquina(user.tenantId, id, user.colaboradorId, user.categoria);
  }

  // Terminal de PDV: amarra (ou limpa) a impressora de cupom do terminal.
  @Patch(':id/impressora')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
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
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  setImpressaoEtapa(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setImpressaoEtapa(user.tenantId, id, dto ?? {});
  }

  // KDS: próximo KDS da cadeia — ao avançar, o card migra p/ ele (mig 159, Fase E).
  @Patch(':id/proximo-kds')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  setProximoKds(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setProximoKds(user.tenantId, id, dto?.proximoKdsId ?? null);
  }

  @Patch(':id/revogar')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('servidor')
  revogar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revogar(
      user.tenantId,
      id,
      user.colaboradorId,
      user.categoria,
    );
  }
}
