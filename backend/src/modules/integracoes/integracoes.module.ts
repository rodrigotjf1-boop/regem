import { Module, forwardRef } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { OpenDeliveryService } from './open-delivery/open-delivery.service';
import { OpenDeliveryPoller } from './open-delivery/open-delivery.poller';
import { CardapioWebService } from './cardapio-web/cardapio-web.service';
import { CardapioWebController } from './cardapio-web/cardapio-web.controller';
import { CardapioWebPoller } from './cardapio-web/cardapio-web.poller';
import { IfoodService } from './ifood/ifood.service';
import { IfoodController } from './ifood/ifood.controller';
import { IfoodPoller } from './ifood/ifood.poller';
import { IfoodAvaliacoesPoller } from './ifood/ifood-avaliacoes.poller';
import { Food99Service } from './food99/food99.service';
import { Food99Controller } from './food99/food99.controller';
import { Food99Poller } from './food99/food99.poller';
import { Food99CatalogoEnvioService } from './food99/food99-catalogo-envio.service';
import { Food99LojaController } from './food99/food99-loja.controller';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { AnotaAiService } from './anotaai/anotaai.service';
import { AnotaAiController } from './anotaai/anotaai.controller';
import { AnotaAiPoller } from './anotaai/anotaai.poller';

// Integrações com marketplaces (Fase 1: Open Delivery / Cardápio Web).
// O poller ingere pedidos via DeliveryService; o DeliveryService usa o
// OpenDeliveryService para o status back (forwardRef p/ o ciclo).
// Cardápio Web (API Aberta): OAuth authorization_code + PKCE (onboarding no
// controller); a ingestão de pedidos (webhook/adapter) entra na F2.
@Module({
  // EquipamentoModule: o `SyncTokenGuard` da rota do servidor da loja (Food99LojaController) injeta o EquipamentoService (V81).
  imports: [forwardRef(() => DeliveryModule), EquipamentoModule],
  controllers: [CardapioWebController, Food99Controller, Food99LojaController, AnotaAiController, IfoodController],
  // IfoodAvaliacoesPoller: as avaliações do iFood viram caso na central (só nuvem, com o ajuste ligado — 06/11/2026).
  providers: [
    OpenDeliveryService,
    OpenDeliveryPoller,
    CardapioWebService,
    CardapioWebPoller,
    IfoodService,
    IfoodPoller,
    IfoodAvaliacoesPoller,
    Food99Service,
    Food99Poller,
    // O envio à 99 item a item (R3 F2; mig 402): preço, pausa, nome e descrição, pela fila `food99_envio` (só nuvem).
    Food99CatalogoEnvioService,
    AnotaAiService,
    AnotaAiPoller,
  ],
  exports: [OpenDeliveryService, CardapioWebService, IfoodService, Food99Service, AnotaAiService],
})
export class IntegracoesModule {}
