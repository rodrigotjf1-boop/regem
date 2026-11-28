import { Module } from '@nestjs/common';
import {
  CardapioController,
  CardapioPublicoController,
} from './cardapio.controller';
import { CardapioService } from './cardapio.service';
import { OrigemPedidoService } from './origem-pedido.service';
import { EventosCardapioController } from './eventos-cardapio.controller';
import { EventosCardapioService } from './eventos-cardapio.service';
import { DiasEspeciaisController } from './dias-especiais.controller';
import { DiasEspeciaisService } from './dias-especiais.service';
import { DiasEspeciaisPausaService } from './dias-especiais-pausa.service';
import { VendasModule } from '../vendas/vendas.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { CashbackModule } from '../cashback/cashback.module';
import { RoboConsultasController } from './robo-consultas.controller';
import { RoboPedidoController } from './robo-pedido.controller';
import { RoboPedidoService } from './robo-pedido.service';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { LembreteDoCarrinhoProcessor } from './lembrete-do-carrinho.processor';
import { AvisoDaMudancaProcessor } from './aviso-da-mudanca.processor';
import { EstornoPixService } from './estorno-pix.service';
import { EstornoPixProcessor } from './estorno-pix.processor';
import { AdicionalPixService } from './adicional-pix.service';
import { AdicionalPixProcessor } from './adicional-pix.processor';
import { ComprovanteDoClienteService } from './comprovante-do-cliente.service';
import { FotoDoClienteService } from './foto-do-cliente.service';
import { IaModule } from '../ia/ia.module';
import { ChegadaModule } from '../chegada/chegada.module';
import { AniversarioModule } from '../aniversario/aniversario.module';
import { InstagramModule } from '../instagram/instagram.module';
import { MessengerModule } from '../messenger/messenger.module';
import { ModuloModule } from '../modulo/modulo.module';
import { GraphModule } from '../graph/graph.module';
import { MidiaModule } from '../midia/midia.module';
import { BannerIaController } from './banner-ia.controller';
import { BannerIaService } from './banner-ia.service';
import { RoboVozController } from './robo-voz.controller';
import { VozDoAtendenteService } from './voz-do-atendente.service';
import { PedidoTravaModule } from '../pedido-trava/pedido-trava.module';

@Module({
  // WhatsappModule: o resumo do pedido feito pelo robô sai por escrito pela via da loja (robo-pedido.service.ts).
  // ChegadaModule: o "Cheguei" da página do pedido (mig 354).
  // AniversarioModule: o cupom pessoal e o "só aniversariantes" (mig 357).
  // InstagramModule (mig 378): o "chamar atendente" do robô no Direct do Instagram abre o caso do Direct.
  // MessengerModule (mig 386): o "chamar atendente" do robô no Messenger abre o caso do Messenger; as consultas pela chave fb:.
  // ModuloModule (F3 de Vagas): o robô só manda o link da página de vagas com o módulo "vagas" ligado na loja.
  // IaModule: a leitura da foto do cliente fala com o modelo pela porta única da IA da empresa (o medidor de uso).
  // GraphModule (mig 450): a foto vai primeiro ao DMS Graph, com a ligação da empresa; a IA da empresa fica de reserva.
  imports: [VendasModule, DeliveryModule, AtendimentoModule, FidelidadeModule, CashbackModule, WhatsappModule, ChegadaModule, AniversarioModule, InstagramModule, MessengerModule, ModuloModule, IaModule, GraphModule, MidiaModule, PedidoTravaModule],
  // DiasEspeciaisController (mig 512, H1): os dias especiais do horário da loja.
  // RoboVozController (27/11, fase A do "atendente com o jeito do Mister"): a voz do atendente pelo DMS Graph.
  controllers: [CardapioController, BannerIaController, CardapioPublicoController, EventosCardapioController, RoboConsultasController, RoboPedidoController, DiasEspeciaisController, RoboVozController],
  // LembreteDoCarrinhoProcessor: o lembrete do pedido que ficou pela metade no robô (mig 349; só nuvem).
  // AvisoDaMudancaProcessor: a decisão do servidor da loja sobre a mudança pedida pelo robô chega ao cliente (mig 363; só nuvem).
  // EstornoPixService/Processor: o estorno do Pix no cancelamento do pedido pago online (mig 372; só nuvem).
  // AdicionalPixService/Processor: o Pix do item que o robô põe no pedido já pago (mig 373; só nuvem). O alerta da
  // Central lê a tabela direto (`adicional-pix-alertas.ts`) — o Atendimento não importa este módulo (ele importa o dele).
  providers: [
    CardapioService,
    // O "Criar com IA" dos banners (B2, mig 485): a imagem pelo DMS Graph, guardada na mídia da empresa.
    BannerIaService,
    OrigemPedidoService,
    EventosCardapioService,
    DiasEspeciaisService,
    // H3 dos dias especiais: a pausa sozinha do iFood e da 99 (só na nuvem, com DIAS_ESPECIAIS_PAUSA_AUTOMATICA=1).
    DiasEspeciaisPausaService,
    RoboPedidoService,
    LembreteDoCarrinhoProcessor,
    AvisoDaMudancaProcessor,
    EstornoPixService,
    EstornoPixProcessor,
    AdicionalPixService,
    AdicionalPixProcessor,
    // O comprovante que o cliente manda no WhatsApp (16/11/2026): o Regem confere o pedido e responde (só nuvem).
    ComprovanteDoClienteService,
    // A leitura da foto do cliente por IA (16/11/2026; nasce desligada — ROBO_FOTOS_IA=1): a descrição vai ao atendente.
    FotoDoClienteService,
    // A voz do atendente pelo DMS Graph (27/11): a fala feminina com o tom de cada resposta e as pausas.
    VozDoAtendenteService,
  ],
})
export class CardapioModule {}
