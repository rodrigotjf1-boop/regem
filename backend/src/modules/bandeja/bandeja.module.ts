import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { BandejaController } from './bandeja.controller';
import { BandejaGuard } from './bandeja.guard';
import { BandejaService } from './bandeja.service';

// O ícone do servidor da loja na bandeja do Windows (fase 4 do pedido de 22–23/10/2026). Só responde no servidor da loja.
@Module({
  imports: [EquipamentoModule, ProducaoPedidoModule],
  controllers: [BandejaController],
  providers: [BandejaService, BandejaGuard],
})
export class BandejaModule {}
