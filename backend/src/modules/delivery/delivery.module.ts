import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { VendasModule } from '../vendas/vendas.module';
import { CashbackModule } from '../cashback/cashback.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';

@Module({
  imports: [
    EquipamentoModule,
    VendasModule,
    CashbackModule,
    FidelidadeModule,
    forwardRef(() => IntegracoesModule),
  ],
  controllers: [DeliveryController],
  providers: [DeliveryService, SyncTokenGuard],
  exports: [DeliveryService],
})
export class DeliveryModule {}
