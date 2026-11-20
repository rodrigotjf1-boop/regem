import { Module } from '@nestjs/common';
import { PulsoService } from './pulso.service';

// O Regem lê o Pulso (F7 parte 4 do perfil do cliente; mig 470). Só as rotinas: nasce desligado (`PULSO_LIGACAO`).
@Module({
  providers: [PulsoService],
  exports: [PulsoService],
})
export class PulsoModule {}
