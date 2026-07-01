import { Module } from '@nestjs/common';
import { DesperdicioController } from './desperdicio.controller';
import { DesperdicioService } from './desperdicio.service';

@Module({
  controllers: [DesperdicioController],
  providers: [DesperdicioService],
})
export class DesperdicioModule {}
