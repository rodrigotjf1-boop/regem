import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { GogemModule } from '../gogem/gogem.module';
import { PublicarIntegracoesController, PublicarIntegracoesLojaController } from './publicar-integracoes.controller';
import { PublicarIntegracoesService } from './publicar-integracoes.service';

/**
 * "Publicar nas integrações" (Cadastros › Cardápio): o GoGeM na hora, o pedido de leitura para quem lê pela porta e a
 * situação do iFood. Roda nos dois lados — no servidor da loja só repassa à nuvem (`SyncTokenGuard`, por isso o
 * `EquipamentoModule`; V81).
 */
@Module({
  imports: [EquipamentoModule, GogemModule],
  controllers: [PublicarIntegracoesController, PublicarIntegracoesLojaController],
  providers: [PublicarIntegracoesService],
})
export class PublicarIntegracoesModule {}
