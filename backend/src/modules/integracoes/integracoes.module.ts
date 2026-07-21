import { Module, forwardRef } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { OpenDeliveryService } from './open-delivery/open-delivery.service';
import { OpenDeliveryPoller } from './open-delivery/open-delivery.poller';
import { CardapioWebService } from './cardapio-web/cardapio-web.service';
import { CardapioWebController } from './cardapio-web/cardapio-web.controller';
import { CardapioWebPoller } from './cardapio-web/cardapio-web.poller';

// Integrações com marketplaces (Fase 1: Open Delivery / Cardápio Web).
// O poller ingere pedidos via DeliveryService; o DeliveryService usa o
// OpenDeliveryService para o status back (forwardRef p/ o ciclo).
// Cardápio Web (API Aberta): OAuth authorization_code + PKCE (onboarding no
// controller); a ingestão de pedidos (webhook/adapter) entra na F2.
@Module({
  imports: [forwardRef(() => DeliveryModule)],
  controllers: [CardapioWebController],
  providers: [OpenDeliveryService, OpenDeliveryPoller, CardapioWebService, CardapioWebPoller],
  exports: [OpenDeliveryService, CardapioWebService],
})
export class IntegracoesModule {}
