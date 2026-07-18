import { Module } from '@nestjs/common';
import { EdgeService } from './edge.service';
import { EdgeController } from './edge.controller';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

// Servidor local (edge): descoberta na LAN (mDNS) + rota /ping de identificação
// + telemetria de erro (autenticada por x-sync-token via SyncTokenGuard).
@Module({
  imports: [EquipamentoModule],
  controllers: [EdgeController],
  providers: [EdgeService, SyncTokenGuard],
  exports: [EdgeService],
})
export class EdgeModule {}
