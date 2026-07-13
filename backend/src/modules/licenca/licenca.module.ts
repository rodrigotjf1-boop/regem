import { Module } from '@nestjs/common';
import { LicencaService } from './licenca.service';
import { LicencaController } from './licenca.controller';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { DistribuidorGuard } from '../../auth/distribuidor.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';

// Licença por lease + revenda + telemetria de frota (edge appliance).
// Importa EquipamentoModule e provê o SyncTokenGuard (usado nas rotas /edge/*),
// que depende do EquipamentoService — como faz o DeliveryModule.
@Module({
  imports: [EquipamentoModule],
  controllers: [LicencaController],
  providers: [LicencaService, SyncTokenGuard, DistribuidorGuard],
  exports: [LicencaService],
})
export class LicencaModule {}
