import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DespachoPublicoController } from './despacho-publico.controller';
import { DeliveryLojaController } from './delivery-loja.controller';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { TotemExpiracaoProcessor } from './totem-expiracao.processor';
import { CloudFallbackProcessor } from './cloud-fallback.processor';
import { PedidoEnvioProcessor } from './pedido-envio.processor';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { VendasModule } from '../vendas/vendas.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { CashbackModule } from '../cashback/cashback.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { GogemModule } from '../gogem/gogem.module';
import { ModuloModule } from '../modulo/modulo.module';
import { EntregadoresAoVivoController } from './entregadores-ao-vivo.controller';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';

@Module({
  imports: [
    EquipamentoModule,
    VendasModule,
    ProducaoPedidoModule,
    CashbackModule,
    FidelidadeModule,
    forwardRef(() => IntegracoesModule),
    GogemModule,
    ModuloModule, // ModuloGuard (@RequireModulo('kds')) do mapa no KDS precisa do ModuloService
  ],
  controllers: [DeliveryController, DespachoPublicoController, DeliveryLojaController,
    EntregadoresAoVivoController],
  providers: [DeliveryService, SyncTokenGuard, EdgePedidosProcessor,
    TotemExpiracaoProcessor, CloudFallbackProcessor, PedidoEnvioProcessor, EntregadoresAoVivoService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
