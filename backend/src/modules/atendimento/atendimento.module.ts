import { Module } from '@nestjs/common';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoService } from './atendimento.service';
import { DeliveryModule } from '../delivery/delivery.module';

@Module({
  imports: [DeliveryModule],
  controllers: [AtendimentoController],
  providers: [AtendimentoService],
  exports: [AtendimentoService],
})
export class AtendimentoModule {}
