import { Module } from '@nestjs/common';
import { DrizzleModule } from '../../db/drizzle.module';
import { ModuloModule } from '../modulo/modulo.module';
import { KdsAlertaService } from './kds-alerta.service';
import { KdsAlertaController } from './kds-alerta.controller';
import { AlertaKdsService } from './alerta-kds.service';
import { FarolAlertasService } from './farol-alertas.service';
import { KdsAvisosController } from './kds-avisos.controller';

// Módulo do KDS — o motor de alertas do rodapé (Fase B), os avisos GUARDADOS (onda 3 da auditoria do KDS, mig 412: todo
// aviso passa pelo `AlertaKdsService`, que guarda e manda às telas) e o transporte dos alertas do Farol (só na nuvem).
// A fila de produção e o avanço continuam no ProducaoService/DeliveryService.
@Module({
  imports: [DrizzleModule, ModuloModule],
  controllers: [KdsAlertaController, KdsAvisosController],
  providers: [KdsAlertaService, AlertaKdsService, FarolAlertasService],
  exports: [AlertaKdsService],
})
export class KdsModule {}
