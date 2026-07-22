import { Module, forwardRef } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { OpenDeliveryService } from './open-delivery/open-delivery.service';
import { OpenDeliveryPoller } from './open-delivery/open-delivery.poller';
import { CardapioWebService } from './cardapio-web/cardapio-web.service';
import { CardapioWebController } from './cardapio-web/cardapio-web.controller';
import { CardapioWebPoller } from './cardapio-web/cardapio-web.poller';
import { IfoodService } from './ifood/ifood.service';
import { IfoodPoller } from './ifood/ifood.poller';
import { Food99Service } from './food99/food99.service';
import { Food99Controller } from './food99/food99.controller';
import { Food99Poller } from './food99/food99.poller';

// Integrações com marketplaces (Fase 1: Open Delivery / Cardápio Web).
// O poller ingere pedidos via DeliveryService; o DeliveryService usa o
// OpenDeliveryService para o status back (forwardRef p/ o ciclo).
// Cardápio Web (API Aberta): OAuth authorization_code + PKCE (onboarding no
// controller); a ingestão de pedidos (webhook/adapter) entra na F2.
@Module({
  imports: [forwardRef(() => DeliveryModule)],
  controllers: [CardapioWebController, Food99Controller],
  providers: [OpenDeliveryService, OpenDeliveryPoller, CardapioWebService, CardapioWebPoller, IfoodService, IfoodPoller, Food99Service, Food99Poller],
  exports: [OpenDeliveryService, CardapioWebService, IfoodService, Food99Service],
})
export class IntegracoesModule {}
