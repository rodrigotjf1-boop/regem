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
import { EvolutionEntradaController } from './evolution-entrada.controller';
import { EvolutionEntradaService } from './evolution-entrada.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';

// WhatsApp da loja (Evolution): conectar/QR + resolver do bot multi-tenant.
// WhatsappCloudController/Service = API oficial (Meta Cloud API), via paralela —
// a loja escolhe em cardapio_config.provedor qual dos dois atende.
// WhatsappNumeroService = modelo novo de números por papel×provedor (mig 225).
// WhatsappCaixaController = a caixa de conversas (Delivery › WhatsApp) nas DUAS pontas: na nuvem atende, no servidor da
// loja repassa (este módulo também sobe lá — o PontoModule o importa). WhatsappDaLojaController = o lado da nuvem
// desse repasse (token do servidor).
@Module({
  imports: [EquipamentoModule],
  controllers: [
    WhatsappController,
    WhatsappCloudController,
    WhatsappCaixaController,
    WhatsappDaLojaController,
    RoboRespostaController,
    EvolutionEntradaController,
  ],
  providers: [
    RoboRespostaService,
    EvolutionEntradaService,
    WhatsappService,
    WhatsappCloudService,
    WhatsappProvedorService,
    WhatsappNumeroService,
    SyncTokenGuard,
    EmpresaDaLojaGuard,
  ],
  exports: [WhatsappService, WhatsappCloudService, WhatsappProvedorService, WhatsappNumeroService],
})
export class WhatsappModule {}
