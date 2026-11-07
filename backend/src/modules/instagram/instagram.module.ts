import { Module } from '@nestjs/common';
import { InstagramService } from './instagram.service';
import { InstagramController, InstagramPublicoController } from './instagram.controller';

// O INSTAGRAM DIRECT (mig 377) e o ROBÔ NO DIRECT (mig 378) num módulo só: o atendimento (a conversa e os ajustes), a
// resposta do robô (WhatsappModule › robo-resposta) e o "chamar atendente" do cardápio usam o MESMO serviço. Antes ele
// morava no AtendimentoModule — que já importa o WhatsappModule: a resposta do robô de lá daria um ciclo. Só o banco, o
// tempo real e a auditoria (globais).
@Module({
  controllers: [InstagramPublicoController, InstagramController],
  providers: [InstagramService],
  exports: [InstagramService],
})
export class InstagramModule {}
