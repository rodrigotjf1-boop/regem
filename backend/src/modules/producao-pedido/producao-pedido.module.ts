import { Module } from '@nestjs/common';
import { ProducaoPedidoController } from './producao-pedido.controller';
import { ProducaoPedidoService } from './producao-pedido.service';
import { ModuloModule } from '../modulo/modulo.module';
import { ChegadaModule } from '../chegada/chegada.module';

@Module({
  // ModuloGuard (@RequireModulo('kds')) precisa do ModuloService; ChegadaModule: a etiqueta "Cliente chegou" (mig 354).
  imports: [ModuloModule, ChegadaModule],
  controllers: [ProducaoPedidoController],
  providers: [ProducaoPedidoService],
  exports: [ProducaoPedidoService],
})
export class ProducaoPedidoModule {}
