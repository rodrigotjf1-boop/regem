import { Module } from '@nestjs/common';
import { EtiquetaController } from './etiqueta.controller';
import { EtiquetaService } from './etiqueta.service';

@Module({
  controllers: [EtiquetaController],
  providers: [EtiquetaService],
})
export class EtiquetaModule {}
