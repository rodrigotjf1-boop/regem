import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ConferenciaService } from './conferencia.service';

// Os pedidos do SERVIDOR DA LOJA à nuvem sobre "Conferir com os apps" (V37): as credenciais do Orzuni e da 99 só existem
// na nuvem. Autenticação pelo token do servidor (x-sync-token) — a empresa vem do token, nunca do corpo; o servidor de UMA
// loja só confere aquela loja. Quem agiu vem no corpo e é conferido aqui (colaborador ativo e da gestão). Só na nuvem.
@Controller('catalogo/conferencia/loja')
export class ConferenciaLojaController {
  constructor(private readonly service: ConferenciaService) {}

  @Get()
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  conferir(@SyncCtx() ctx: SyncCtxData, @Query() q: { canal?: string; unidade?: string; ler?: string }) {
    return this.service.conferirVindoDaLoja(ctx.tenantId, ctx.unidadeId, q ?? {});
  }

  @Post(':acao')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  async agir(@SyncCtx() ctx: SyncCtxData, @Param('acao') acao: string, @Body() dto: unknown) {
    return { tenantId: ctx.tenantId, ...(await this.service.agirVindoDaLoja(ctx.tenantId, ctx.unidadeId, acao, dto)) };
  }
}
