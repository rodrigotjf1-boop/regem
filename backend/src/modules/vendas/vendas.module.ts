import { Module } from '@nestjs/common';
import { VendasController } from './vendas.controller';
import { VendasExternaController } from './vendas-externa.controller';
import { VendasService } from './vendas.service';
import { EdgeImpressaoProcessor } from './edge-impressao.processor';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { OrdemProducaoModule } from '../ordem-producao/ordem-producao.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { CredencialDoTotemGuard } from '../integracao-api/credencial-totem.guard';
import { GogemModule } from '../gogem/gogem.module';
import { ModuloModule } from '../modulo/modulo.module';

@Module({
  imports: [ProducaoPedidoModule, FiscalModule, EquipamentoModule, OrdemProducaoModule, GogemModule, ModuloModule],
  controllers: [VendasController, VendasExternaController],
  providers: [VendasService, SyncTokenGuard, CredencialDoTotemGuard, EdgeImpressaoProcessor],
  exports: [VendasService],
})
export class VendasModule {}
