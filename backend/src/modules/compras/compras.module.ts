import { Module } from '@nestjs/common';
import { ComprasController } from './compras.controller';
import { ComprasService } from './compras.service';

@Module({
  controllers: [ComprasController],
  providers: [ComprasService],
  // Mister versão 6, M6g: a lista de compras pela conversa cria o pedido pelo MESMO serviço da tela.
  exports: [ComprasService],
})
export class ComprasModule {}
