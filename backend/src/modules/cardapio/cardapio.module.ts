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
import { LembreteDoCarrinhoProcessor } from './lembrete-do-carrinho.processor';
import { AvisoDaMudancaProcessor } from './aviso-da-mudanca.processor';
import { EstornoPixService } from './estorno-pix.service';
import { EstornoPixProcessor } from './estorno-pix.processor';
import { ChegadaModule } from '../chegada/chegada.module';
import { AniversarioModule } from '../aniversario/aniversario.module';

@Module({
  // WhatsappModule: o resumo do pedido feito pelo robô sai por escrito pela via da loja (robo-pedido.service.ts).
  // ChegadaModule: o "Cheguei" da página do pedido (mig 354).
  // AniversarioModule: o cupom pessoal e o "só aniversariantes" (mig 357).
  imports: [VendasModule, DeliveryModule, AtendimentoModule, FidelidadeModule, CashbackModule, WhatsappModule, ChegadaModule, AniversarioModule],
  controllers: [CardapioController, CardapioPublicoController, EventosCardapioController, RoboConsultasController, RoboPedidoController],
  // LembreteDoCarrinhoProcessor: o lembrete do pedido que ficou pela metade no robô (mig 349; só nuvem).
  // AvisoDaMudancaProcessor: a decisão do servidor da loja sobre a mudança pedida pelo robô chega ao cliente (mig 363; só nuvem).
  // EstornoPixService/Processor: o estorno do Pix no cancelamento do pedido pago online (mig 372; só nuvem).
  providers: [CardapioService, OrigemPedidoService, EventosCardapioService, RoboPedidoService, LembreteDoCarrinhoProcessor, AvisoDaMudancaProcessor, EstornoPixService, EstornoPixProcessor],
})
export class CardapioModule {}
