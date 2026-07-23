import { Module } from '@nestjs/common';
import { EtiquetaValidadeController } from './etiqueta-validade.controller';
import { EtiquetaValidadeService } from './etiqueta-validade.service';

@Module({
  controllers: [EtiquetaValidadeController],
  providers: [EtiquetaValidadeService],
  exports: [EtiquetaValidadeService], // usado pelo job de alertas (JobsModule)
})
export class EtiquetaValidadeModule {}
