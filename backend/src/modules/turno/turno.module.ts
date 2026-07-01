import { Module } from '@nestjs/common';
import { TurnoController } from './turno.controller';
import { TurnoService } from './turno.service';

@Module({
  controllers: [TurnoController],
  providers: [TurnoService],
})
export class TurnoModule {}
