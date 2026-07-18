import { Module } from '@nestjs/common';
import { MidiaController } from './midia.controller';
import { MidiaPublicoController } from './midia-publico.controller';
import { MidiaService } from './midia.service';
import { MidiaReconcileProcessor } from './midia-reconcile.processor';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

@Module({
  imports: [EquipamentoModule],
  controllers: [MidiaController, MidiaPublicoController],
  providers: [MidiaService, MidiaReconcileProcessor, SyncTokenGuard],
  exports: [MidiaService],
})
export class MidiaModule {}
