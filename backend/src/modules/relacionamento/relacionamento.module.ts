import { Module } from '@nestjs/common';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { RelacionamentoController, RelacionamentoPublicoController } from './relacionamento.controller';
import { RelacionamentoService } from './relacionamento.service';

// As automáticas de Delivery › Marketing (Onda 3, mig 356). Só NUVEM (CLOUD_ONLY em app.module): o WhatsApp e o cardápio
// moram lá; a loja não tem as tabelas. A auditoria é global.
@Module({
  imports: [WhatsappModule],
  controllers: [RelacionamentoController, RelacionamentoPublicoController],
  providers: [RelacionamentoService],
  exports: [RelacionamentoService],
})
export class RelacionamentoModule {}
