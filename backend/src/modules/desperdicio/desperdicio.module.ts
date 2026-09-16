import { Module } from '@nestjs/common';
import { DesperdicioController } from './desperdicio.controller';
import { DesperdicioService } from './desperdicio.service';

@Module({
  controllers: [DesperdicioController],
  providers: [DesperdicioService],
  // A perda de etiqueta vencida passa pelo MESMO caminho do desperdício manual
  // (custo, movimento de estoque e consumo FEFO do lote), em vez de gravar uma
  // cópia textual que não mexia em nada.
  exports: [DesperdicioService],
})
export class DesperdicioModule {}
