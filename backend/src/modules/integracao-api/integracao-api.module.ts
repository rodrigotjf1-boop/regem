import { Module } from '@nestjs/common';
import { IntegracaoApiController } from './integracao-api.controller';
import { IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { CarimbadorIntegracaoService } from './carimbador-integracao.service';
import { CuponsIntegracaoService } from './cupons-integracao.service';

// API de integração por token de loja (trilha C) — SÓ NUVEM: está em `CLOUD_ONLY_IMPORTS`
// (app.module) e em `CLOUD_ONLY_MODULES` (edge-manifest), e o controller é `@CloudOnly()`.
// As tabelas (`integracao_token_loja`, mig 295; `integracao_versao`/`_mudanca`/`_carga`, mig 296;
// `integracao_cupom`/`_idempotencia`/`_carga_cupom`, mig 298) nunca existem no servidor da loja; o
// carimbador é job da nuvem (e se guarda com `ehServidorLocal()` mesmo assim). O serviço de tokens
// é exportado para o console da distribuição. O custo por item vem do `ProdutoService` (a função
// da Curva ABC) e a situação da conta do `LicencaService` (a regra do `LicenseInterceptor`), os
// dois resolvidos na hora pelo `ModuleRef`: os módulos deles já sobem no app, e importá-los aqui
// arrastaria os controllers deles.
@Module({
  controllers: [IntegracaoApiController],
  providers: [
    IntegracaoTokenService,
    IntegracaoTokenGuard,
    VendasIntegracaoService,
    CarimbadorIntegracaoService,
    CuponsIntegracaoService,
  ],
  exports: [IntegracaoTokenService],
})
export class IntegracaoApiModule {}
