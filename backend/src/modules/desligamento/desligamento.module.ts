import { Module } from '@nestjs/common';
import { EscalaModule } from '../escala/escala.module';
import { DesligamentoController } from './desligamento.controller';
import { DesligamentoService } from './desligamento.service';

@Module({
  imports: [EscalaModule], // reusa o motor de escala (aviso prévio)
  controllers: [DesligamentoController],
  providers: [DesligamentoService],
})
export class DesligamentoModule {}
