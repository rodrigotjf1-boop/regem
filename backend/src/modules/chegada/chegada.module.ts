import { Module } from '@nestjs/common';
import { ChegadaLojaController, ChegadaPublicoController } from './chegada.controller';
import { ChegadaService } from './chegada.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';

// "Cheguei" na retirada (Onda 3, mig 354). Módulo próprio e sem dependência dos outros (só o banco e a auditoria, que é
// global): o WhatsApp (só nuvem), o Delivery, o KDS, o cardápio online e o atendimento importam este — e nenhum ciclo.
// Equipamento + SyncTokenGuard: a rota da nuvem que o servidor da loja chama (V81).
@Module({
  imports: [EquipamentoModule],
  controllers: [ChegadaPublicoController, ChegadaLojaController],
  providers: [ChegadaService, SyncTokenGuard],
  exports: [ChegadaService],
})
export class ChegadaModule {}
