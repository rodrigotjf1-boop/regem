import { Module } from '@nestjs/common';
import { AtendimentoModule } from '../atendimento/atendimento.module';
import { ConferenciaModule } from '../conferencia/conferencia.module';
import { DashboardModule } from '../dashboard/dashboard.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { EscalaModule } from '../escala/escala.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { FinanceiroModule } from '../financeiro/financeiro.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { IbptModule } from '../fiscal/ibpt/ibpt.module';
import { IaModule } from '../ia/ia.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { KdsModule } from '../kds/kds.module';
import { LicencaModule } from '../licenca/licenca.module';
import { ModuloModule } from '../modulo/modulo.module';
import { PontoModule } from '../ponto/ponto.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { RecebimentoModule } from '../recebimento/recebimento.module';
import { RelatoriosModule } from '../relatorios/relatorios.module';
import { VendasModule } from '../vendas/vendas.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { MisterAgenteService } from './mister-agente.service';
import { MisterAnexosService } from './mister-anexos.service';
import { MisterAvisosService } from './mister-avisos.service';
import { MisterDocumentosController } from './mister-documentos.controller';
import { MisterDocumentosService } from './mister-documentos.service';
import { MisterNotasService } from './mister-notas.service';
import { MisterFerramentasService } from './mister-ferramentas.service';
import { MisterLinkController } from './mister-link.controller';
import { MisterPropostasService } from './mister-propostas.service';
import { MisterRelatoriosService } from './mister-relatorios.service';
import { MisterModule } from './mister.module';

// O AGENTE DE IA DO MISTER (mig 418; `docs/plano-mister.md`, F2): responde às perguntas da fila.
//  • À parte do `MisterModule` de propósito: as ferramentas de leitura usam os serviços das telas (Painel, Relatórios,
//    Estoque, Delivery, cozinha, Servidor local), e o módulo do Delivery importa o do WhatsApp, que importa o
//    `MisterModule`. O agente dentro dele fecharia um ciclo; aqui a seta tem um sentido só.
//  • A ligação com a entrada é pela fila: a entrada grava a pergunta (`MisterFilaService`, no `MisterModule`) e a fila
//    acorda o agente, que se apresenta a ela ao subir.
//  • A rotina dos AVISOS (`MisterAvisosService`, mig 419) mora aqui também: entrega no KDS (`KdsModule`) e no
//    Atendimento, e só roda na nuvem.
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
    // F3, parte 2: a conferência do catálogo (a leitura guardada).
    ConferenciaModule,
    // A fila do Atendimento (a 14ª consulta).
    AtendimentoModule,
    KdsModule,
    // F3, vencimentos: a tabela do IBPT da loja (a mesma da Configuração fiscal).
    IbptModule,
    // F4.1 (as propostas): a consulta da nota na SEFAZ é a mesma do botão da tela.
    FiscalModule,
    // M3a (documentos por foto): a conta a pagar sai pelo MESMO serviço da tela do Financeiro.
    FinanceiroModule,
    // M3b (a nota do fornecedor por foto): a entrada no estoque sai pelo MESMO recebimento da tela.
    RecebimentoModule,
  ],
  // Os relatórios (mig 420) moram aqui: escrevem pelo mesmo agente das perguntas. As propostas (F4.1, mig 428) também:
  // os avisos as criam e elas executam pelos serviços das telas.
  // M3a (mig 439): os documentos por foto lançam a conta a pagar pelo serviço do Financeiro. M3b (mig 441): a nota do
  // fornecedor, pelo recebimento do Estoque.
  providers: [
    MisterFerramentasService,
    MisterAgenteService,
    MisterAvisosService,
    MisterRelatoriosService,
    MisterPropostasService,
    MisterDocumentosService,
    MisterNotasService,
    // M3c.2: o PDF do relatório por insumo (o toque em "PDF" e o "manda em PDF").
    MisterAnexosService,
  ],
  // F4.2a (mig 433): as rotas públicas da página do link com PIN (`/m/<código>`), que respondem pelo serviço das propostas.
  // M3a parte 3: a parte "Documentos" do Mister na loja (a lista e o "Desfazer o lançamento").
  controllers: [MisterLinkController, MisterDocumentosController],
  exports: [MisterAgenteService, MisterAvisosService],
})
export class MisterAgenteModule {}
