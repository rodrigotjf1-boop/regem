import { Module } from '@nestjs/common';
import { ContagemController } from './contagem.controller';
import { ContagemService } from './contagem.service';

@Module({
  controllers: [ContagemController],
  providers: [ContagemService],
})
export class ContagemModule {}
