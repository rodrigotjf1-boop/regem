import { Module } from '@nestjs/common';
import { ModuloController } from './modulo.controller';
import { ModuloService } from './modulo.service';

@Module({
  controllers: [ModuloController],
  providers: [ModuloService],
  exports: [ModuloService],
})
export class ModuloModule {}
