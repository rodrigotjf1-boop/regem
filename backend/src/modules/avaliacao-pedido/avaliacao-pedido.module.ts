import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { NotaDoPedidoController, NotaDoPedidoPublicaController } from './nota-do-pedido.controller';
import { NotaDoPedidoService } from './nota-do-pedido.service';

// A nota do pedido pelo cliente (mig 453): a página do pedido (só nuvem) e Delivery › Avaliações (no servidor da loja,
// pede à nuvem). O `SyncTokenGuard` injeta o que o `EquipamentoModule` provê (V81).
@Module({
  imports: [EquipamentoModule],
  controllers: [NotaDoPedidoController, NotaDoPedidoPublicaController],
  providers: [NotaDoPedidoService, SyncTokenGuard],
})
export class AvaliacaoPedidoModule {}
