import { Module } from '@nestjs/common';
import { EquipamentoController } from './equipamento.controller';
import { PareamentoController } from './pareamento.controller';
import { EquipamentoService } from './equipamento.service';

@Module({
  // PareamentoController é público de propósito: o PC ainda não tem sessão — é
  // isso que ele vem buscar. Protegido por código de uso único + rate-limit.
  controllers: [EquipamentoController, PareamentoController],
  providers: [EquipamentoService],
  exports: [EquipamentoService],
})
export class EquipamentoModule {}
