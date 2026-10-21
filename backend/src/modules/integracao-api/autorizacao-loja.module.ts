import { Module } from '@nestjs/common';
import { IntegracaoApiModule } from './integracao-api.module';
import { AutorizacaoLojaController, AutorizacaoTokenController } from './autorizacao-loja.controller';
import { AutorizacaoLojaService } from './autorizacao-loja.service';
import { AutorizacaoCliqueService } from './autorizacao-clique.service';

// Autorização PELA LOJA (trilha C, C1b — mig 303 `integracao_autorizacao`, SÓ NUVEM): a página
// "Autorizar o Liame", a troca do código pelos tokens das lojas e a tela "Aplicativos conectados".
// Está em `CLOUD_ONLY_IMPORTS` (app.module) e em `CLOUD_ONLY_MODULES` (edge-manifest), e os dois
// controllers são `@CloudOnly()`.
//
// Módulo À PARTE do `IntegracaoApiModule` (de onde vem o serviço de tokens): as rotas daqui usam a
// SESSÃO do Regem (`JwtAuthGuard` e `RolesGuard`, do `AuthModule` global), e a API de integração por
// token não depende dela — nem os testes que a sobem sozinha.
//
// Hub DMS (F3, parte C, mig 336): a autorização POR CLIQUE (o pedido empurrado com o token do DMS ID, a página com a
// senha e uma ligação por loja na troca) mora aqui também, com as rotas de sessão e a mesma troca; nasce desligada
// (`AUTORIZACAO_POR_CLIQUE`).
@Module({
  imports: [IntegracaoApiModule],
  controllers: [AutorizacaoLojaController, AutorizacaoTokenController],
  providers: [AutorizacaoLojaService, AutorizacaoCliqueService],
})
export class AutorizacaoLojaModule {}
