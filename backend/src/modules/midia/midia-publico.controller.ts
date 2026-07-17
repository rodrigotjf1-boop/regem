import { Controller, Get, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import { MidiaService } from './midia.service';

// Serve as imagens gravadas em disco local (modo offline/edge). Público, sem auth
// — igual ao bucket público do Supabase. A validação anti-path-traversal fica no
// service (lerLocal). Na nuvem esta rota existe mas não é usada (URLs vão p/ o Supabase).
@Controller('publico/midia')
export class MidiaPublicoController {
  constructor(private readonly service: MidiaService) {}

  @Get(':tenant/:arquivo')
  async servir(
    @Param('tenant') tenant: string,
    @Param('arquivo') arquivo: string,
    @Res() res: Response,
  ) {
    const { buffer, mime } = await this.service.lerLocal(tenant, arquivo);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.end(buffer);
  }
}
