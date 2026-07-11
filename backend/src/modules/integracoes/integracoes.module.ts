import { Module, forwardRef } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { OpenDeliveryService } from './open-delivery/open-delivery.service';
import { OpenDeliveryPoller } from './open-delivery/open-delivery.poller';

// Integrações com marketplaces (Fase 1: Open Delivery / Cardápio Web).
// O poller ingere pedidos via DeliveryService; o DeliveryService usa o
// OpenDeliveryService para o status back (forwardRef p/ o ciclo).
@Module({
  imports: [forwardRef(() => DeliveryModule)],
  providers: [OpenDeliveryService, OpenDeliveryPoller],
  exports: [OpenDeliveryService],
})
export class IntegracoesModule {}
