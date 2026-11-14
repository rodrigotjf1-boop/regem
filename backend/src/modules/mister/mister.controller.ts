import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { MisterVinculoService } from './mister-vinculo.service';

// O WHATSAPP DE QUEM ESTÁ LOGADO no Mister e a parte "Pessoas" (mig 417). Gerente e presidente, só na nuvem e só com o
// módulo ligado. Cada um liga o PRÓPRIO número: nenhuma rota recebe telefone, e o código sai sempre para o usuário logado.
// A única rota que nomeia outra pessoa é a de DESLIGAR — e o serviço só a aceita do presidente, dentro da empresa dele.
@Controller('mister')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterController {
  constructor(
    private readonly vinculo: MisterVinculoService,
    private readonly avisos: MisterAvisosConfigService,
    private readonly relatorios: MisterRelatoriosConfigService,
  ) {}

  /** A situação do meu WhatsApp no Mister e, se eu gerei um código que ainda vale, o código. */
  @Get('whatsapp')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  meu(@CurrentUser() user: AuthUser) {
    return this.vinculo.meu(user);
  }

  /** Gera o código de ligar (vale 10 minutos e uma vez). */
  @Post('whatsapp/codigo')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  gerarCodigo(@CurrentUser() user: AuthUser) {
    return this.vinculo.gerarCodigo(user);
  }

  /** Desliga o meu WhatsApp do Mister. */
  @Delete('whatsapp')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  desligar(@CurrentUser() user: AuthUser) {
    return this.vinculo.desligar(user);
  }

  /** A parte "Pessoas": o presidente vê os gerentes e presidentes da empresa; o gerente recebe só a própria linha. */
  @Get('pessoas')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  pessoas(@CurrentUser() user: AuthUser) {
    return this.vinculo.pessoas(user);
  }

  /** Desliga o WhatsApp de uma pessoa: o próprio, ou — só o presidente — o de outra pessoa da empresa dele. */
  @Delete('pessoas/:colaboradorId')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequireModulo('mister')
  desligarPessoa(@CurrentUser() user: AuthUser, @Param('colaboradorId') colaboradorId: string) {
    return this.vinculo.desligarPessoa(user, colaboradorId);
  }

  /** Para onde vai cada aviso (mig 419): a escolha da empresa ou o padrão. Só o presidente. */
  @Get('avisos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  avisosDaTela(@CurrentUser() user: AuthUser) {
    return this.avisos.daTela(user.tenantId);
  }

  /** Salva os avisos que mudaram (cada um inteiro). Só o presidente; toda recusa antes da gravação. */
  @Patch('avisos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  salvarAvisos(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.avisos.salvar(user, dto);
  }

  /** O horário de cada relatório (mig 420): a escolha da empresa ou o padrão (desligado), e o último envio. Só o presidente. */
  @Get('relatorios')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  relatoriosDaTela(@CurrentUser() user: AuthUser) {
    return this.relatorios.daTela(user.tenantId);
  }

  /** Salva os relatórios que mudaram (cada um inteiro). Só o presidente; toda recusa antes da gravação. */
  @Patch('relatorios')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  salvarRelatorios(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.relatorios.salvar(user, dto);
  }
}
