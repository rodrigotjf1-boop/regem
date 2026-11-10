import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappNumeroService } from './whatsapp-numero.service';
import { EmpresaDaLojaGuard, WhatsappDaLojaController } from './whatsapp-da-loja.controller';
import { WhatsappCaixaController } from './whatsapp-caixa.controller';
import { RoboRespostaController } from './robo-resposta.controller';
import { RoboRespostaService } from './robo-resposta.service';
import { PausaNoAtendimentoService } from './pausa-no-atendimento.service';
import { EvolutionEntradaController } from './evolution-entrada.controller';
import { EvolutionEntradaService } from './evolution-entrada.service';
import { ConferirEntregaProcessor } from './conferir-entrega.processor';
import { PedirAvaliacaoProcessor } from './pedir-avaliacao.processor';
import { AvaliacaoPublicaController } from './avaliacao-publica.controller';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { InstagramModule } from '../instagram/instagram.module';
import { MessengerModule } from '../messenger/messenger.module';

// WhatsApp da loja (Evolution): conectar/QR + resolver do bot multi-tenant.
// WhatsappCloudController/Service = API oficial (Meta Cloud API), via paralela —
// a loja escolhe em cardapio_config.provedor qual dos dois atende.
// WhatsappNumeroService = modelo novo de números por papel×provedor (mig 225).
// WhatsappCaixaController = a caixa de conversas (Delivery › WhatsApp) nas DUAS pontas: na nuvem atende, no servidor da
// loja repassa (este módulo também sobe lá — o PontoModule o importa). WhatsappDaLojaController = o lado da nuvem
// desse repasse (token do servidor).
// InstagramModule (mig 378): a resposta do robô no Direct do Instagram sai pelo mesmo `publico/bot/responder`.
// MessengerModule (mig 386): idem para o Messenger do Facebook (chave `fb:`).
@Module({
  imports: [EquipamentoModule, InstagramModule, MessengerModule],
  controllers: [
    WhatsappController,
    WhatsappCloudController,
    WhatsappCaixaController,
    WhatsappDaLojaController,
    RoboRespostaController,
    EvolutionEntradaController,
    // O link do pedido de avaliação (mig 365): anota o toque e leva ao Google (só nuvem).
    AvaliacaoPublicaController,
  ],
  providers: [
    RoboRespostaService,
    EvolutionEntradaService,
    WhatsappService,
    WhatsappCloudService,
    WhatsappProvedorService,
    WhatsappNumeroService,
    // A rotina do "Chegou tudo certo?" depois da entrega (B1; mig 352; só nuvem, só API oficial).
    ConferirEntregaProcessor,
    // A rotina do "Pedir avaliação" depois da entrega (mig 365; só nuvem, só API oficial).
    PedirAvaliacaoProcessor,
    SyncTokenGuard,
    EmpresaDaLojaGuard,
    // A pausa dos pedidos no atendimento (F3, migs 394/395): a 1ª mensagem do cliente na pausa recebe a mensagem pronta.
    PausaNoAtendimentoService,
  ],
  exports: [WhatsappService, WhatsappCloudService, WhatsappProvedorService, WhatsappNumeroService],
})
export class WhatsappModule {}
