import { Module } from '@nestjs/common';
import { PedidoManutencaoController } from './pedido-manutencao.controller';
import { PedidoManutencaoService } from './pedido-manutencao.service';

@Module({
  controllers: [PedidoManutencaoController],
  providers: [PedidoManutencaoService],
  exports: [PedidoManutencaoService], // usado pelo job de 15 dias (JobsModule)
})
export class PedidoManutencaoModule {}
