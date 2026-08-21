import { Module } from '@nestjs/common';
import { EntregadorController } from './entregador.controller';
import { EntregadorService } from './entregador.service';
import { DeliveryModule } from '../delivery/delivery.module';

// App do Entregador — só nuvem (CLOUD_ONLY em app.module). Reusa o DeliveryService.
@Module({
  imports: [DeliveryModule],
  controllers: [EntregadorController],
  providers: [EntregadorService],
})
export class EntregadorModule {}
