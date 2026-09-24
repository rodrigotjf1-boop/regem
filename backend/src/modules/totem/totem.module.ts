import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ProdutoModule } from '../produto/produto.module';
import { VendasModule } from '../vendas/vendas.module';
import { GogemProxyService } from './gogem-proxy.service';
import { TotemMidiaCache } from './midia-cache.service';
import { TotemController } from './totem.controller';
import { TotemNuvemController } from './totem-nuvem.controller';
import { TotemVendasController } from './totem-vendas.controller';
import { TotemService } from './totem.service';

// R3 — modo edge do totem GoGeM. Vive no servidor local: o guard das rotas só aceita
// dispositivo tipo 'totem', e esse tipo só é válido quando `ehServidorLocal()`.
@Module({
  imports: [ProdutoModule, EquipamentoModule, VendasModule, DeliveryModule],
  controllers: [TotemController, TotemVendasController, TotemNuvemController],
  providers: [TotemService, GogemProxyService, TotemMidiaCache],
  exports: [TotemService],
})
export class TotemModule {}
