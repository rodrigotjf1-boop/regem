import { Module } from '@nestjs/common';
import { ModuloModule } from '../modulo/modulo.module';
import { VagasController, VagasPublicoController } from './vagas.controller';
import { VagasService } from './vagas.service';

// Vagas e candidatos (F1, mig 389): a página pública de vagas e Pessoas › Candidatos. Só NUVEM (CLOUD_ONLY_IMPORTS). O
// ModuloModule dá o ModuloService ao ModuloGuard e à conferência da página pública (V81).
@Module({
  imports: [ModuloModule],
  controllers: [VagasPublicoController, VagasController],
  providers: [VagasService],
  exports: [VagasService],
})
export class VagasModule {}
