import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCloudController } from './whatsapp-cloud.controller';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';

// WhatsApp da loja (Evolution): conectar/QR + resolver do bot multi-tenant.
// WhatsappCloudController/Service = API oficial (Meta Cloud API), via paralela —
// a loja escolhe em cardapio_config.provedor qual dos dois atende.
@Module({
  controllers: [WhatsappController, WhatsappCloudController],
  providers: [WhatsappService, WhatsappCloudService, WhatsappProvedorService],
  exports: [WhatsappService, WhatsappCloudService, WhatsappProvedorService],
})
export class WhatsappModule {}
