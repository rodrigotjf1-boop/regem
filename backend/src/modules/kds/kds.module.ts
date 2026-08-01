import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../db/drizzle.module';
import { KdsAlertaService } from './kds-alerta.service';
import { KdsAlertaController } from './kds-alerta.controller';

// Módulo do KDS — por ora, o motor de alertas do rodapé (Fase B). A fila de produção
// e o avanço continuam no ProducaoService/DeliveryService.
@Module({
  imports: [DrizzleModule],
  controllers: [KdsAlertaController],
  providers: [KdsAlertaService],
})
export class KdsModule {}
