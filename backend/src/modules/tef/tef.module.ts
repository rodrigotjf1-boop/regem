import { Module } from '@nestjs/common';
import { TefController } from './tef.controller';
import { TefService } from './tef.service';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

@Module({
  imports: [EquipamentoModule],
  controllers: [TefController],
  providers: [TefService, SyncTokenGuard],
})
export class TefModule {}
