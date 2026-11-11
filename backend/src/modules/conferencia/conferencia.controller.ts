import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { ConferenciaService, QUEM_CONFERE } from './conferencia.service';

/** Mudar preço pede "Ver valores em R$" (o presidente sempre) — a mesma regra das rotas de produto. */
function exigirVerValores(user: AuthUser) {
  if (user.categoria !== 'presidente' && !user.permissoes?.ver_financeiro) {
    throw new ForbiddenException('Seu perfil não tem "Ver valores em R$": quem tem pode mudar o preço.');
  }
}

const ator = (user: AuthUser) => ({ id: user.colaboradorId ?? null, perfil: user.categoria ?? null });

// "Conferir com os apps" (R3 F4a; mig 405): Delivery › Gestão do catálogo › "Conferir com os apps". A loja é a do topo da
// tela (`@UnidadeAtual()`; sem escolha, a única da empresa). Nasce desligada (direito `conferir_apps`, da distribuição).
// No servidor da loja, o serviço pede tudo à nuvem (V37).
@Controller('catalogo/conferencia')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('loja')
export class ConferenciaController {
  constructor(private readonly service: ConferenciaService) {}

  // A aba só aparece com o direito ligado.
  @Get('ligada')
  async ligada(@CurrentUser() user: AuthUser) {
    return { ligada: await this.service.ligada(user.tenantId) };
  }

  // A conferência de um app: lê ao abrir (no máximo uma vez por dia) e com `ler=1` ("Ler agora").
  @Get()
  @Roles(...QUEM_CONFERE)
  conferir(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Query('canal') canal: string, @Query('ler') ler?: string) {
    return this.service.conferir(user.tenantId, unidade, canal, ler === '1');
  }

  @Post('ignorar')
  @HttpCode(200)
  @Roles(...QUEM_CONFERE)
  ignorar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    return this.service.ignorar(user.tenantId, unidade, dto, ator(user));
  }

  @Post('desfazer')
  @HttpCode(200)
  @Roles(...QUEM_CONFERE)
  desfazer(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    return this.service.desfazer(user.tenantId, unidade, dto, ator(user));
  }

  @Post('usar-preco-do-app')
  @HttpCode(200)
  @Roles(...QUEM_CONFERE)
  usarPrecoDoApp(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    exigirVerValores(user);
    return this.service.usarPrecoDoApp(user.tenantId, unidade, dto, ator(user));
  }

  @Post('mandar-preco-ao-app')
  @HttpCode(200)
  @Roles(...QUEM_CONFERE)
  mandarPrecoAoApp(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    exigirVerValores(user);
    return this.service.mandarPrecoAoApp(user.tenantId, unidade, dto, ator(user));
  }

  @Post('tirar-do-app')
  @HttpCode(200)
  @Roles(...QUEM_CONFERE)
  tirarDoApp(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    return this.service.tirarDoApp(user.tenantId, unidade, dto, ator(user));
  }
}
