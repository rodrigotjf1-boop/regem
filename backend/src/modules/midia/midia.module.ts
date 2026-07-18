import { Module } from '@nestjs/common';
import { MidiaController } from './midia.controller';
import { MidiaPublicoController } from './midia-publico.controller';
import { MidiaService } from './midia.service';
import { MidiaReconcileProcessor } from './midia-reconcile.processor';

@Module({
  controllers: [MidiaController, MidiaPublicoController],
  providers: [MidiaService, MidiaReconcileProcessor],
  exports: [MidiaService],
})
export class MidiaModule {}
