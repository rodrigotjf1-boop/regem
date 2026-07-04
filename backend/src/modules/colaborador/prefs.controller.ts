import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PrefsService } from './prefs.service';
import { UpdatePrefsDto } from './dto/update-prefs.dto';

// Preferências de UI do próprio usuário (resolvidas pelo token).
@Controller('colaborador')
@UseGuards(JwtAuthGuard)
export class PrefsController {
  constructor(private readonly service: PrefsService) {}

  @Get('me/prefs')
  get(@CurrentUser() user: AuthUser) {
    return this.service.get(user.tenantId, user.colaboradorId);
  }

  @Patch('me/prefs')
  patch(@CurrentUser() user: AuthUser, @Body() dto: UpdatePrefsDto) {
    return this.service.patch(user.tenantId, user.colaboradorId, dto);
  }
}
