import { Module } from '@nestjs/common';
import { VendasController } from './vendas.controller';
import { VendasService } from './vendas.service';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';

@Module({
  imports: [ProducaoPedidoModule],
  controllers: [VendasController],
  providers: [VendasService],
})
export class VendasModule {}
