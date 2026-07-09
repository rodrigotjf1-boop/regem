import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EtiquetaService } from './etiqueta.service';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';

@Controller('etiquetas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EtiquetaController {
  constructor(private readonly service: EtiquetaService) {}

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEtiquetaDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body()
    dto: { sigla?: string; contador?: number; cor?: string; icone?: string },
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
