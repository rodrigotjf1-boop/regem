import { Module, forwardRef } from '@nestjs/common';
import { PonteChatModule } from '../ponte-chat/ponte-chat.module';
import { AtendimentoController } from './atendimento.controller';
import { AtendimentoLojaController } from './atendimento-loja.controller';
import { AtendimentoService } from './atendimento.service';
import { DisputaIfoodService } from './disputa-ifood.service';
import { AvaliacaoIfoodService } from './avaliacao-ifood.service';
import { Pedido99Service } from './pedido-99.service';
import { ChatIfoodService } from './chat-ifood.service';
import { AtendimentoAppController } from './atendimento-app.controller';
import { AtendimentoAppService } from './atendimento-app.service';
import { FilaEAvisosService } from './fila-e-avisos.service';
import { DeliveryModule } from '../delivery/delivery.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { ChegadaModule } from '../chegada/chegada.module';
import { PedidoRepetidoService } from '../pedido-repetido/pedido-repetido.service';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { AvisoDoEnderecoProcessor } from './aviso-do-endereco.processor';
import { ChatDoCasoService } from './chat-do-caso.service';
import { GestorWhatsappService } from './gestor-whatsapp.service';

@Module({
  // Integrações: a resposta à disputa do iFood (IfoodService). forwardRef: integrações e delivery já se referem.
  // Equipamento + SyncTokenGuard: as rotas que o servidor da loja chama na nuvem (AtendimentoLojaController), como no Delivery.
  // ChegadaModule: o grupo "Retirada · cliente chegou" dos ajustes (mig 354).
  // ProducaoPedidoModule: o grupo "Pedido alterado" dos ajustes — o som do KDS mora no ajuste do KDS (mig 362).
  // WhatsappModule: "Endereço atualizado!" ao cliente pela via da conversa (PR 3b-2) — o módulo já sobe com o Delivery.
  // PonteChatModule: o grupo "iFood e 99 · chat pela ponte" dos ajustes e a faixa da ponte na fila (mig 366, parte A2).
  imports: [DeliveryModule, forwardRef(() => IntegracoesModule), EquipamentoModule, ChegadaModule, ProducaoPedidoModule, WhatsappModule, PonteChatModule],
  // AtendimentoAppController: o app "Regem Atendimento" (mig 353) — entrar com o PIN e "Disponível / Ocupado". O
  // AuthService vem do AuthModule (global); o EquipamentoService, do EquipamentoModule (o celular pareado).
  controllers: [AtendimentoController, AtendimentoLojaController, AtendimentoAppController],
  // Pedido99Service: a resposta ao pedido do cliente da 99 e a rotina da nuvem (cancelamento vencido, reembolso recusado).
  // ChatIfoodService: a configuração do chat oficial do iFood (o widget da distribuição e as lojas do iFood).
  // FilaEAvisosService (mig 353): o aviso ao gerente (rotina da nuvem) e os ajustes "Fila e avisos".
  // PedidoRepetidoService (mig 360): o grupo "Pedido repetido" dos ajustes (só o banco e a auditoria, que é global).
  // AvisoDoEnderecoProcessor (PR 3b-2): "Endereço atualizado!" ao cliente quando a mudança feita pelo caso vale (só a nuvem).
  // ChatDoCasoService (ponte do chat, Etapa 2): a conversa do iFood e da 99 no caso e a resposta da equipe pela ponte.
  // AvaliacaoIfoodService (06/11/2026): a resposta à avaliação do iFood pelo caso.
  providers: [
    AtendimentoService,
    DisputaIfoodService,
    AvaliacaoIfoodService,
    Pedido99Service,
    ChatIfoodService,
    SyncTokenGuard,
    AtendimentoAppService,
    FilaEAvisosService,
    PedidoRepetidoService,
    AvisoDoEnderecoProcessor,
    ChatDoCasoService,
    // GestorWhatsappService (mig 375): Gerente no WhatsApp — ligar o número do gestor e a rotina dos avisos (só a nuvem).
    GestorWhatsappService,
  ],
  exports: [AtendimentoService],
})
export class AtendimentoModule {}
