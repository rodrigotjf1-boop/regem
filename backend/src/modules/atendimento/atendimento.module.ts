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
import { AvisarOEntregadorService } from './avisar-o-entregador.service';
import { GestorWhatsappService } from './gestor-whatsapp.service';
import { CopilotoService } from './copiloto.service';
import { NumerosDoAtendimentoService } from './numeros.service';
import { InstagramModule } from '../instagram/instagram.module';
import { MessengerModule } from '../messenger/messenger.module';
import { TreinoDoAtendenteController } from './treino.controller';
import { TreinoDoAtendenteService } from './treino.service';

@Module({
  // Integrações: a resposta à disputa do iFood (IfoodService). forwardRef: integrações e delivery já se referem.
  // Equipamento + SyncTokenGuard: as rotas que o servidor da loja chama na nuvem (AtendimentoLojaController), como no Delivery.
  // ChegadaModule: o grupo "Retirada · cliente chegou" dos ajustes (mig 354).
  // ProducaoPedidoModule: o grupo "Pedido alterado" dos ajustes — o som do KDS mora no ajuste do KDS (mig 362).
  // WhatsappModule: "Endereço atualizado!" ao cliente pela via da conversa (PR 3b-2) — o módulo já sobe com o Delivery.
  // PonteChatModule: o grupo "iFood e 99 · chat pela ponte" dos ajustes e a faixa da ponte na fila (mig 366, parte A2).
  // InstagramModule (migs 377/378): o Direct — o grupo dos ajustes, a conversa do caso e da loja, e "Conversas agora".
  // MessengerModule (mig 386): o Messenger do Facebook — o grupo dos ajustes, a conversa do caso e da loja, "Conversas agora".
  imports: [DeliveryModule, forwardRef(() => IntegracoesModule), EquipamentoModule, ChegadaModule, ProducaoPedidoModule, WhatsappModule, PonteChatModule, InstagramModule, MessengerModule],
  // AtendimentoAppController: o app "Regem Atendimento" (mig 353) — entrar com o PIN e "Disponível / Ocupado". O
  // AuthService vem do AuthModule (global); o EquipamentoService, do EquipamentoModule (o celular pareado).
  // TreinoDoAtendenteController (mig 382): "Testar o atendente" e "O que ele aprendeu" (gerente e presidente, só a nuvem).
  controllers: [AtendimentoController, AtendimentoLojaController, AtendimentoAppController, TreinoDoAtendenteController],
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
    // CopilotoService (mig 376): a sugestão de resposta no caso, pelo modelo de IA da distribuição (só a nuvem).
    CopilotoService,
    // NumerosDoAtendimentoService (item 8): o placar, as reclamações por motivo e produto e o "O que aconteceu?" do caso.
    NumerosDoAtendimentoService,
    // TreinoDoAtendenteService (mig 382): a conversa de teste com o robô de verdade e o que ele aprendeu (só o banco e a
    // auditoria, que é global).
    TreinoDoAtendenteService,
    // AvisarOEntregadorService (mig 391): "Avisar o entregador" pelo caso — o aviso chega no app do entregador.
    AvisarOEntregadorService,
  ],
  exports: [AtendimentoService],
})
export class AtendimentoModule {}
