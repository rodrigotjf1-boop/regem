import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DespachoPublicoController } from './despacho-publico.controller';
import { DeliveryLojaController } from './delivery-loja.controller';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { TotemExpiracaoProcessor } from './totem-expiracao.processor';
import { CloudFallbackProcessor } from './cloud-fallback.processor';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { VendasModule } from '../vendas/vendas.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { CashbackModule } from '../cashback/cashback.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { GogemModule } from '../gogem/gogem.module';

@Module({
  imports: [
    EquipamentoModule,
    VendasModule,
    ProducaoPedidoModule,
    CashbackModule,
    FidelidadeModule,
    forwardRef(() => IntegracoesModule),
    GogemModule,
  ],
  controllers: [DeliveryController, DespachoPublicoController, DeliveryLojaController],
  providers: [DeliveryService, SyncTokenGuard, EdgePedidosProcessor,
    TotemExpiracaoProcessor, CloudFallbackProcessor],
  exports: [DeliveryService],
})
export class DeliveryModule {}
