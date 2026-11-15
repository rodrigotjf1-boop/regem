import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { AvisosNaTelaService } from './avisos-na-tela.service';

// OS AVISOS NA TELA DA LOJA (F1.4). Nos DOIS lados:
//  • `GET /mister/avisos/abertos` — os avisos abertos da loja em uso, para QUALQUER perfil logado (o caixa, a cozinha, o
//    gerente), com o módulo Mister ligado. No servidor da loja, vêm da nuvem.
//  • `POST /mister/avisos/:id/ciente` — o "Ciente" de quem está logado.
// Só na NUVEM, para o servidor da loja (token do sincronismo; a empresa e a loja vêm do token, nunca do pedido):
//  • `GET /mister/avisos/loja` e `POST /mister/avisos/:id/ciente/loja`.
@Controller('mister/avisos')
export class AvisosNaTelaController {
  constructor(private readonly avisos: AvisosNaTelaService) {}

  @Get('abertos')
  @UseGuards(JwtAuthGuard, ModuloGuard)
  @RequireModulo('mister')
  abertos(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null) {
    return this.avisos.daLoja(user.tenantId, unidadeId ?? null, user.colaboradorId);
  }

  @Post(':id/ciente')
  @UseGuards(JwtAuthGuard, ModuloGuard)
  @RequireModulo('mister')
  ciente(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null, @Param('id') id: string) {
    return this.avisos.ciente(user.tenantId, unidadeId ?? null, user.colaboradorId, id);
  }

  @Get('loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  doServidorDaLoja(@SyncCtx() ctx: SyncCtxData) {
    return this.avisos.paraOServidorDaLoja(ctx.tenantId, ctx.unidadeId ?? null);
  }

  @Post(':id/ciente/loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  cienteDoServidorDaLoja(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() dto: { colaboradorId?: unknown }) {
    return this.avisos.cienteDoServidorDaLoja(ctx.tenantId, ctx.unidadeId ?? null, id, dto?.colaboradorId);
  }
}
