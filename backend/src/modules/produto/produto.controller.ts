import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ProdutoService } from './produto.service';
import { CreateProdutoDto } from './dto/create-produto.dto';
import { CreateCategoriaDto } from './dto/create-categoria.dto';

const GESTOR = ['presidente', 'gerente', 'supervisao'];

@Controller('produtos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('loja')
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

  // Reordenação por arrastar: recebe a lista de ids na ordem desejada.
  @Post('categorias/reordenar')
  @Roles(...GESTOR)
  reordenarCategorias(@CurrentUser() user: AuthUser, @Body() dto: { ids?: string[] }) {
    return this.service.reordenarCategorias(user.tenantId, dto?.ids ?? []);
  }

  @Patch('categorias/:id')
  @Roles(...GESTOR)
  atualizarCategoria(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarCategoria(user.tenantId, id, dto);
  }

  @Delete('categorias/:id')
  @Roles(...GESTOR)
  excluirCategoria(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.excluirCategoria(user.tenantId, id);
  }

  // ----- Direcionamento do catálogo (produto → KDS/impressora, em massa) -----
  @Get('direcionamento')
  listarDirecionamento(@CurrentUser() user: AuthUser) {
    return this.service.listarDirecionamento(user.tenantId);
  }

  @Put('direcionamento')
  @Roles(...GESTOR)
  @RequirePerm('direcionamento_impressao')
  setDirecionamento(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setDirecionamentoLote(
      user.tenantId,
      dto?.produtoIds ?? [],
      dto?.equipamentoIds ?? [],
      dto?.modo === 'adicionar' ? 'adicionar' : 'substituir',
    );
  }

  // ----- Opções (catálogo reutilizável, Fase 2) -----
  @Get('opcoes')
  listarOpcoes(@CurrentUser() user: AuthUser) {
    return this.service.listarOpcoes(user.tenantId);
  }

  @Post('opcoes')
  @Roles(...GESTOR)
  criarOpcaoCatalogo(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarOpcaoCatalogo(user.tenantId, dto);
  }

  @Patch('opcoes/:id')
  @Roles(...GESTOR)
  atualizarOpcao(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarOpcao(user.tenantId, id, dto);
  }

  @Delete('opcoes/:id')
  @Roles(...GESTOR)
  excluirOpcao(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.excluirOpcao(user.tenantId, id);
  }

  // Ações em MASSA (path de 3 segmentos p/ não colidir com opcoes/:id).
  @Post('opcoes/massa/excluir')
  @Roles(...GESTOR)
  excluirOpcoesMassa(@CurrentUser() user: AuthUser, @Body() dto: { ids?: string[] }) {
    return this.service.excluirOpcoesMassa(user.tenantId, dto?.ids ?? []);
  }

  @Patch('opcoes/massa/preco')
  @Roles(...GESTOR)
  precoCustoOpcoesMassa(@CurrentUser() user: AuthUser, @Body() dto: { ids?: string[]; precoCusto?: number }) {
    return this.service.precoCustoOpcoesMassa(user.tenantId, dto?.ids ?? [], Number(dto?.precoCusto) || 0);
  }

  // Destino de produção PRÓPRIO da opção (mig 127). Vazio = herda do produto.
  @Get('opcoes/:id/destinos')
  opcaoDestinos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getOpcaoDestinos(user.tenantId, id);
  }

  @Put('opcoes/:id/destinos')
  @Roles(...GESTOR)
  setOpcaoDestinos(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setOpcaoDestinos(user.tenantId, id, dto?.equipamentoIds ?? []);
  }

  // ----- Complementos (etapas reutilizáveis, Fase 3) -----
  @Get('complementos-catalogo')
  listarComplementos(@CurrentUser() user: AuthUser) {
    return this.service.listarComplementos(user.tenantId);
  }

  @Post('complementos-catalogo')
  @Roles(...GESTOR)
  criarComplementoCatalogo(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarComplemento(user.tenantId, dto);
  }

  // Sobe os complementos que vieram direto no motor (imports Anota Aí/Cardápio Web e
  // editor antigo) para o catálogo reutilizável — dedup por conteúdo idêntico.
  @Post('complementos-catalogo/sincronizar')
  @Roles(...GESTOR)
  sincronizarComplementos(@CurrentUser() user: AuthUser) {
    return this.service.promoverComplementosParaCatalogo(user.tenantId);
  }

  @Patch('complementos-catalogo/:id')
  @Roles(...GESTOR)
  atualizarComplementoCatalogo(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarComplemento(user.tenantId, id, dto);
  }

  // Destino de produção PRÓPRIO da etapa/complemento (mig 127). Vazio = herda do produto.
  @Get('complementos-catalogo/:id/destinos')
  complementoDestinos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getComplementoDestinos(user.tenantId, id);
  }

  @Put('complementos-catalogo/:id/destinos')
  @Roles(...GESTOR)
  setComplementoDestinos(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setComplementoDestinos(user.tenantId, id, dto?.equipamentoIds ?? []);
  }

  @Delete('complementos-catalogo/:id')
  @Roles(...GESTOR)
  excluirComplementoCatalogo(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.excluirComplemento(user.tenantId, id);
  }

  // ----- Produto ↔ complementos (etapas) reutilizáveis (Fase 4) -----
  @Get(':id/complementos-catalogo')
  getProdutoComplementos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getProdutoComplementos(user.tenantId, id);
  }

  @Put(':id/complementos-catalogo')
  @Roles(...GESTOR)
  setProdutoComplementos(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: { ids?: string[] }) {
    return this.service.setProdutoComplementos(user.tenantId, id, dto?.ids ?? []);
  }

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId, !!user.permissoes?.ver_financeiro);
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

  // Duplica o produto (variações, combo, complementos, faixas e destinos).
  @Post(':id/duplicar')
  @Roles(...GESTOR)
  duplicar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.duplicar(user.tenantId, id);
  }

  // Reativar produto esgotado sem dar entrada (liga/desliga a contagem negativa).
  @Post(':id/permite-negativo')
  @Roles(...GESTOR)
  permiteNegativo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { ativo?: boolean },
  ) {
    return this.service.permiteNegativo(user.tenantId, id, dto?.ativo !== false);
  }

  // ----- Complementos (opcionais/adicionais) -----
  @Get(':id/complementos')
  complementos(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.complementosDe(user.tenantId, id);
  }

  @Post(':id/complementos/grupos')
  @Roles(...GESTOR)
  criarGrupo(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.criarGrupo(user.tenantId, id, dto);
  }

  @Post('complementos/grupos/:gid/opcoes')
  @Roles(...GESTOR)
  criarOpcao(
    @CurrentUser() user: AuthUser,
    @Param('gid') gid: string,
    @Body() dto: any,
  ) {
    return this.service.criarOpcao(user.tenantId, gid, dto);
  }

  @Delete('complementos/grupos/:gid')
  @Roles(...GESTOR)
  removerGrupo(@CurrentUser() user: AuthUser, @Param('gid') gid: string) {
    return this.service.removerGrupo(user.tenantId, gid);
  }

  @Delete('complementos/opcoes/:oid')
  @Roles(...GESTOR)
  removerOpcao(@CurrentUser() user: AuthUser, @Param('oid') oid: string) {
    return this.service.removerOpcao(user.tenantId, oid);
  }

  // ----- Faixas de preço por volume (B2B) -----
  @Get(':id/faixas')
  faixas(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.faixasDe(user.tenantId, id);
  }

  @Put(':id/faixas')
  @Roles(...GESTOR)
  setFaixas(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.setFaixas(user.tenantId, id, dto?.faixas ?? []);
  }
}
