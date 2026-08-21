import { Module } from '@nestjs/common';
import { EntregadorController } from './entregador.controller';
import { EntregadorService } from './entregador.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { ClienteModule } from '../cliente/cliente.module';

// App do Entregador — só nuvem (CLOUD_ONLY em app.module). Reusa Delivery + Cliente.
@Module({
  imports: [DeliveryModule, ClienteModule],
  controllers: [EntregadorController],
  providers: [EntregadorService],
})
export class EntregadorModule {}
