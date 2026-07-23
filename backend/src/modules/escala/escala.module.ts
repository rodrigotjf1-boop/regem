import { Module } from '@nestjs/common';
import { EscalaController } from './escala.controller';
import { EscalaService } from './escala.service';

@Module({
  controllers: [EscalaController],
  providers: [EscalaService],
  exports: [EscalaService], // desligamento (aviso prévio) reusa o motor de escala
})
export class EscalaModule {}
