import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { PonteChatController } from './ponte-chat.controller';
import { PonteChatGuard } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';

// A ponte do chat do iFood e da 99 (mig 366). EquipamentoModule: a guarda confere o PC pareado (V81 — o guarda é
// resolvido no módulo do controlador, então o módulo que provê o EquipamentoService vem importado aqui).
@Module({
  imports: [EquipamentoModule],
  controllers: [PonteChatController],
  providers: [PonteChatService, PonteChatGuard],
  exports: [PonteChatService],
})
export class PonteChatModule {}
