import { Module } from '@nestjs/common';
import { EntregadorController } from './entregador.controller';
import { EntregadorService } from './entregador.service';

// App do Entregador (E0) — só nuvem (CLOUD_ONLY em app.module).
@Module({
  controllers: [EntregadorController],
  providers: [EntregadorService],
})
export class EntregadorModule {}
