import { Module } from '@nestjs/common';
import { VigiaProcessor } from './vigia.processor';
import { VigiaService } from './vigia.service';

// O vigia do servidor da loja (F1.1 do plano do Mister, mig 414). Só NUVEM (CLOUD_ONLY em app.module): quem recebe o
// sinal de todos os servidores é a nuvem, e a tabela dos episódios só existe lá. Sem rota e sem tela nesta entrega.
@Module({
  providers: [VigiaService, VigiaProcessor],
  exports: [VigiaService],
})
export class VigiaModule {}
