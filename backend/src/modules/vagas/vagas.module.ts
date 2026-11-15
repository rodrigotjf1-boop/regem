import { Module } from '@nestjs/common';
import { ColaboradorModule } from '../colaborador/colaborador.module';
import { ModuloModule } from '../modulo/modulo.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ConfirmacaoDaFichaService } from './confirmacao-da-ficha.service';
import { VagasController, VagasPublicoController } from './vagas.controller';
import { VagasService } from './vagas.service';

// Vagas e candidatos (F1, mig 389): a página pública de vagas e Pessoas › Candidatos. Só NUVEM (CLOUD_ONLY_IMPORTS). O
// ModuloModule dá o ModuloService ao ModuloGuard e à conferência da página pública (V81). O ColaboradorModule dá o
// cadastro de colaborador ao "Contratar" (F4). O WhatsappModule dá o envio da API oficial à confirmação da ficha (F3b,
// mig 427).
@Module({
  imports: [ModuloModule, ColaboradorModule, WhatsappModule],
  controllers: [VagasPublicoController, VagasController],
  providers: [VagasService, ConfirmacaoDaFichaService],
  exports: [VagasService],
})
export class VagasModule {}
