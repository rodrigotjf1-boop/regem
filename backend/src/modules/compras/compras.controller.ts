import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { periodoDaConsulta } from '../../common/periodo';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ComprasService } from './compras.service';
import { CreateCompraListaDto } from './dto/create-compra-lista.dto';
import { ReceberCompraDto } from './dto/receber-compra.dto';
import { GerarFaltanteDto } from './dto/gerar-faltante.dto';

// Lista de compras — listar/receber = autenticado (o delegado pode receber);
// criar/remover = gestão.
@Controller('compras')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class ComprasController {
  constructor(private readonly service: ComprasService) {}

  // `?inicio=AAAA-MM-DD&fim=AAAA-MM-DD` corta as listas JÁ RECEBIDAS pela data do recebimento;
  // as que aguardam vêm sempre. Sem período, tudo.
  @Get('listas')
  @RequirePerm('estoque', 'ver')
  listListas(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.listListas(user.tenantId, atual, periodoDaConsulta(inicio, fim), !!user.permissoes?.ver_financeiro);
  }

  @Get('sugestao')
  @RequirePerm('estoque', 'ver')
  sugerir(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.sugerir(user.tenantId, atual);
  }

  @Get('listas/:id')
  @RequirePerm('estoque', 'ver')
  getLista(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
  ) {
    return this.service.getLista(user.tenantId, id, atual, !!user.permissoes?.ver_financeiro);
  }

  @Post('listas')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'criar')
  createLista(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateCompraListaDto,
  ) {
    return this.service.createLista(user.tenantId, dto, atual);
  }

  @Delete('listas/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'excluir')
  removerLista(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
  ) {
    return this.service.removerLista(user.tenantId, id, atual);
  }

  @Post('listas/:id/receber')
  @RequirePerm('estoque', 'editar')
  receber(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
    @Body() dto: ReceberCompraDto,
  ) {
    return this.service.receber(user.tenantId, id, user.colaboradorId, dto, atual);
  }

  // Lista nova só com o que faltou de uma compra já recebida. É criar lista: mesma porta de `POST listas`.
  @Post('listas/:id/faltante')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'criar')
  gerarListaDoQueFaltou(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
    @Body() dto: GerarFaltanteDto,
  ) {
    return this.service.gerarListaDoQueFaltou(user.tenantId, id, dto, atual, user.colaboradorId);
  }
}
