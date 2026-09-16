import { Module } from '@nestjs/common';
import { EtiquetaValidadeController } from './etiqueta-validade.controller';
import { EtiquetaValidadeService } from './etiqueta-validade.service';
import { DesperdicioModule } from '../desperdicio/desperdicio.module';

@Module({
  imports: [DesperdicioModule],
  controllers: [EtiquetaValidadeController],
  providers: [EtiquetaValidadeService],
  exports: [EtiquetaValidadeService], // usado pelo job de alertas (JobsModule)
})
export class EtiquetaValidadeModule {}
