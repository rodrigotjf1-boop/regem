import { Module } from '@nestjs/common';
import { IaModule } from '../ia/ia.module';
import { ModuloModule } from '../modulo/modulo.module';
import { MisterConsoleService } from './mister-console.service';
import { MisterController } from './mister.controller';
import { MisterEntradaService } from './mister-entrada.service';
import { MisterFilaService } from './mister-fila.service';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import { MisterAvisosHistoricoService } from './mister-avisos-historico.service';
import { MisterAvaliacaoService } from './mister-avaliacao.service';
import { MisterSegurancaService } from './mister-seguranca.service';
import { MisterSentinelaService } from './mister-sentinela.service';
import { MisterInstrucoesService } from './mister-instrucoes.service';
import { MisterQualidadeService } from './mister-qualidade.service';
import { MisterRelatoriosConfigService } from './mister-relatorios-config.service';
import { MisterNumeroService } from './mister-numero.service';
import { MisterQrService } from './mister-qr.service';
import { MisterVinculoService } from './mister-vinculo.service';

// MISTER (mig 417; `docs/plano-mister.md`): o número de WhatsApp da distribuição e a entrada das mensagens.
//  • Não importa o módulo do WhatsApp das lojas: o Mister fala com a Meta por conta própria (o mesmo acesso da
//    distribuição). É o módulo do WhatsApp que importa este, para entregar aqui a mensagem que chega ao número do Mister.
//  • `ModuloModule`: a régua do módulo "mister" ligado, na rota (guarda) e em cada mensagem que chega.
//  • `IaModule`: o painel do console mostra de onde vem a IA de cada empresa e o uso em 30 dias.
//  • A FILA das perguntas (`MisterFilaService`, mig 418) mora aqui porque a entrada grava nela; quem RESPONDE é o
//    `MisterAgenteModule`, à parte: ele importa os módulos de dados (Delivery, Relatórios…), e o do Delivery importa o do
//    WhatsApp, que importa este — o agente aqui dentro fecharia um ciclo.
// Sobe junto do módulo do WhatsApp — que também sobe no servidor da loja —, mas lá não faz nada: as rotas são
// `@CloudOnly`, a rotina de limpeza só roda na nuvem e, sem a tabela, o número lê como "não conectado".
@Module({
  imports: [ModuloModule, IaModule],
  controllers: [MisterController],
  providers: [
    MisterNumeroService,
    MisterVinculoService,
    MisterEntradaService,
    MisterConsoleService,
    MisterFilaService,
    MisterAvisosConfigService,
    MisterRelatoriosConfigService,
    MisterAvisosHistoricoService,
    MisterQualidadeService,
    // A avaliação de regressão (F5.3, mig 424): só precisa da IA (`IaModule`) e do laço do agente, que não depende dos
    // módulos de dados — por isso mora aqui, e não no `MisterAgenteModule`.
    MisterAvaliacaoService,
    // A segurança do Mister no console (o Sentinela, parte 1): só contagens do que as proteções fizeram.
    MisterSegurancaService,
    // A análise com IA da Segurança (o Sentinela, parte 2; S2, mig 434): a IA pela chave da DMS lê só os metadados e propõe.
    MisterSentinelaService,
    // As instruções candidatas (M2b, mig 435): o texto no ar, que o agente, os relatórios e a avaliação usam.
    MisterInstrucoesService,
    // A conexão por QR Code do número no console (Q2 e Q3, mig 437): o Evolution da distribuição, uma forma por vez.
    MisterQrService,
  ],
  exports: [
    MisterEntradaService,
    MisterConsoleService,
    MisterNumeroService,
    MisterFilaService,
    MisterAvisosConfigService,
    MisterRelatoriosConfigService,
    MisterAvisosHistoricoService,
    MisterQualidadeService,
    MisterAvaliacaoService,
    MisterSegurancaService,
    MisterSentinelaService,
    MisterInstrucoesService,
    MisterQrService,
  ],
})
export class MisterModule {}
