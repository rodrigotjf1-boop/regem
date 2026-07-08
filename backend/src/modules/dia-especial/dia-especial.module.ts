import { Module } from '@nestjs/common';
import { DiaEspecialController } from './dia-especial.controller';
import { DiaEspecialService } from './dia-especial.service';

@Module({
  controllers: [DiaEspecialController],
  providers: [DiaEspecialService],
})
export class DiaEspecialModule {}
