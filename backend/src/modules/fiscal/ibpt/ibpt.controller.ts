import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CloudOnly } from '../../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../../sync/sync-token.guard';
import { IbptService } from './ibpt.service';

/**
 * A tabela do IBPT da UF para o SERVIDOR DA LOJA (token de sync). Só a nuvem serve: é ela que
 * recebe o arquivo no console da distribuição. `?tenho=versão|chave|fim da vigência` → 204 quando
 * não mudou; 404 quando a nuvem ainda não tem tabela vigente para a UF.
 */
@CloudOnly()
@Controller('fiscal/ibpt')
export class IbptController {
  constructor(private readonly ibpt: IbptService) {}

  @Get(':uf')
  @UseGuards(SyncTokenGuard)
  async tabelaDaUf(
    @Param('uf') uf: string,
    @Query('tenho') tenho: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.ibpt.pacoteParaLoja(uf, tenho);
    if (p === null) throw new NotFoundException('A nuvem não tem tabela do IBPT vigente para esta UF.');
    if (p === 'igual') {
      res.status(204);
      return;
    }
    return p;
  }

  /**
   * A tabela PRÓPRIA da empresa do servidor (token do IBPT do lojista, mig 292). A empresa é a do
   * token de sync — nunca um parâmetro. `?tenho=versão|chave|fim|linhas` → 204 quando não mudou;
   * 404 = a empresa não tem tabela própria vigente (o servidor apaga a cópia dele).
   */
  @Get(':uf/propria')
  @UseGuards(SyncTokenGuard)
  async tabelaPropria(
    @SyncCtx() ctx: SyncCtxData,
    @Param('uf') uf: string,
    @Query('tenho') tenho: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const p = await this.ibpt.pacotePropriaParaLoja(ctx.tenantId, uf, tenho);
    if (p === null) throw new NotFoundException('A empresa não tem tabela própria do IBPT vigente para esta UF.');
    if (p === 'igual') {
      res.status(204);
      return;
    }
    return p;
  }
}
