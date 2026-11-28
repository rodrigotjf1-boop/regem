import { Module } from '@nestjs/common';
import { ProducaoPedidoController } from './producao-pedido.controller';
import { ProducaoAparelhoController } from './producao-aparelho.controller';
import { ProducaoPedidoService } from './producao-pedido.service';
import { KdsAparelhoGuard } from './kds-aparelho.guard';
import { ModuloModule } from '../modulo/modulo.module';
import { ChegadaModule } from '../chegada/chegada.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { PedidoTravaModule } from '../pedido-trava/pedido-trava.module';

@Module({
  // ModuloGuard (@RequireModulo('kds')) precisa do ModuloService; ChegadaModule: a etiqueta "Cliente chegou" (mig 354).
  // EquipamentoModule: o KDS físico pelo token do aparelho (`KdsAparelhoGuard` valida o token — 16/11/2026).
  imports: [ModuloModule, ChegadaModule, EquipamentoModule, PedidoTravaModule],
  controllers: [ProducaoPedidoController, ProducaoAparelhoController],
  providers: [ProducaoPedidoService, KdsAparelhoGuard],
  exports: [ProducaoPedidoService],
})
export class ProducaoPedidoModule {}
