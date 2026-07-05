import { Module } from '@nestjs/common';
import { ImpressaoController } from './impressao.controller';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';

@Module({
  imports: [EquipamentoModule, ProducaoPedidoModule],
  controllers: [ImpressaoController],
  providers: [SyncTokenGuard],
})
export class ImpressaoModule {}
