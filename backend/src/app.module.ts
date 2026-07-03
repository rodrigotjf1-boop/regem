import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { TurnoModule } from './modules/turno/turno.module';
import { EtiquetaModule } from './modules/etiqueta/etiqueta.module';
import { EscalaModule } from './modules/escala/escala.module';
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
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
    TurnoModule,
    EtiquetaModule,
    EscalaModule,
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
  ],
  controllers: [AppController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
