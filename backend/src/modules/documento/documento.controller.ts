import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DocumentoService } from './documento.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';

@Controller('documentos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DocumentoController {
  constructor(private readonly service: DocumentoService) {}

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentoDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Post(':id/publicar')
  @Roles('presidente', 'gerente')
  publicar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.publicar(user.tenantId, id);
  }

  // Qualquer usuário autenticado registra a própria ciência.
  @Post(':id/ciencia')
  darCiencia(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.darCiencia(user.tenantId, id, user.colaboradorId);
  }

  @Get(':id/ciencias')
  @Roles('presidente', 'gerente')
  listCiencias(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.listCiencias(user.tenantId, id);
  }
}
