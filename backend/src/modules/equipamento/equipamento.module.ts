import { Module } from '@nestjs/common';
import { EquipamentoController } from './equipamento.controller';
import { PareamentoController } from './pareamento.controller';
import { EquipamentoService } from './equipamento.service';
import { PresencaService } from './presenca.service';

@Module({
  // PareamentoController é público de propósito: o PC ainda não tem sessão — é
  // isso que ele vem buscar. Protegido por código de uso único + rate-limit.
  controllers: [EquipamentoController, PareamentoController],
  // PresencaService: os PCs que falaram com o servidor da loja agora (app aberto e estação).
  providers: [EquipamentoService, PresencaService],
  exports: [EquipamentoService, PresencaService],
})
export class EquipamentoModule {}
