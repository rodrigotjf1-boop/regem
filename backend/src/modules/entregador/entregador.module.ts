import { Module } from '@nestjs/common';
import { EntregadorController } from './entregador.controller';
import { RastreioController } from './rastreio.controller';
import { EntregadorService } from './entregador.service';
import { ChatDoEntregadorService } from './chat-do-entregador.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { ClienteModule } from '../cliente/cliente.module';
import { PonteChatModule } from '../ponte-chat/ponte-chat.module';

// App do Entregador — só nuvem (CLOUD_ONLY em app.module). Reusa Delivery + Cliente. PonteChatModule: o "o entregador
// está chegando" no chat do iFood e da 99, pela ponte (parte A2), e o chat do entregador com o cliente (09/11/2026).
@Module({
  imports: [DeliveryModule, ClienteModule, PonteChatModule],
  controllers: [EntregadorController, RastreioController],
  providers: [EntregadorService, ChatDoEntregadorService],
})
export class EntregadorModule {}
