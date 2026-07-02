import { Module } from '@nestjs/common';
import { DiretoriaController } from './diretoria.controller';
import { DiretoriaService } from './diretoria.service';

@Module({
  controllers: [DiretoriaController],
  providers: [DiretoriaService],
})
export class DiretoriaModule {}
