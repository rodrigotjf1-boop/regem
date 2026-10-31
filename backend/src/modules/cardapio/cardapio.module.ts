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
import { RoboPedidoController } from './robo-pedido.controller';
import { RoboPedidoService } from './robo-pedido.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  // WhatsappModule: o resumo do pedido feito pelo robô sai por escrito pela via da loja (robo-pedido.service.ts).
  imports: [VendasModule, DeliveryModule, AtendimentoModule, FidelidadeModule, CashbackModule, WhatsappModule],
  controllers: [CardapioController, CardapioPublicoController, EventosCardapioController, RoboConsultasController, RoboPedidoController],
  providers: [CardapioService, OrigemPedidoService, EventosCardapioService, RoboPedidoService],
})
export class CardapioModule {}
