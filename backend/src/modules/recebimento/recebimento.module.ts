import { Module } from '@nestjs/common';
import { RecebimentoController } from './recebimento.controller';
import { RecebimentoService } from './recebimento.service';
import { LoteController } from './lote.controller';
import { LoteService } from './lote.service';

@Module({
  controllers: [RecebimentoController, LoteController],
  providers: [RecebimentoService, LoteService],
  // M3b: o Mister lança a nota do fornecedor por foto pelo MESMO recebimento da tela.
  exports: [RecebimentoService],
})
export class RecebimentoModule {}
