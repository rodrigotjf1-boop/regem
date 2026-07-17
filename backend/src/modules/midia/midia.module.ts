import { Module } from '@nestjs/common';
import { MidiaController } from './midia.controller';
import { MidiaPublicoController } from './midia-publico.controller';
import { MidiaService } from './midia.service';

@Module({
  controllers: [MidiaController, MidiaPublicoController],
  providers: [MidiaService],
  exports: [MidiaService],
})
export class MidiaModule {}
