import { Body, Controller, Headers, HttpCode, Post, ServiceUnavailableException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';
import { CardapioService } from './cardapio.service';
import { VozDoAtendenteService } from './voz-do-atendente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VOZ DO ATENDENTE (fase A, 27/11/2026 — `voz-do-atendente.ts`): o fluxo do n8n (2.7) manda o texto que vai virar voz, o
// tom de quem falou (a linha "TOM:" da transcrição) e a pergunta; o Regem pede a fala ao DMS Graph, na voz feminina, com
// o estilo e as pausas. A resposta traz o áudio no MESMO campo do Google (`audioContent`): o nó seguinte do fluxo não muda.
// Sem a voz (loja sem o Graph, franquia, demora, Graph antigo): 503 com o motivo, e o fluxo segue pela reserva (a voz de
// antes) e, depois, pelo texto. A senha do robô SÓ no cabeçalho `x-regem-robo-segredo` (nunca na URL — ERR-318). Só na nuvem.
@Controller('publico/bot')
@CloudOnly()
export class RoboVozController {
  constructor(
    private readonly cardapio: CardapioService,
    private readonly voz: VozDoAtendenteService,
  ) {}

  @Post('voz')
  @HttpCode(200)
  // O mesmo teto das outras consultas do robô: uma fala por resposta em áudio.
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async falar(@Body() b: any, @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string) {
    const corpo = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
    const texto = typeof corpo.texto === 'string' ? corpo.texto : '';
    const tom = typeof corpo.tom === 'string' ? corpo.tom : '';
    const pergunta = typeof corpo.pergunta === 'string' ? corpo.pergunta : '';
    const instancia = typeof corpo.instancia === 'string' ? corpo.instancia : undefined;
    const phoneNumberId = typeof corpo.phoneNumberId === 'string' ? corpo.phoneNumberId : undefined;
    const token = await this.cardapio.tokenDaLojaDoRobo(segredoDaChamada(segredo), instancia, phoneNumberId);
    const r = await this.voz.falar(token, { texto, tom, pergunta });
    if ('audioContent' in r) return r;
    throw new ServiceUnavailableException({ message: 'A voz não saiu agora: responda pela voz de reserva ou pelo texto.', motivo: r.motivo });
  }
}
