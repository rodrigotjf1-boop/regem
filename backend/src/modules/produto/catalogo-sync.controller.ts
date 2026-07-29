import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ProdutoService } from './produto.service';
import { PausaSyncDto } from './dto/pausa-sync.dto';

// L-CAT-2 — leitura de catálogo autenticada por DISPOSITIVO (X-Sync-Token),
// não por JWT de usuário. É o endpoint que o GoGeM usa para importar o catálogo
// do Regem (de-para por código PDV). Tenant/unidade vêm do dispositivo, nunca da
// query/body. Somente leitura.
@Controller('sync')
export class CatalogoSyncController {
  constructor(private readonly service: ProdutoService) {}

  @Get('catalogo')
  @UseGuards(SyncTokenGuard)
  catalogo(@SyncCtx() ctx: SyncCtxData) {
    return this.service.catalogoParaSync(ctx.tenantId, ctx.unidadeId ?? null);
  }

  // L-PAUSA — pausa/despausa de item por CANAL vinda do dispositivo (totem/GoGeM).
  // Casa por código PDV; escreve em `canais_pausados` (não afeta outros canais).
  @Post('produtos/pausa')
  @UseGuards(SyncTokenGuard)
  pausar(@SyncCtx() ctx: SyncCtxData, @Body() dto: PausaSyncDto) {
    return this.service.pausarCanalPorCodigo(
      ctx.tenantId,
      dto.codigoPdv,
      dto.canal ?? 'gogem',
      dto.pausado,
    );
  }
}
