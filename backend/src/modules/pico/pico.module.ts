import { Module } from '@nestjs/common';
import { PicoController } from './pico.controller';
import { PicoService } from './pico.service';

@Module({
  controllers: [PicoController],
  providers: [PicoService],
})
export class PicoModule {}
