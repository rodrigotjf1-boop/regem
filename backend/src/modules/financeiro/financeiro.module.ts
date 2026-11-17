import { Module } from '@nestjs/common';
import { FinanceiroController } from './financeiro.controller';
import { FinanceiroService } from './financeiro.service';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';

@Module({
  imports: [ProducaoPedidoModule], // impressão dos cupons de caixa (sangria/suprimento/fechamento)
  controllers: [FinanceiroController],
  providers: [FinanceiroService],
  // M3a: o Mister lança a conta a pagar do boleto por foto pelo MESMO serviço da tela.
  exports: [FinanceiroService],
})
export class FinanceiroModule {}
