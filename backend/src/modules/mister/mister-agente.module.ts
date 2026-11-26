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
import { MisterTelasService } from './mister-telas.service';
import { MisterTarefasService } from './mister-tarefas.service';
import { MisterPinFaladoService } from './mister-pin-falado.service';
import { MisterAprendizadoService } from './mister-aprendizado.service';
import { MisterAprendizadoController } from './mister-aprendizado.controller';
import { MisterLinkController } from './mister-link.controller';
import { MisterLinkPublicoController } from './mister-link-publico.controller';
import { MisterLinkPublicoService } from './mister-link-publico.service';
import { MisterPontoDoMesService } from './mister-ponto-do-mes.service';
import { MisterVigiaService } from './mister-vigia.service';
import { MisterRegrasService } from './mister-regras.service';
import { MisterCompraModelosController } from './mister-compra-modelos.controller';
import { MisterCompraModelosService } from './mister-compra-modelos.service';
import { MisterRegrasController } from './mister-regras.controller';
import { MisterListaService } from './mister-lista.service';
import { MisterPadroesService } from './mister-padroes.service';
import { MisterAcoesService } from './mister-acoes.service';
import { MisterPlanosService } from './mister-planos.service';
import { ComprasModule } from '../compras/compras.module';
import { FornecedorModule } from '../fornecedor/fornecedor.module';
import { TarefaModule } from '../tarefa/tarefa.module';
import { ProdutoModule } from '../produto/produto.module';
import { MisterPropostasService } from './mister-propostas.service';
import { MisterRecadosService } from './mister-recados.service';
import { MisterRelatoriosService } from './mister-relatorios.service';
import { MuralModule } from '../mural/mural.module';
import { GraphModule } from '../graph/graph.module';
import { PerfilClienteModule } from '../perfil-cliente/perfil-cliente.module';
import { MisterMidiaService } from './mister-midia.service';
import { MisterResumoArquivoService } from './mister-resumo-arquivo.service';
import { MisterRelatorioController } from './mister-relatorio.controller';
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
    // M3g parte 2 (o recado no mural): o "Publicar" sai pelo MESMO serviço da tela do Mural & clima.
    MuralModule,
    // Versão 5, M5a: a foto que a equipe manda é lida pelo DMS Graph (a ligação da empresa), como a do cliente.
    GraphModule,
    // Versão 6, M6g: a lista de compras cria o pedido pelo MESMO serviço da tela de Pedidos.
    ComprasModule,
    // Versão 9, O3: o cadastro do fornecedor pela conversa.
    FornecedorModule,
    // Versão 6, M6j (lote 2): a tarefa e a pausa do produto pelos MESMOS serviços das telas.
    TarefaModule,
    ProdutoModule,
    // Versão 6, M6j lote 6: os números dos clientes (o resumo de Delivery › Clientes).
    PerfilClienteModule,
  ],
  // Os relatórios (mig 420) moram aqui: escrevem pelo mesmo agente das perguntas. As propostas (F4.1, mig 428) também:
  // os avisos as criam e elas executam pelos serviços das telas.
  // M3a (mig 439): os documentos por foto lançam a conta a pagar pelo serviço do Financeiro. M3b (mig 441): a nota do
  // fornecedor, pelo recebimento do Estoque.
  providers: [
    MisterFerramentasService,
    // Versão 10, C3: procurar no mapa e ler a tela como a pessoa (o bilhete de uma chamada, pela própria API).
    MisterTelasService,
    // Versão 10, C4: fazer uma tarefa pelo mapa (a escrita pela própria API, com o bilhete preso ao método e ao corpo).
    MisterTarefasService,
    // Versão 10, C5: falar o PIN (ligar pela página do PIN; o áudio conferido pelo código, antes da fila e da IA).
    MisterPinFaladoService,
    // Versão 10, C7: aprender pela tarefa feita (os exemplos da empresa; Mister › O que aprendi).
    MisterAprendizadoService,
    MisterAgenteService,
    MisterAvisosService,
    MisterRelatoriosService,
    MisterPropostasService,
    MisterDocumentosService,
    MisterNotasService,
    // M3c.2: o PDF do relatório por insumo (o toque em "PDF" e o "manda em PDF").
    MisterAnexosService,
    // M3c (mig 443): o link para encaminhar a quem não tem usuário (a foto do relatório, só leitura, 7 dias).
    MisterLinkPublicoService,
    // M3g parte 2 (mig 444): o rascunho do recado no mural e o toque em "Publicar" / "Mudar o texto".
    MisterRecadosService,
    // M3e parte 2: os botões do arquivo do ponto do mês ("Enviar ao contador" e "Ver antes").
    MisterPontoDoMesService,
    // Versão 4, M4d (mig 452): o "fica de olho" e o lembrete — a volta de cada minuto e o toque fora das 24 horas.
    MisterVigiaService,
    // Versão 6, M6e (mig 472): as regras de aviso de cada pessoa — a ferramenta, os botões e o motor de cada minuto.
    MisterRegrasService,
    // Versão 6, M6g (mig 475): a lista de compras pela conversa e pela planilha, até o pedido em Estoque › Pedidos.
    MisterListaService,
    // Versão 6, M6f parte 2 (mig 478): os padrões que o Mister percebe e as sugestões (nasce desligada: MISTER_PADROES).
    MisterPadroesService,
    // Versão 6, M6j: as ações pela porta `propor_acao` (lote 1, o Delivery), pelo botão de quem pediu.
    MisterAcoesService,
    // Versão 7, V7c: várias ações num pedido, com um botão só (cada passo pelo mesmo caminho de `propor_acao`).
    MisterPlanosService,
    // Versão 5, M5a: a foto (e o PDF) que a equipe manda — o DMS Graph lê, a IA da empresa de reserva; vira a pergunta.
    MisterMidiaService,
    // Versão 5, M5e (mig 461): o resumo com "📄 PDF" e "📊 Ver gráficos" e o toque nesses botões.
    MisterResumoArquivoService,
    // Versão 9, O2 (mig 503): os modelos de compra e os apelidos — a tela, o "Mudou:" da nota e os apelidos da lista.
    MisterCompraModelosService,
  ],
  // F4.2a (mig 433): as rotas públicas da página do link com PIN (`/m/<código>`), que respondem pelo serviço das propostas.
  // M3a parte 3: a parte "Documentos" do Mister na loja (a lista e o "Desfazer o lançamento").
  // M3c.4: a página do relatório por insumo ("Ver no Regem") e o PDF dela.
  // M3c (mig 443): as rotas públicas da página do link para encaminhar (`/m/r/<código>`).
  // Versão 6, M6f: a parte "Regras" do Mister na loja (a lista, pausar, retomar e apagar).
  // Versão 9, O2: a parte "Modelos de compra" do Mister na loja.
  controllers: [MisterLinkController, MisterDocumentosController, MisterRelatorioController, MisterLinkPublicoController, MisterRegrasController, MisterCompraModelosController, MisterAprendizadoController],
  exports: [MisterAgenteService, MisterAvisosService],
})
export class MisterAgenteModule {}
