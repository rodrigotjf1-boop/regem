import { Module } from '@nestjs/common';
import { CampanhaController } from './campanha.controller';
import { CampanhaPublicoController } from './campanha-publico.controller';
import { CampanhaService } from './campanha.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

// Só nuvem (CLOUD_ONLY em app.module) — o edge não dispara campanhas.
@Module({
  imports: [WhatsappModule],
  controllers: [CampanhaController, CampanhaPublicoController],
  providers: [CampanhaService],
})
export class CampanhaModule {}
