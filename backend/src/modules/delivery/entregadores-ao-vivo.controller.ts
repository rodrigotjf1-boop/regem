import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { consultarAoVivo } from './entregadores-ao-vivo';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';

/**
 * Entregadores ao vivo nas telas da LOJA. Roda nos dois lados (o módulo do delivery vai para o
 * servidor da loja); no servidor da loja, a posição vem da nuvem (ver o serviço).
 *
 *  • `GET /delivery/entregadores-ao-vivo` — o Mapa ao vivo do delivery (gestão: presidente,
 *    gerente, supervisão com a permissão do delivery — a mesma regra de antes).
 *  • `GET /delivery/entregadores-ao-vivo/kds` — o mapa no KDS: quem opera o KDS (módulo KDS
 *    ativo), mas SÓ se o gestor ligou a chave da loja (mig 293). Desligada, responde
 *    `habilitado:false` sem nenhuma posição — a tela esconde a opção.
 *  • `GET /delivery/entregadores-ao-vivo/loja` — o servidor da loja pedindo à nuvem (token de
 *    sync). A loja vem do token, nunca do pedido.
 */
@Controller('delivery/entregadores-ao-vivo')
export class EntregadoresAoVivoController {
  constructor(
    private readonly aoVivo: EntregadoresAoVivoService,
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
  ) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  painel(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.aoVivo.daLoja(user.tenantId, unidadeId ?? null);
  }

  @Get('kds')
  @UseGuards(JwtAuthGuard, ModuloGuard)
  @RequireModulo('kds')
  async kds(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    const u = unidadeId ?? null;
    if (!(await this.aoVivo.mapaNoKdsLigado(user.tenantId, u)))
      return { habilitado: false, centro: null, entregadores: [] };
    return { habilitado: true, ...(await this.aoVivo.daLoja(user.tenantId, u)) };
  }

  @Get('loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  async loja(@SyncCtx() ctx: SyncCtxData) {
    return { tenantId: ctx.tenantId, ...(await consultarAoVivo(this.db, ctx.tenantId, ctx.unidadeId ?? null)) };
  }
}
