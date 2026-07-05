import { Module } from '@nestjs/common';
import { VendasController } from './vendas.controller';
import { VendasService } from './vendas.service';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { FiscalModule } from '../fiscal/fiscal.module';

@Module({
  imports: [ProducaoPedidoModule, FiscalModule],
  controllers: [VendasController],
  providers: [VendasService],
  exports: [VendasService],
})
export class VendasModule {}
