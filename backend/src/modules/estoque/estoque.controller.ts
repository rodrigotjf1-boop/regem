import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EstoqueService } from './estoque.service';
import { ProdutosPlanilhaService } from './produtos-planilha.service';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';

@Controller('estoque')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class EstoqueController {
  constructor(
    private readonly service: EstoqueService,
    private readonly planilha: ProdutosPlanilhaService,
  ) {}

  // Lista FECHADA de unidades de medida (cadastro, conversões e importação escolhem daqui).
  // Sem @RequirePerm de propósito: a lista é fixa, não é dado da loja, e quem edita ficha técnica,
  // ordem de produção ou produto do catálogo (sem a permissão de estoque) também escolhe dela.
  @Get('unidades-medida')
  listUnidades() {
    return this.service.listUnidades();
  }

  @Post('itens')
  @RequirePerm('estoque', 'criar')
  createItem(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateItemDto,
  ) {
    return this.service.createItem(user.tenantId, dto, atual, user);
  }

  @Get('itens')
  @RequirePerm('estoque', 'ver')
  listItens(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    // Custo/valor em R$ conforme a permissão "ver_financeiro" do perfil.
    return this.service.listItens(user.tenantId, !!user.permissoes?.ver_financeiro, atual);
  }

  @Patch('itens/:id')
  @RequirePerm('estoque', 'editar')
  updateItem(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.service.updateItem(user.tenantId, id, dto, atual, user);
  }

  // Excluir produto: só gerente e presidente. A 1ª rota diz ANTES se pode e, se não, por quê
  // (saldo, ficha técnica, cardápio) — a tela mostra o motivo no lugar da confirmação. A 2ª
  // confere de novo e exclui (o produto recebe `deleted_at`; o histórico fica).
  @Get('itens/:id/exclusao')
  @Roles('presidente', 'gerente')
  @RequirePerm('estoque', 'editar')
  exclusaoDoItem(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
  ) {
    return this.service.exclusaoDoItem(user.tenantId, id, atual);
  }

  @Delete('itens/:id')
  @Roles('presidente', 'gerente')
  @RequirePerm('estoque', 'editar')
  removerItem(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
  ) {
    return this.service.removerItem(user.tenantId, id, atual, user);
  }

  // ----- Importar / exportar o cadastro por planilha (Excel .xlsx ou CSV) -----
  // Prévia em memória: NÃO grava. Devolve cada produto como novo, igual ou parecido.
  @Post('itens/importar/previa')
  @Roles('presidente', 'gerente')
  @RequirePerm('estoque', 'criar')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importarPrevia(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @UploadedFile() file?: { buffer?: Buffer; originalname?: string },
  ) {
    return this.planilha.previa(user.tenantId, file?.buffer ?? Buffer.alloc(0), file?.originalname ?? '', atual);
  }

  // Grava os produtos conferidos (um envio só). Nome que já existe é pulado, não duplicado.
  @Post('itens/importar')
  @Roles('presidente', 'gerente')
  @RequirePerm('estoque', 'criar')
  importar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    @Body() dto: any,
  ) {
    return this.planilha.importar(user.tenantId, dto, atual, user);
  }

  // Exporta o cadastro (ou só os `ids` da lista filtrada). Custo e valor em R$ só saem para
  // quem tem a permissão "ver_financeiro" — a mesma regra da lista.
  @Post('itens/exportar')
  @RequirePerm('estoque', 'ver')
  exportar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: { formato?: string; ids?: string[] },
  ) {
    return this.planilha.exportar(user.tenantId, !!user.permissoes?.ver_financeiro, atual, dto?.formato, dto?.ids);
  }

  // ----- Categorias de insumo (cadastro próprio) -----
  @Get('categorias-item')
  @RequirePerm('estoque', 'ver')
  listCategorias(@CurrentUser() user: AuthUser) {
    return this.service.listCategorias(user.tenantId);
  }

  @Post('categorias-item')
  @Roles('presidente', 'gerente', 'supervisao')
  createCategoria(
    @CurrentUser() user: AuthUser,
    @Body() dto: { nome: string; cor?: string },
  ) {
    return this.service.createCategoria(user.tenantId, dto);
  }

  @Delete('categorias-item/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  removerCategoria(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerCategoria(user.tenantId, id);
  }

  @Post('movimentos')
  @RequirePerm('estoque', 'editar')
  createMovimento(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: CreateMovimentoDto,
  ) {
    return this.service.createMovimento(user.tenantId, dto, atual, user);
  }

  @Get('movimentos')
  @RequirePerm('estoque', 'ver')
  listMovimentos(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('itemId') itemId: string,
  ) {
    return this.service.listMovimentos(user.tenantId, itemId, atual);
  }

  // Inteligência de estoque: valorização + reposição (ROP) + curva ABC no período.
  @Get('inteligencia')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'ver')
  inteligencia(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('inicio') inicio: string,
    @Query('fim') fim: string,
  ) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini =
      inicio ||
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return this.service.inteligencia(
      user.tenantId,
      ini,
      fim || hoje,
      !!user.permissoes?.ver_financeiro,
      atual,
    );
  }

  // Validades FEFO: lotes por vencimento com status.
  @Get('validades')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'ver')
  validades(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.validades(user.tenantId, atual);
  }

  // CMV real (EI + Compras − EF) × teórico → desvio. Período padrão: mês corrente.
  // CMV é relatório de custo (financeiro) → exige a permissão "ver_financeiro".
  @Get('cmv')
  @RequirePerm('ver_financeiro')
  cmv(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const hoje = new Date();
    const ini =
      inicio ||
      new Date(hoje.getFullYear(), hoje.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
    return this.service.cmvReal(user.tenantId, ini, fim || hoje.toISOString().slice(0, 10), atual);
  }

  // Gera o snapshot de estoque de hoje (bootstrap/teste; o job mensal faz automático).
  @Post('snapshot')
  @Roles('presidente', 'gerente')
  snapshot(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.gerarSnapshot(user.tenantId, undefined, atual);
  }

  // Alertas persistidos (ROP/FEFO) — gerados pelos jobs, resolvidos pelo gestor.
  @Get('alertas')
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('estoque', 'ver')
  alertas(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listarAlertas(user.tenantId, atual);
  }

  @Post('alertas/:id/resolver')
  @Roles('presidente', 'gerente', 'supervisao')
  resolverAlerta(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Param('id') id: string,
  ) {
    return this.service.resolverAlerta(user.tenantId, id, user.colaboradorId, atual);
  }
}
