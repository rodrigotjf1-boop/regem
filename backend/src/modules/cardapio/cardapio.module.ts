import { Module } from '@nestjs/common';
import {
  CardapioController,
  CardapioPublicoController,
} from './cardapio.controller';
import { CardapioService } from './cardapio.service';
import { VendasModule } from '../vendas/vendas.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { AtendimentoModule } from '../atendimento/atendimento.module';

@Module({
  imports: [VendasModule, DeliveryModule, AtendimentoModule],
  controllers: [CardapioController, CardapioPublicoController],
  providers: [CardapioService],
})
export class CardapioModule {}
