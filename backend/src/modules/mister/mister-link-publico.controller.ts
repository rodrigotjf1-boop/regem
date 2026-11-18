import { Controller, Get, Header, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MisterLinkPublicoService } from './mister-link-publico.service';

// O LINK PARA ENCAMINHAR DO MISTER (M3c, mig 443; decisão 7 da versão 3 do protótipo `mockups/regem-mister.html`). Rotas
// PÚBLICAS da página `/m/r/<código>`: sem login — a prova é o código do link (só o resumo dele fica no banco). O que sai é
// a FOTO do relatório que o presidente pediu, só para ler; nada da loja é lido ao vivo. Cada endereço tem o seu limite
// por minuto. Nada fica em cache (o link pode ser cancelado a qualquer hora). Só na nuvem.
@Controller('publico/mister/relatorio')
@CloudOnly()
export class MisterLinkPublicoController {
  constructor(private readonly links: MisterLinkPublicoService) {}

  @Get(':codigo')
  @Header('Cache-Control', 'no-store')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  ver(@Param('codigo') codigo: string) {
    return this.links.ver(codigo);
  }

  @Get(':codigo/pdf')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async pdf(@Param('codigo') codigo: string, @Res() res: Response) {
    const r = await this.links.pdf(codigo);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${r.nome}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(r.pdf);
  }
}
