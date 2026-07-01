import { Module } from '@nestjs/common';
import { UnidadeController } from './unidade.controller';
import { UnidadeService } from './unidade.service';

@Module({
  controllers: [UnidadeController],
  providers: [UnidadeService],
})
export class UnidadeModule {}
