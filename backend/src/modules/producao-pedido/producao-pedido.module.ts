import { Module } from '@nestjs/common';
import { ProducaoPedidoController } from './producao-pedido.controller';
import { ProducaoPedidoService } from './producao-pedido.service';

@Module({
  controllers: [ProducaoPedidoController],
  providers: [ProducaoPedidoService],
  exports: [ProducaoPedidoService],
})
export class ProducaoPedidoModule {}
