import { Module } from '@nestjs/common';
import { ImpressaoController } from './impressao.controller';
import { ImpressaoSinalService } from './impressao-sinal.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { FilaImpressaoGuard } from './fila-impressao.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';

@Module({
  imports: [EquipamentoModule, ProducaoPedidoModule],
  controllers: [ImpressaoController],
  providers: [SyncTokenGuard, FilaImpressaoGuard, ImpressaoSinalService],
})
export class ImpressaoModule {}
