import { Body, Controller, Get, Header, HttpCode, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterPropostasService } from './mister-propostas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O LINK COM PIN DO MISTER (F4.2a de `docs/plano-mister.md`, mig 433; protótipo `mockups/regem-mister-pin.html`, aprovado
// em 16/11/2026). Rotas PÚBLICAS da página `/m/<código>`: sem login — a prova é o código do link (só o resumo dele fica
// no banco) mais o PIN de quem recebeu, conferido aqui no servidor. Cada endereço tem o seu limite por minuto, além das 5
// tentativas por link. Nada fica em cache (a resposta muda a cada passo). Só na nuvem.
@Controller('publico/mister/link')
@CloudOnly()
export class MisterLinkController {
  constructor(private readonly propostas: MisterPropostasService) {}

  @Get(':codigo')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  ver(@Param('codigo') codigo: string) {
    return this.propostas.verPeloLink(codigo);
  }

  @Post(':codigo/autorizar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  autorizar(@Param('codigo') codigo: string, @Body() dto: any) {
    return this.propostas.autorizarPeloLink(codigo, typeof dto?.pin === 'string' ? dto.pin : undefined);
  }

  @Post(':codigo/nao-autorizar')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  naoAutorizar(@Param('codigo') codigo: string) {
    return this.propostas.naoAutorizarPeloLink(codigo);
  }
}
