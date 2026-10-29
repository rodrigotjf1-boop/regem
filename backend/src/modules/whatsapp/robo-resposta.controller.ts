import { Body, Controller, Get, Headers, HttpCode, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';
import { PedidoDeResposta, RoboRespostaService } from './robo-resposta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DO ROBÔ (n8n) e a mídia do cliente, uma porta para as duas vias — ver RoboRespostaService. Senha do robô no
// cabeçalho `x-regem-robo-segredo`. Só na nuvem.
@Controller('publico/bot')
@CloudOnly()
export class RoboRespostaController {
  constructor(private readonly service: RoboRespostaService) {}

  @Post('responder')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 300 } })
  responder(@Body() dto: PedidoDeResposta & { secret?: string }, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string) {
    return this.service.responder(segredoDaChamada(segredo, (dto as any)?.secret), dto ?? {});
  }

  // O arquivo da mídia (áudio para transcrever): API oficial por phoneNumberId + mediaId; Evolution por instancia +
  // mensagemId + jid (os três vêm na mensagem que o robô recebeu).
  @Get('midia')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async midia(
    @Query('instancia') instancia: string,
    @Query('phoneNumberId') phoneNumberId: string,
    @Query('mediaId') mediaId: string,
    @Query('mensagemId') mensagemId: string,
    @Query('jid') jid: string,
    @Res({ passthrough: true }) res: any,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    const { buffer, mime } = await this.service.midia(segredoDaChamada(segredo), { instancia, phoneNumberId, mediaId, mensagemId, jid });
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Length', String(buffer.length));
    return new StreamableFile(buffer);
  }
}
