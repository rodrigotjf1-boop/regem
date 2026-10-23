import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { IntegracaoApiController } from './integracao-api.controller';
import { IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { CarimbadorIntegracaoService } from './carimbador-integracao.service';
import { CuponsIntegracaoService } from './cupons-integracao.service';
import { ClientesIntegracaoService } from './clientes-integracao.service';
import { WebhookIntegracaoService } from './webhook-integracao.service';
import { CatalogoIntegracaoService } from './catalogo-integracao.service';
import { ProducaoIntegracaoService } from './producao-integracao.service';
import { DmsIdController } from './dms-id.controller';
import { ManifestoController } from './manifesto.controller';
import { DmsIdService } from './dms-id.service';
import { LigacaoIntegracaoService } from './ligacao-integracao.service';
import { HubDmsService } from './hub-dms.service';
import { RegistroDaIntegracao } from './registro-da-integracao.middleware';

// API de integração por token de loja (trilha C) — SÓ NUVEM: está em `CLOUD_ONLY_IMPORTS`
// (app.module) e em `CLOUD_ONLY_MODULES` (edge-manifest), e o controller é `@CloudOnly()`.
// As tabelas (`integracao_token_loja`, mig 295; `integracao_versao`/`_mudanca`/`_carga`, mig 296;
// `integracao_cupom`/`_idempotencia`/`_carga_cupom`, mig 298; `integracao_webhook`, mig 304) nunca
// existem no servidor da loja; o carimbador e o job dos avisos são da nuvem (e se guardam com
// `ehServidorLocal()` mesmo assim). O serviço de tokens
// é exportado para o console da distribuição. O custo por item vem do `ProdutoService` (a função
// da Curva ABC) e a situação da conta do `LicencaService` (a regra do `LicenseInterceptor`), os
// dois resolvidos na hora pelo `ModuleRef`: os módulos deles já sobem no app, e importá-los aqui
// arrastaria os controllers deles.
//
// Hub DMS (F3, mig 329, `integracao_ligacao`, também só nuvem): a via do DMS ID ao lado do `rgm_it_` —
// o serviço que confere o token do DMS ID (exportado: o guard o pede onde o módulo for importado), a
// troca automática e os metadados do recurso. Nasce desligada (`DMS_ID_LIGADO`).
//
// Hub DMS (F3, parte A2, sem migration): o cliente do hub (registro de cada chamada, erros, batida e lista de
// parada; exportado para o guard) e o middleware que abre o registro de cada chamada de `/integracao/*`. Nasce
// desligado (`HUB_LIGADO`); a chave própria `ACEITAR_INTEGRACOES` vale sem o hub.
//
// Hub DMS (F4, parte A, sem migration): o manifesto da porta (Padrão §13), sem credencial, em
// `/.well-known/dms-manifesto` (`manifesto-integracao.ts`; o arquivo do repositório é `docs/dms-manifesto.json`).
@Module({
  controllers: [IntegracaoApiController, DmsIdController, ManifestoController],
  providers: [
    IntegracaoTokenService,
    IntegracaoTokenGuard,
    VendasIntegracaoService,
    CarimbadorIntegracaoService,
    CuponsIntegracaoService,
    // RegemCast (mig 302): a lista de clientes da empresa.
    ClientesIntegracaoService,
    // Avisos assinados para o sistema conectado (mig 304): registro pelas rotas + job de 15 s.
    WebhookIntegracaoService,
    // Farol (mig 315): o catálogo e as fichas, lidos na hora — sem versão, sem carimbador.
    CatalogoIntegracaoService,
    // Farol: a fila de produção, lida na hora (escopo `producao.ler`, aceito desde a mig 315).
    ProducaoIntegracaoService,
    // Hub DMS (F3, mig 329): o DMS ID e a troca automática do `rgm_it_` pela ligação.
    DmsIdService,
    LigacaoIntegracaoService,
    // Hub DMS (F3, A2): o registro central, os erros, a batida e a lista de parada.
    HubDmsService,
  ],
  exports: [IntegracaoTokenService, DmsIdService, HubDmsService],
})
export class IntegracaoApiModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RegistroDaIntegracao).forRoutes({ path: 'integracao/*', method: RequestMethod.ALL });
  }
}
