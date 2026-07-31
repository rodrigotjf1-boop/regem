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
import { FornecedorService } from './fornecedor.service';
import { CreateFornecedorDto } from './dto/create-fornecedor.dto';

@Controller('fornecedores')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('cadastros')
export class FornecedorController {
  constructor(private readonly service: FornecedorService) {}

  @Get()
  findAll(@CurrentUser() user: AuthUser) {
    return this.service.findAll(user.tenantId);
  }

  @Get('pendencias')
  @Roles('presidente', 'gerente')
  pendencias(@CurrentUser() user: AuthUser) {
    return this.service.pendencias(user.tenantId);
  }

  @Post()
  @Roles('presidente', 'gerente')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateFornecedorDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateFornecedorDto,
  ) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
