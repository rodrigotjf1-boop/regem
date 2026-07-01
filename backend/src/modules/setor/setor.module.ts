import { Module } from '@nestjs/common';
import { SetorController } from './setor.controller';
import { SetorService } from './setor.service';

@Module({
  controllers: [SetorController],
  providers: [SetorService],
})
export class SetorModule {}
