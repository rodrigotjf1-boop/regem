import { Module } from '@nestjs/common';
import { EscalaController } from './escala.controller';
import { EscalaService } from './escala.service';

@Module({
  controllers: [EscalaController],
  providers: [EscalaService],
})
export class EscalaModule {}
