import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Redirect PÚBLICO rastreado do link da campanha (Fase 5b). O disparo manda um link
// .../publico/campanha/r/:envioId; aqui registramos o CLIQUE (uma vez por envio) e
// redirecionamos (302) para o link real da campanha. Sem auth (é o cliente clicando).
@Controller('publico/campanha')
@CloudOnly()
export class CampanhaPublicoController {
  constructor(private readonly service: CampanhaService) {}

  @Get('r/:id')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async redirect(@Param('id') id: string, @Res() res: Response) {
    let url: string | null = null;
    try {
      url = await this.service.registrarClique(id);
    } catch {
      /* segue para o fallback */
    }
    res.redirect(302, url || 'https://app.dmsregem.com');
  }
}
