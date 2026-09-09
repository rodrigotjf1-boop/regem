import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappNumeroService } from './whatsapp-numero.service';

// WhatsApp da loja (Evolution): conectar/QR + resolver do bot multi-tenant.
// WhatsappCloudController/Service = API oficial (Meta Cloud API), via paralela —
// a loja escolhe em cardapio_config.provedor qual dos dois atende.
// WhatsappNumeroService = modelo novo de números por papel×provedor (mig 225).
@Module({
  controllers: [WhatsappController, WhatsappCloudController],
  providers: [WhatsappService, WhatsappCloudService, WhatsappProvedorService, WhatsappNumeroService],
  exports: [WhatsappService, WhatsappCloudService, WhatsappProvedorService, WhatsappNumeroService],
})
export class WhatsappModule {}
