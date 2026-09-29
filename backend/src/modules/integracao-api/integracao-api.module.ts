import { Module } from '@nestjs/common';
import { IntegracaoApiController } from './integracao-api.controller';
import { IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';

// API de integração por token de loja (trilha C) — SÓ NUVEM: está em `CLOUD_ONLY_IMPORTS`
// (app.module) e em `CLOUD_ONLY_MODULES` (edge-manifest), e o controller é `@CloudOnly()`.
// A tabela (`integracao_token_loja`, mig 295) nunca existe no servidor da loja. O serviço é
// exportado para o console da distribuição emitir e revogar os tokens.
@Module({
  controllers: [IntegracaoApiController],
  providers: [IntegracaoTokenService, IntegracaoTokenGuard],
  exports: [IntegracaoTokenService],
})
export class IntegracaoApiModule {}
