import { Module } from '@nestjs/common';
import { ProducaoController } from './producao.controller';
import { ProducaoService } from './producao.service';

@Module({
  controllers: [ProducaoController],
  providers: [ProducaoService],
  exports: [ProducaoService], // usado pela ordem de produção (mig 130)
})
export class ProducaoModule {}
