import { Body, Controller, ForbiddenException, Get, HttpCode, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { QUEM_CONFERE } from './conferencia.service';
import { TaxasService } from './taxas.service';

/** As taxas, a margem e o faturamento são valores em R$: pedem "Ver valores em R$" (o presidente sempre). */
function exigirVerValores(user: AuthUser) {
  if (user.categoria !== 'presidente' && !user.permissoes?.ver_financeiro) {
    throw new ForbiddenException('Seu perfil não tem "Ver valores em R$": quem tem vê e muda as taxas e a margem.');
  }
}
const ator = (user: AuthUser) => ({ id: user.colaboradorId ?? null, perfil: user.categoria ?? null });

// "％ Taxas e margem" da loja do topo (R3 F5; mig 407): o que a calculadora de preço usa, e os números das vendas. No
// servidor da loja, o serviço pede à nuvem.
@Controller('catalogo/taxas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('loja')
export class TaxasController {
  constructor(private readonly service: TaxasService) {}

  @Get()
  @Roles(...QUEM_CONFERE)
  ler(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    exigirVerValores(user);
    return this.service.ler(user.tenantId, unidade, ator(user));
  }

  @Put()
  @Roles(...QUEM_CONFERE)
  salvar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: unknown) {
    exigirVerValores(user);
    return this.service.salvar(user.tenantId, unidade, dto, ator(user));
  }
}

// Os pedidos do SERVIDOR DA LOJA à nuvem sobre as taxas (V37): a tabela é só da nuvem. A empresa vem do token; quem pediu,
// do corpo (conferido na nuvem: ativo e da gestão). POST nos dois (a leitura também leva quem pediu). Só na nuvem.
@Controller('catalogo/taxas/loja')
export class TaxasLojaController {
  constructor(private readonly service: TaxasService) {}

  @Post('ler')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  ler(@SyncCtx() ctx: SyncCtxData, @Body() dto: unknown) {
    return this.service.vindoDaLoja(ctx.tenantId, ctx.unidadeId, 'GET', dto ?? {});
  }

  @Post()
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  salvar(@SyncCtx() ctx: SyncCtxData, @Body() dto: unknown) {
    return this.service.vindoDaLoja(ctx.tenantId, ctx.unidadeId, 'PUT', dto ?? {});
  }
}
