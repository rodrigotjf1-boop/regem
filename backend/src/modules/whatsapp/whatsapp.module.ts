import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';
import { WhatsappController } from './whatsapp.controller';
import { WhatsappCloudController } from './whatsapp-cloud.controller';

// WhatsApp da loja (Evolution): conectar/QR + resolver do bot multi-tenant.
// WhatsappCloudController = webhook da API oficial (Meta Cloud API), via paralela.
@Module({
  controllers: [WhatsappController, WhatsappCloudController],
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
