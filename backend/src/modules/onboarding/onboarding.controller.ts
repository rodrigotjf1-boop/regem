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

  // Wizard rico (mockup "Configuração por ramo").
  @Get('ramos-detalhes')
  @Roles('presidente', 'gerente')
  ramosDetalhes() {
    return this.service.ramosDetalhados();
  }

  @Get('blueprint')
  @Roles('presidente', 'gerente')
  blueprint(@Query('ramo') ramo: string) {
    return this.service.blueprint(ramo);
  }

  @Post('wizard')
  @Roles('presidente', 'gerente')
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
