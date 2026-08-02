import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DespachoPublicoController } from './despacho-publico.controller';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { CloudFallbackProcessor } from './cloud-fallback.processor';
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
  controllers: [DeliveryController, DespachoPublicoController],
  providers: [DeliveryService, SyncTokenGuard, EdgePedidosProcessor, CloudFallbackProcessor],
  exports: [DeliveryService],
})
export class DeliveryModule {}
