import { Module } from '@nestjs/common';
import { PedidoTravaController } from './pedido-trava.controller';
import { PedidoTravaService } from './pedido-trava.service';

// A trava do pedido enquanto o cliente altera (mig 517). O serviço é usado pelo robô (trava e encerra), pelo Delivery e
// pela produção/KDS (recusam o "Pronto"/"Despachar" com a trava valendo) e pela rota "Liberar o pedido".
@Module({
  controllers: [PedidoTravaController],
  providers: [PedidoTravaService],
  exports: [PedidoTravaService],
})
export class PedidoTravaModule {}
