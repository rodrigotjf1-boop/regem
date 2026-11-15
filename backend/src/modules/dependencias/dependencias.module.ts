import { Module } from '@nestjs/common';
import { DependenciasService } from './dependencias.service';

/**
 * A vigilância das dependências (F3, parte 2; mig 423 `@cloud-only`). Só na nuvem: entra pelo módulo do console da
 * distribuição (que já é só da nuvem), onde ficam as rotas — a tela é a aba "Dependências" do console.
 */
@Module({
  providers: [DependenciasService],
  exports: [DependenciasService],
})
export class DependenciasModule {}
