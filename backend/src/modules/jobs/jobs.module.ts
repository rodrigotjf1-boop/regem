import { Module } from '@nestjs/common';
import { MidiaModule } from '../midia/midia.module';
import { EstoqueModule } from '../estoque/estoque.module';
import { OrdemProducaoModule } from '../ordem-producao/ordem-producao.module';
import { PedidoManutencaoModule } from '../pedido-manutencao/pedido-manutencao.module';
import { EtiquetaValidadeModule } from '../etiqueta-validade/etiqueta-validade.module';
import { PontoModule } from '../ponto/ponto.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [MidiaModule, EstoqueModule, OrdemProducaoModule, PedidoManutencaoModule, EtiquetaValidadeModule, PontoModule],
  providers: [JobsService],
})
export class JobsModule {}
