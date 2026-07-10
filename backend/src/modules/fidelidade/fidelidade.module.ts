import { Module } from '@nestjs/common';
import { FidelidadeService } from './fidelidade.service';
import { FidelidadeController } from './fidelidade.controller';

// Planos de fidelidade (L5). O motor de pontos é consumido pelo CardapioService
// no checkout; por isso o service é exportado.
@Module({
  controllers: [FidelidadeController],
  providers: [FidelidadeService],
  exports: [FidelidadeService],
})
export class FidelidadeModule {}
