import { Module } from '@nestjs/common';
import { GraphCliqueController } from './graph-clique.controller';
import { GraphCliqueService } from './graph-clique.service';
import { GraphFotoService } from './graph-foto.service';

/**
 * O DMS Graph no Regem (G5a; mig 450): o Regem CONSOME a porta MCP do Graph (`analisar_arquivo`) para ler a foto que o
 * cliente manda no WhatsApp — o `GraphFotoService`, exportado para o `CardapioModule` (a `FotoDoClienteService` chama o
 * Graph primeiro e a IA da empresa de reserva, G-4). O presidente liga a EMPRESA pelo clique (`GraphCliqueController`).
 * Só NUVEM (`CLOUD_ONLY_MODULES`): as tabelas e quem fala com o Graph moram lá. A auditoria é global.
 */
@Module({
  controllers: [GraphCliqueController],
  providers: [GraphCliqueService, GraphFotoService],
  exports: [GraphFotoService],
})
export class GraphModule {}
