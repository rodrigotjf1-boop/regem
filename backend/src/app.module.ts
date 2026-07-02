import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
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
  ],
  controllers: [AppController],
})
export class AppModule {}
