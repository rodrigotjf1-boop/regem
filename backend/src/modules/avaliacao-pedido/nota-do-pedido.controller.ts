import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { NotaDoPedidoService } from './nota-do-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A loja pedida pelo servidor da loja: um id válido, ou nenhuma (= todas). A empresa vem do token. */
const unidadeDaConsulta = (u: unknown): string | null => (typeof u === 'string' && UUID_RE.test(u) ? u : null);

// DELIVERY › AVALIAÇÕES (mig 453, fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`). Quem tem Delivery (a
// permissão do painel); o gerente vê a loja dele (`@UnidadeAtual`), o presidente a escolhida ou todas. No servidor da loja,
// a lista vem da nuvem pela rota `avaliacoes-da-loja` (o token do servidor; só na nuvem).
@Controller('delivery')
export class NotaDoPedidoController {
  constructor(private readonly notas: NotaDoPedidoService) {}

  @Get('avaliacoes')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  lista(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Query('periodo') periodo?: string) {
    return this.notas.lista(user.tenantId, atual ?? null, periodo);
  }

  @Get('avaliacoes-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  daLoja(@SyncCtx() ctx: SyncCtxData, @Query() q: { periodo?: string; unidade?: string }) {
    return this.notas.listaNaNuvem(ctx.tenantId, unidadeDaConsulta(q?.unidade), q?.periodo);
  }
}

// A NOTA PELA PÁGINA DO PEDIDO (`/r/…`, sem login): só pelo token do link do rastreio — a página roda na nuvem. Sem
// `JwtAuthGuard`, como o rastreio; o limite de chamadas é o global da API.
@Controller('rastreio')
export class NotaDoPedidoPublicaController {
  constructor(private readonly notas: NotaDoPedidoService) {}

  @Get(':token/avaliacao')
  @CloudOnly()
  estado(@Param('token') token: string) {
    return this.notas.estadoPublico(token);
  }

  @Post(':token/avaliacao')
  @CloudOnly()
  @HttpCode(200)
  avaliar(@Param('token') token: string, @Body() dto: any) {
    return this.notas.avaliarPelaPagina(token, dto);
  }
}
