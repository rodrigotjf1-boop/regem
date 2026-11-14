import { Module } from '@nestjs/common';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { EscalaModule } from '../escala/escala.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { IaModule } from '../ia/ia.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { LicencaModule } from '../licenca/licenca.module';
import { ModuloModule } from '../modulo/modulo.module';
import { PontoModule } from '../ponto/ponto.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { RelatoriosModule } from '../relatorios/relatorios.module';
import { VendasModule } from '../vendas/vendas.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MisterAgenteService } from './mister-agente.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MisterModule } from './mister.module';

// O AGENTE DE IA DO MISTER (mig 418; `docs/plano-mister.md`, F2): responde às perguntas da fila.
//  • À parte do `MisterModule` de propósito: as ferramentas de leitura usam os serviços das telas (Painel, Relatórios,
//    Estoque, Delivery, cozinha, Servidor local), e o módulo do Delivery importa o do WhatsApp, que importa o
//    `MisterModule`. O agente dentro dele fecharia um ciclo; aqui a seta tem um sentido só.
//  • A ligação com a entrada é pela fila: a entrada grava a pergunta (`MisterFilaService`, no `MisterModule`) e a fila
//    acorda o agente, que se apresenta a ela ao subir.
//  • Só sobe na nuvem (lista dos módulos só-nuvem do `app.module.ts`).
@Module({
  imports: [
    MisterModule,
    IaModule,
    ModuloModule,
    DashboardModule,
    RelatoriosModule,
    EstoqueModule,
    DeliveryModule,
    ProducaoPedidoModule,
    LicencaModule,
    VendasModule,
    EscalaModule,
    PontoModule,
    // F3 (os canais e as integrações): o login da 99 e o WhatsApp da loja. A pausa vem do DeliveryModule.
    IntegracoesModule,
    WhatsappModule,
  ],
  providers: [MisterFerramentasService, MisterAgenteService],
  exports: [MisterAgenteService],
})
export class MisterAgenteModule {}
