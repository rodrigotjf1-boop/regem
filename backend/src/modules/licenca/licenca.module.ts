import { Module } from '@nestjs/common';
import { LicencaService } from './licenca.service';
import { LicencaController } from './licenca.controller';

// Licença por lease + revenda + telemetria de frota (edge appliance).
@Module({
  controllers: [LicencaController],
  providers: [LicencaService],
  exports: [LicencaService],
})
export class LicencaModule {}
