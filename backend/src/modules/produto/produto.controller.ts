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
import { ProdutoService } from './produto.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';

const GESTOR = ['presidente', 'gerente', 'supervisao'];

@Controller('produtos')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProdutoController {
  constructor(private readonly service: ProdutoService) {}

  @Get('categorias')
  listarCategorias(@CurrentUser() user: AuthUser) {
    return this.service.listarCategorias(user.tenantId);
  }

  @Post('categorias')
  @Roles(...GESTOR)
  criarCategoria(@CurrentUser() user: AuthUser, @Body() dto: CreateCategoriaDto) {
    return this.service.criarCategoria(user.tenantId, dto);
  }

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Get(':id')
  getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOne(user.tenantId, id);
  }

  @Post()
  @Roles(...GESTOR)
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateProdutoDto) {
    return this.service.criar(user.tenantId, user.colaboradorId, user.categoria, dto);
  }

  @Patch(':id')
  @Roles(...GESTOR)
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateProdutoDto,
  ) {
    return this.service.atualizar(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles(...GESTOR)
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remover(user.tenantId, id);
  }
}
