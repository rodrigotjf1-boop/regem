import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncService } from './sync.service';

// API de sync consumida pelo SERVIDOR LOCAL (ver docs/arquitetura-edge.md).
// v1: autenticada como presidente + escopada ao tenant do token.
// v2: credencial de dispositivo/servidor dedicada.
@Controller('sync')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Get('pull')
  @Roles('presidente')
  pull(@CurrentUser() user: AuthUser, @Query('desde') desde?: string) {
    return this.service.pull(user.tenantId, desde);
  }
}
