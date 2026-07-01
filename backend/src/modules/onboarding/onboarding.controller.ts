import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { OnboardingService } from './onboarding.service';
import { AplicarTemplateDto } from './dto/aplicar-template.dto';

@Controller('onboarding')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OnboardingController {
  constructor(private readonly service: OnboardingService) {}

  @Get('ramos')
  ramos() {
    return this.service.ramosDisponiveis();
  }

  @Post('template')
  @Roles('presidente', 'gerente')
  aplicar(@CurrentUser() user: AuthUser, @Body() dto: AplicarTemplateDto) {
    return this.service.aplicarTemplate(user.tenantId, dto);
  }
}
