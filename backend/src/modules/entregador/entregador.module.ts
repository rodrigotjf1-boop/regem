import { Module } from '@nestjs/common';
import { EntregadorController } from './entregador.controller';
import { RastreioController } from './rastreio.controller';
import { EntregadorService } from './entregador.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { ClienteModule } from '../cliente/cliente.module';
import { PonteChatModule } from '../ponte-chat/ponte-chat.module';

// App do Entregador — só nuvem (CLOUD_ONLY em app.module). Reusa Delivery + Cliente. PonteChatModule: o "o entregador
// está chegando" no chat do iFood e da 99, pela ponte (parte A2).
@Module({
  imports: [DeliveryModule, ClienteModule, PonteChatModule],
  controllers: [EntregadorController, RastreioController],
  providers: [EntregadorService],
})
export class EntregadorModule {}
