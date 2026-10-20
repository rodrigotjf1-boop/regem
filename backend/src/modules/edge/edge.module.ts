import { Module } from '@nestjs/common';
import { EdgeService } from './edge.service';
import { EdgeController } from './edge.controller';
import { RedeLocalService } from './rede-local.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

// Servidor local (edge): descoberta na LAN (mDNS) + rota /ping de identificação
// + telemetria de erro (autenticada por x-sync-token via SyncTokenGuard)
// + o endereço do servidor na rede e a presença dos PCs (conexão PC ↔ servidor).
@Module({
  imports: [EquipamentoModule],
  controllers: [EdgeController],
  providers: [EdgeService, SyncTokenGuard, RedeLocalService],
  exports: [EdgeService],
})
export class EdgeModule {}
