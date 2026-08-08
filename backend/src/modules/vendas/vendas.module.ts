import { Module } from '@nestjs/common';
import { VendasController } from './vendas.controller';
import { VendasExternaController } from './vendas-externa.controller';
import { VendasService } from './vendas.service';
import { EdgeImpressaoProcessor } from './edge-impressao.processor';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';

@Module({
  imports: [ProducaoPedidoModule, FiscalModule, EquipamentoModule],
  controllers: [VendasController, VendasExternaController],
  providers: [VendasService, SyncTokenGuard, EdgeImpressaoProcessor],
  exports: [VendasService],
})
export class VendasModule {}
