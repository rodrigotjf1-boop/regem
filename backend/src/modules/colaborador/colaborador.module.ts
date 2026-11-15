import { Module } from '@nestjs/common';
import { ColaboradorController } from './colaborador.controller';
import { ColaboradorService } from './colaborador.service';
import { PrefsController } from './prefs.controller';
import { PrefsService } from './prefs.service';

@Module({
  controllers: [ColaboradorController, PrefsController],
  providers: [ColaboradorService, PrefsService],
  // Vagas (F4, "Contratar") cria o colaborador pelo MESMO cadastro — RBAC de nível e auditoria daqui.
  exports: [ColaboradorService],
})
export class ColaboradorModule {}
