import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { OnboardingService } from './onboarding.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AplicarTemplateDto } from './dto/aplicar-template.dto';
import { AplicarWizardDto } from './dto/aplicar-wizard.dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OnboardingController {
  constructor(
    private readonly service: OnboardingService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Get('ramos')
  ramos() {
    return this.service.ramosDisponiveis();
  }

  // Progresso do cadastro (para gate do wizard e barras de setup).
  @Get('progresso')
  @Roles('presidente', 'gerente')
  progresso(@CurrentUser() user: AuthUser) {
    return this.service.progresso(user.tenantId);
  }

  // Wizard rico (mockup "Configuração por ramo") — só presidente/C&O.
  @Get('ramos-detalhes')
  @Roles('presidente')
  ramosDetalhes() {
    return this.service.ramosDetalhados();
  }

  @Get('blueprint')
  @Roles('presidente')
  blueprint(@Query('ramo') ramo: string) {
    return this.service.blueprint(ramo);
  }

  @Post('wizard')
  @Roles('presidente')
  async wizard(@CurrentUser() user: AuthUser, @Body() dto: AplicarWizardDto) {
    const res = await this.service.aplicarWizard(user.tenantId, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'cadastro',
      acao: 'aplicou_wizard',
      unidadeId: dto.unidadeId,
      detalhe: { ramo: dto.ramo, criados: res.criados },
    });
    return res;
  }

  @Post('template')
  @Roles('presidente', 'gerente')
  async aplicar(@CurrentUser() user: AuthUser, @Body() dto: AplicarTemplateDto) {
    const res = await this.service.aplicarTemplate(user.tenantId, dto);
    await this.auditoria.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'cadastro',
      acao: 'aplicou_template',
      unidadeId: dto.unidadeId,
      detalhe: { ramo: dto.ramo },
    });
    return res;
  }
}
