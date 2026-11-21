import { Body, Controller, Get, HttpCode, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { BannerIaService } from './banner-ia.service';
import { FOTO_DO_BANNER_MAX_BYTES } from './banner-ia.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O "Criar com IA" de Delivery › Configurações › Banners (B2; mig 485): quem edita os banners (presidente e gerente, como o
// `PUT /cardapio/banners`). Só nuvem: a ligação com o DMS Graph mora lá. Criar gasta a franquia de imagem da empresa.
@Controller('cardapio/banners/ia')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class BannerIaController {
  constructor(private readonly service: BannerIaService) {}

  @Get('situacao')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  situacao(@CurrentUser() user: AuthUser) {
    return this.service.situacao(user.tenantId);
  }

  @Post('melhorar')
  @HttpCode(200)
  @CloudOnly()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  melhorar(@CurrentUser() user: AuthUser, @Body() corpo: any) {
    return this.service.melhorar(user.tenantId, corpo);
  }

  // multipart/form-data: os campos do pedido e, opcional, o arquivo "file" (a foto de referência). O limite corta antes de bufferizar.
  @Post('criar')
  @HttpCode(200)
  @CloudOnly()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: FOTO_DO_BANNER_MAX_BYTES } }))
  criar(@CurrentUser() user: AuthUser, @Body() corpo: any, @UploadedFile() foto?: { buffer?: Buffer; size?: number }) {
    return this.service.criar(user, corpo, foto);
  }
}
