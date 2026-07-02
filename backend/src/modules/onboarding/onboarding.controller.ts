import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { OnboardingService } from './onboarding.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { AplicarTemplateDto } from './dto/aplicar-template.dto';

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
