import { Module } from '@nestjs/common';
import { LicencaService } from './licenca.service';
import { LicencaController } from './licenca.controller';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { DistribuidorGuard } from '../../auth/distribuidor.guard';
import { EdgeModule } from '../edge/edge.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { InatividadeProcessor } from './inatividade.processor';

// Licença por lease + revenda + telemetria de frota (edge appliance).
// Importa EquipamentoModule e provê o SyncTokenGuard (usado nas rotas /edge/*),
// que depende do EquipamentoService — como faz o DeliveryModule.
// O InatividadeProcessor é a rotina diária da NUVEM que desliga a empresa inativa há 2 meses (nasce desligada).
@Module({
  imports: [EquipamentoModule, EdgeModule],
  controllers: [LicencaController],
  providers: [LicencaService, SyncTokenGuard, DistribuidorGuard, InatividadeProcessor],
  exports: [LicencaService],
})
export class LicencaModule {}
