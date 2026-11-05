import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { PonteChatController } from './ponte-chat.controller';
import { PonteChatGuard } from './ponte-chat.guard';
import { PonteChatService } from './ponte-chat.service';
import { AvisosDoChatService } from './avisos-do-chat.service';
import { AvisosDoChatProcessor } from './avisos-do-chat.processor';
import { AjustesDaPonteService } from './ajustes-da-ponte.service';

// A ponte do chat do iFood e da 99 (mig 366). EquipamentoModule: a guarda confere o PC pareado (V81 — o guarda é
// resolvido no módulo do controlador, então o módulo que provê o EquipamentoService vem importado aqui). DeliveryModule:
// a previsão "20h15" do aviso "saiu" (a conta do rastreio). O EntregadorModule importa este (o "chegando" pela cerca) e o
// AtendimentoModule também (o grupo dos ajustes e a faixa da fila).
@Module({
  imports: [EquipamentoModule, DeliveryModule],
  controllers: [PonteChatController],
  providers: [PonteChatService, PonteChatGuard, AvisosDoChatService, AvisosDoChatProcessor, AjustesDaPonteService],
  exports: [PonteChatService, AvisosDoChatService, AjustesDaPonteService],
})
export class PonteChatModule {}
