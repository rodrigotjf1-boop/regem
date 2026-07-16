import { Module } from '@nestjs/common';
import { ProducaoPedidoController } from './producao-pedido.controller';
import { ProducaoPedidoService } from './producao-pedido.service';
import { ModuloModule } from '../modulo/modulo.module';

@Module({
  imports: [ModuloModule], // ModuloGuard (@RequireModulo('kds')) precisa do ModuloService
  controllers: [ProducaoPedidoController],
  providers: [ProducaoPedidoService],
  exports: [ProducaoPedidoService],
})
export class ProducaoPedidoModule {}
