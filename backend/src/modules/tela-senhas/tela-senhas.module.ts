import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ModuloModule } from '../modulo/modulo.module';
import { TelaSenhasController, TelaSenhasPublicoController } from './tela-senhas.controller';
import { TelaSenhasGuard } from './tela-senhas.guard';
import { TelaSenhasService } from './tela-senhas.service';

// Tela de senhas (Cozinha em estações, entrega 4): a TV do balcão com Preparando e Pronto (mig 337).
@Module({
  imports: [EquipamentoModule, ModuloModule], // validarTela (a guarda) e o módulo KDS ligado
  controllers: [TelaSenhasPublicoController, TelaSenhasController],
  providers: [TelaSenhasService, TelaSenhasGuard],
  exports: [TelaSenhasService],
})
export class TelaSenhasModule {}
