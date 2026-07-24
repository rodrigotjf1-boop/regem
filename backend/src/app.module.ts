import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { LicenseInterceptor } from './modules/licenca/license.interceptor';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { DrizzleModule } from './db/drizzle.module';
import { AppController } from './app.controller';
import { EmpresaModule } from './modules/empresa/empresa.module';
import { UnidadeModule } from './modules/unidade/unidade.module';
import { SetorModule } from './modules/setor/setor.module';
import { FuncaoModule } from './modules/funcao/funcao.module';
import { ColaboradorModule } from './modules/colaborador/colaborador.module';
import { PerfilModule } from './modules/perfil/perfil.module';
import { ModuloModule } from './modules/modulo/modulo.module';
import { TurnoModule } from './modules/turno/turno.module';
import { EtiquetaModule } from './modules/etiqueta/etiqueta.module';
import { EscalaModule } from './modules/escala/escala.module';
import { DiaEspecialModule } from './modules/dia-especial/dia-especial.module';
import { ContagemModule } from './modules/contagem/contagem.module';
import { ComprasModule } from './modules/compras/compras.module';
import { TarefaModule } from './modules/tarefa/tarefa.module';
import { ChecklistModule } from './modules/checklist/checklist.module';
import { DocumentoModule } from './modules/documento/documento.module';
import { DesperdicioModule } from './modules/desperdicio/desperdicio.module';
import { VistoriaModule } from './modules/vistoria/vistoria.module';
import { EstoqueModule } from './modules/estoque/estoque.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { OcorrenciaModule } from './modules/ocorrencia/ocorrencia.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { FichasModule } from './modules/fichas/fichas.module';
import { DiretoriaModule } from './modules/diretoria/diretoria.module';
import { GuiasModule } from './modules/guias/guias.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { MidiaModule } from './modules/midia/midia.module';
import { PicoModule } from './modules/pico/pico.module';
import { FornecedorModule } from './modules/fornecedor/fornecedor.module';
import { RecebimentoModule } from './modules/recebimento/recebimento.module';
import { PontoModule } from './modules/ponto/ponto.module';
import { EquipamentoModule } from './modules/equipamento/equipamento.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { FinanceiroModule } from './modules/financeiro/financeiro.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ProdutoModule } from './modules/produto/produto.module';
import { VendasModule } from './modules/vendas/vendas.module';
import { ProducaoModule } from './modules/producao/producao.module';
import { OrdemProducaoModule } from './modules/ordem-producao/ordem-producao.module';
import { PedidoManutencaoModule } from './modules/pedido-manutencao/pedido-manutencao.module';
import { DesligamentoModule } from './modules/desligamento/desligamento.module';
import { EtiquetaValidadeModule } from './modules/etiqueta-validade/etiqueta-validade.module';
import { ProducaoPedidoModule } from './modules/producao-pedido/producao-pedido.module';
import { ImpressaoModule } from './modules/impressao/impressao.module';
import { FiscalModule } from './modules/fiscal/fiscal.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { TefModule } from './modules/tef/tef.module';
import { CardapioModule } from './modules/cardapio/cardapio.module';
import { ClienteModule } from './modules/cliente/cliente.module';
import { AtendimentoModule } from './modules/atendimento/atendimento.module';
import { FidelidadeModule } from './modules/fidelidade/fidelidade.module';
import { CashbackModule } from './modules/cashback/cashback.module';
import { IntegracoesModule } from './modules/integracoes/integracoes.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { RelatoriosModule } from './modules/relatorios/relatorios.module';
import { MuralModule } from './modules/mural/mural.module';
import { BotModule } from './modules/bot/bot.module';
import { SyncModule } from './modules/sync/sync.module';
import { EdgeFlashSyncModule } from './modules/sync/edge-flash-sync.service';
import { EdgeModule } from './modules/edge/edge.module';
import { TelemetriaInterceptor } from './modules/edge/telemetria.interceptor';
import { UnidadeUnicaInterceptor } from './auth/unidade-unica.interceptor';
import { TerminalSegredoInterceptor } from './auth/terminal-segredo.interceptor';
import { DistribuicaoModule } from './modules/distribuicao/distribuicao.module';
import { LicencaModule } from './modules/licenca/licenca.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    // .env.local (servidor edge/dev, gitignored) tem prioridade; cai no .env (nuvem).
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // Rate limit global (120 req/min por IP). Rotas sensíveis apertam com @Throttle.
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    DrizzleModule,
    AuthModule,
    EmpresaModule,
    UnidadeModule,
    SetorModule,
    FuncaoModule,
    ColaboradorModule,
    PerfilModule,
    ModuloModule,
    TurnoModule,
    EtiquetaModule,
    EscalaModule,
    DiaEspecialModule,
    ContagemModule,
    ComprasModule,
    TarefaModule,
    ChecklistModule,
    DocumentoModule,
    DesperdicioModule,
    VistoriaModule,
    EstoqueModule,
    DashboardModule,
    OcorrenciaModule,
    OnboardingModule,
    FichasModule,
    DiretoriaModule,
    GuiasModule,
    AuditoriaModule,
    MidiaModule,
    PicoModule,
    FornecedorModule,
    RecebimentoModule,
    PontoModule,
    EquipamentoModule,
    RealtimeModule,
    FinanceiroModule,
    JobsModule,
    ProdutoModule,
    VendasModule,
    ProducaoModule,
    OrdemProducaoModule,
    PedidoManutencaoModule,
    DesligamentoModule,
    EtiquetaValidadeModule,
    ProducaoPedidoModule,
    ImpressaoModule,
    FiscalModule,
    DeliveryModule,
    TefModule,
    CardapioModule,
    FidelidadeModule,
    CashbackModule,
    IntegracoesModule,
    WhatsappModule,
    ClienteModule,
    AtendimentoModule,
    RelatoriosModule,
    MuralModule,
    BotModule,
    SyncModule,
    EdgeFlashSyncModule,
    EdgeModule,
    DistribuicaoModule,
    LicencaModule,
  ],
  controllers: [AppController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Bloqueio duro por licença/trial (G-1) — só na nuvem, só escrita.
    { provide: APP_INTERCEPTOR, useClass: LicenseInterceptor },
    // Telemetria de erro (Frente A) — só no edge; na nuvem é passthrough.
    { provide: APP_INTERCEPTOR, useClass: TelemetriaInterceptor },
    // Loja única: desliga o filtro por unidade quando a rede tem só uma.
    { provide: APP_INTERCEPTOR, useClass: UnidadeUnicaInterceptor },
    // Prova de identidade do PC pareado (X-Terminal-Id + X-Terminal-Secret).
    { provide: APP_INTERCEPTOR, useClass: TerminalSegredoInterceptor },
  ],
})
export class AppModule {}
