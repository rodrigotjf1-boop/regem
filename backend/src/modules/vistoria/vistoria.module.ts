import { Module } from '@nestjs/common';
import { VistoriaController } from './vistoria.controller';
import { VistoriaService } from './vistoria.service';

@Module({
  controllers: [VistoriaController],
  providers: [VistoriaService],
})
export class VistoriaModule {}
