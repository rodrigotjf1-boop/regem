import { Module } from '@nestjs/common';
import { MessengerService } from './messenger.service';
import { MessengerController, MessengerPublicoController } from './messenger.controller';

// O MESSENGER DO FACEBOOK (mig 386) num módulo só, como o InstagramModule: o atendimento (os ajustes, a conversa do caso e
// da loja, "Conversas agora"), a resposta do robô (WhatsappModule › robo-resposta) e o "chamar atendente" do cardápio usam
// o MESMO serviço. Só o banco, o tempo real e a auditoria (globais) — nenhum outro módulo (sem ciclo).
@Module({
  controllers: [MessengerPublicoController, MessengerController],
  providers: [MessengerService],
  exports: [MessengerService],
})
export class MessengerModule {}
