import { Module, forwardRef } from '@nestjs/common';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoLojaController } from './atendimento-loja.controller';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService } from './disputa-ifood.service';
import { Pedido99Service } from './pedido-99.service';
import { ChatIfoodService } from './chat-ifood.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';

@Module({
  // Integrações: a resposta à disputa do iFood (IfoodService). forwardRef: integrações e delivery já se referem.
  // Equipamento + SyncTokenGuard: as rotas que o servidor da loja chama na nuvem (AtendimentoLojaController), como no Delivery.
  imports: [DeliveryModule, forwardRef(() => IntegracoesModule), EquipamentoModule],
  controllers: [AtendimentoController, AtendimentoLojaController],
  // Pedido99Service: a resposta ao pedido do cliente da 99 e a rotina da nuvem (cancelamento vencido, reembolso recusado).
  // ChatIfoodService: a configuração do chat oficial do iFood (o widget da distribuição e as lojas do iFood).
  providers: [AtendimentoService, DisputaIfoodService, Pedido99Service, ChatIfoodService, SyncTokenGuard],
  exports: [AtendimentoService],
})
export class AtendimentoModule {}
