import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterCompraModelosService } from './mister-compra-modelos.service';

// A PARTE "MODELOS DE COMPRA" DO MISTER NA LOJA (versão 9, fase O2, mig 503; protótipo `mockups/regem-mister-v9.html`, "Na loja"):
// o que cada fornecedor manda e a que insumo vai, e os apelidos da empresa. Só o presidente (é quem lança as notas pelo Mister), só
// na nuvem e só com o módulo ligado. As rotas de apelidos vêm antes da de um fornecedor (o caminho fixo antes do parâmetro).
@Controller('mister/modelos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class MisterCompraModelosController {
  constructor(private readonly modelos: MisterCompraModelosService) {}

  @Get()
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  listar(@CurrentUser() user: AuthUser) {
    return this.modelos.listar(user.tenantId);
  }

  @Get('apelidos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  apelidos(@CurrentUser() user: AuthUser) {
    return this.modelos.apelidos(user.tenantId);
  }

  @Patch('apelidos')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  mudarApelido(@CurrentUser() user: AuthUser, @Body() corpo: any) {
    return this.modelos.mudarApelido(user.tenantId, user.colaboradorId, user.categoria, corpo);
  }

  @Post('apelidos/esquecer')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  esquecerApelido(@CurrentUser() user: AuthUser, @Body() corpo: any) {
    return this.modelos.esquecerApelido(user.tenantId, user.colaboradorId, user.categoria, corpo);
  }

  @Get(':fornecedor')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  detalhe(@CurrentUser() user: AuthUser, @Param('fornecedor') fornecedor: string) {
    return this.modelos.detalhe(user.tenantId, fornecedor);
  }

  @Patch(':fornecedor')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  mudarLinha(@CurrentUser() user: AuthUser, @Param('fornecedor') fornecedor: string, @Body() corpo: any) {
    return this.modelos.mudarLinha(user.tenantId, user.colaboradorId, user.categoria, fornecedor, corpo);
  }

  @Post(':fornecedor/esquecer')
  @CloudOnly()
  @Roles('presidente')
  @RequireModulo('mister')
  esquecer(@CurrentUser() user: AuthUser, @Param('fornecedor') fornecedor: string, @Body() corpo: any) {
    return this.modelos.esquecer(user.tenantId, user.colaboradorId, user.categoria, fornecedor, corpo);
  }
}
