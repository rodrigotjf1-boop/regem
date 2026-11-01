import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DespachoPublicoController } from './despacho-publico.controller';
import { DeliveryLojaController } from './delivery-loja.controller';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { TotemExpiracaoProcessor } from './totem-expiracao.processor';
import { CloudFallbackProcessor } from './cloud-fallback.processor';
import { PedidoEnvioProcessor } from './pedido-envio.processor';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { CredencialDoTotemGuard } from '../integracao-api/credencial-totem.guard';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { VendasModule } from '../vendas/vendas.module';
import { ProducaoPedidoModule } from '../producao-pedido/producao-pedido.module';
import { CashbackModule } from '../cashback/cashback.module';
import { FidelidadeModule } from '../fidelidade/fidelidade.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { GogemModule } from '../gogem/gogem.module';
import { ModuloModule } from '../modulo/modulo.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { EntregadoresAoVivoController } from './entregadores-ao-vivo.controller';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';
import { AvisoDeAtrasoProcessor } from './aviso-de-atraso.processor';

@Module({
  imports: [
    EquipamentoModule,
    VendasModule,
    ProducaoPedidoModule,
    CashbackModule,
    FidelidadeModule,
    forwardRef(() => IntegracoesModule),
    GogemModule,
    ModuloModule, // ModuloGuard (@RequireModulo('kds')) do mapa no KDS precisa do ModuloService
    WhatsappModule, // o código de entrega da loja na API oficial sai pelo próprio Regem (ERR-332)
  ],
  controllers: [DeliveryController, DespachoPublicoController, DeliveryLojaController,
    EntregadoresAoVivoController],
  providers: [DeliveryService, SyncTokenGuard, CredencialDoTotemGuard, EdgePedidosProcessor,
    TotemExpiracaoProcessor, CloudFallbackProcessor, PedidoEnvioProcessor, EntregadoresAoVivoService,
    AvisoDeAtrasoProcessor], // o aviso automático de atraso (mig 347), só na nuvem
  exports: [DeliveryService],
})
export class DeliveryModule {}
