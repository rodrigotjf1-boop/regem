import { Module } from '@nestjs/common';
import { ProducaoController } from './producao.controller';
import { ProducaoService } from './producao.service';

@Module({
  controllers: [ProducaoController],
  providers: [ProducaoService],
})
export class ProducaoModule {}
