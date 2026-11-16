import { Module } from '@nestjs/common';
import { ColaboradorModule } from '../colaborador/colaborador.module';
import { ModuloModule } from '../modulo/modulo.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfirmacaoDaFichaService } from './confirmacao-da-ficha.service';
import { VagasController, VagasPublicoController } from './vagas.controller';
import { VagasService } from './vagas.service';
import { VagasAvisoService } from './vagas-aviso.service';

// Vagas e candidatos (F1, mig 389): a página pública de vagas e Pessoas › Candidatos. Só NUVEM (CLOUD_ONLY_IMPORTS). O
// ModuloModule dá o ModuloService ao ModuloGuard e à conferência da página pública (V81). O ColaboradorModule dá o
// cadastro de colaborador ao "Contratar" (F4). O WhatsappModule dá o envio da API oficial à confirmação da ficha (F3b,
// mig 427).
@Module({
  imports: [ModuloModule, ColaboradorModule, WhatsappModule],
  controllers: [VagasPublicoController, VagasController],
  // F4b parte 2 (mig 438): o aviso da vaga pelo número de marketing (a fila e a rotina da nuvem; o envio do WhatsAppModule).
  providers: [VagasService, ConfirmacaoDaFichaService, VagasAvisoService],
  exports: [VagasService, VagasAvisoService],
})
export class VagasModule {}
