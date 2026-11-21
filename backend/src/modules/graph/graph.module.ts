import { Module } from '@nestjs/common';
import { IaModule } from '../ia/ia.module';
import { GraphCliqueController } from './graph-clique.controller';
import { GraphCliqueService } from './graph-clique.service';
import { GraphFotoService } from './graph-foto.service';
import { GraphImagemService } from './graph-imagem.service';

/**
 * O DMS Graph no Regem (G5a; mig 450): o Regem CONSOME a porta MCP do Graph (`analisar_arquivo`) para ler a foto que o
 * cliente manda no WhatsApp — o `GraphFotoService`, exportado para o `CardapioModule` (a `FotoDoClienteService` chama o
 * Graph primeiro e a IA da empresa de reserva, G-4). O presidente liga a EMPRESA pelo clique (`GraphCliqueController`).
 * Só NUVEM (`CLOUD_ONLY_MODULES`): as tabelas e quem fala com o Graph moram lá. A auditoria é global. A IA da empresa
 * (`IaModule`) diz ao cartão se há reserva. O `GraphImagemService` (contrato 1.4.0) cria e edita imagem para quem precisar.
 */
@Module({
  imports: [IaModule],
  controllers: [GraphCliqueController],
  providers: [GraphCliqueService, GraphFotoService, GraphImagemService],
  exports: [GraphFotoService, GraphImagemService],
})
export class GraphModule {}
