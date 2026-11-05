import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { Ponte, PonteChatGuard, PonteCtx } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PROGRAMA DA PONTE DO CHAT (mig 366) fala com a NUVEM por estas rotas — sem login de pessoa: quem prova é o PC
// pareado (`x-terminal-id` + `x-terminal-secret`, conferidos a cada chamada pela PonteChatGuard). Só nuvem: a fila, o
// robô e os ajustes moram lá (decisão do dono, 04/11/2026). Limite por aparelho, fora do balde do IP da loja (a guarda
// registra o segredo validado; ver CfThrottlerGuard).
@Controller('ponte-chat')
@CloudOnly()
@UseGuards(PonteChatGuard)
export class PonteChatController {
  constructor(private readonly ponte: PonteChatService) {}

  // O sinal de vida (a cada ~30 s): em quais plataformas a ponte está logada. Responde se a ponte está ligada nos
  // ajustes e, por canal, se esta ponte responde ou fica de reserva.
  @Post('estado')
  @HttpCode(200)
  estado(@Ponte() p: PonteCtx, @Body() dto: any) {
    return this.ponte.estado(p, dto);
  }

  // O que chegou no chat das plataformas (até 50 por vez): entra uma vez só e ligado ao pedido — só com a ponte LIGADA
  // nos ajustes (desligada, nada é gravado e a resposta diz `desligada: true`).
  @Post('mensagens')
  @HttpCode(200)
  mensagens(@Ponte() p: PonteCtx, @Body() dto: any) {
    return this.ponte.receber(p, dto);
  }

  // A vez na fila de saída de um canal (`{ canal: 'ifood' | '99food' }`).
  @Post('saida/pegar')
  @HttpCode(200)
  pegar(@Ponte() p: PonteCtx, @Body() dto: any) {
    return this.ponte.pegar(p, dto);
  }

  // Enviada (`{ ok: true, id }`) ou não (`{ ok: false, erro, definitivo? }`).
  @Post('saida/:id/resultado')
  @HttpCode(200)
  resultado(@Ponte() p: PonteCtx, @Param('id') id: string, @Body() dto: any) {
    return this.ponte.resultado(p, id, dto);
  }
}
