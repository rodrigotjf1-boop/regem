import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { NoticiasRamoService } from './noticias-ramo.service';

// NOTÍCIAS DO RAMO (fase N1). A tela: quem tem a permissão "Notícias do ramo" (o presidente sempre; o gerente só se o
// presidente liberar em Configurações › Acessos & perfis). A rota `loja` é só da nuvem, para o servidor da loja: a empresa
// vem do token do sincronismo, nunca do pedido.
@Controller('noticias-do-ramo')
export class NoticiasRamoController {
  constructor(private readonly noticias: NoticiasRamoService) {}

  @Get()
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('noticias_ramo')
  ler(@CurrentUser() user: AuthUser, @Query('dia') dia?: string) {
    return this.noticias.daTela(user.tenantId, dia);
  }

  @Get('loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  doServidorDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('dia') dia?: string) {
    return this.noticias.paraOServidorDaLoja(ctx.tenantId, dia);
  }
}
