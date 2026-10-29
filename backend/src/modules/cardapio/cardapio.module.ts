import { Module } from '@nestjs/common';
import {
  CardapioController,
  CardapioPublicoController,
} from './cardapio.controller';
import { CardapioService } from './cardapio.service';
import { OrigemPedidoService } from './origem-pedido.service';
import { EventosCardapioController } from './eventos-cardapio.controller';
import { EventosCardapioService } from './eventos-cardapio.service';
import { VendasModule } from '../vendas/vendas.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { CashbackModule } from '../cashback/cashback.module';
import { RoboConsultasController } from './robo-consultas.controller';

@Module({
  imports: [VendasModule, DeliveryModule, AtendimentoModule, FidelidadeModule, CashbackModule],
  controllers: [CardapioController, CardapioPublicoController, EventosCardapioController, RoboConsultasController],
  providers: [CardapioService, OrigemPedidoService, EventosCardapioService],
})
export class CardapioModule {}
