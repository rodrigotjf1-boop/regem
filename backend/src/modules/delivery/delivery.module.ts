import { Module } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { VendasModule } from '../vendas/vendas.module';

@Module({
  imports: [EquipamentoModule, VendasModule],
  controllers: [DeliveryController],
  providers: [DeliveryService, SyncTokenGuard],
})
export class DeliveryModule {}
