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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DocumentoService } from './documento.service';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { UpdateDocumentoDto } from './dto/update-documento.dto';

@Controller('documentos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class DocumentoController {
  constructor(private readonly service: DocumentoService) {}

  @Post()
  @Roles('presidente', 'gerente')
  @RequirePerm('guias')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateDocumentoDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId, user.colaboradorId);
  }

  // Modelos por ramo (rota estática antes de :id).
  @Get('sugestoes')
  @Roles('presidente', 'gerente')
  sugestoes(@CurrentUser() user: AuthUser) {
    return this.service.sugestoesRamo(user.tenantId);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('guias')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateDocumentoDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('guias')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }

  @Post(':id/publicar')
  @Roles('presidente', 'gerente')
  @RequirePerm('guias')
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
