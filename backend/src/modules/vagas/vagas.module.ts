import { Module } from '@nestjs/common';
import { ColaboradorModule } from '../colaborador/colaborador.module';
import { ModuloModule } from '../modulo/modulo.module';
import { VagasController, VagasPublicoController } from './vagas.controller';
import { VagasService } from './vagas.service';

// Vagas e candidatos (F1, mig 389): a página pública de vagas e Pessoas › Candidatos. Só NUVEM (CLOUD_ONLY_IMPORTS). O
// ModuloModule dá o ModuloService ao ModuloGuard e à conferência da página pública (V81). O ColaboradorModule dá o
// cadastro de colaborador ao "Contratar" (F4).
@Module({
  imports: [ModuloModule, ColaboradorModule],
  controllers: [VagasPublicoController, VagasController],
  providers: [VagasService],
  exports: [VagasService],
})
export class VagasModule {}
