import { Module } from '@nestjs/common';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { SyncTokenGuard } from './sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

@Module({
  imports: [EquipamentoModule],
  controllers: [SyncController],
  providers: [SyncService, SyncTokenGuard],
})
export class SyncModule {}
