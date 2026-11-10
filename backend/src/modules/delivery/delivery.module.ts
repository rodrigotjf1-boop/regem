import { Module, forwardRef } from '@nestjs/common';
import { DeliveryController } from './delivery.controller';
import { DespachoPublicoController } from './despacho-publico.controller';
import { DeliveryLojaController } from './delivery-loja.controller';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';
import { EdgeAlteracoesProcessor } from './edge-alteracoes.processor';
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
import { ChegadaModule } from '../chegada/chegada.module';
import { EntregadoresAoVivoController } from './entregadores-ao-vivo.controller';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';
import { AvisoDeAtrasoProcessor } from './aviso-de-atraso.processor';
import { AvisoDa99Processor } from './aviso-da-99.processor';
import { PausaDoCanalService } from './pausa-do-canal.service';

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
    ChegadaModule, // "Cheguei" na retirada (mig 354): a marca da Retirada e o botão no aviso de pronto
  ],
  controllers: [DeliveryController, DespachoPublicoController, DeliveryLojaController,
    EntregadoresAoVivoController],
  providers: [DeliveryService, SyncTokenGuard, CredencialDoTotemGuard, EdgePedidosProcessor,
    TotemExpiracaoProcessor, CloudFallbackProcessor, PedidoEnvioProcessor, EntregadoresAoVivoService,
    AvisoDeAtrasoProcessor, // o aviso automático de atraso (mig 347), só na nuvem
    AvisoDa99Processor, // o "saiu" com o rastreio ao cliente da 99 pelo WhatsApp da loja (mig 388), só na nuvem
    EdgeAlteracoesProcessor, // a alteração pedida na nuvem, aplicada no servidor da loja (mig 362)
    PausaDoCanalService], // a pausa dos pedidos por canal e por loja (mig 392)
  // PausaDoCanalService: o grupo "Pausa dos pedidos" dos ajustes do atendimento (F2, mig 393).
  exports: [DeliveryService, PausaDoCanalService],
})
export class DeliveryModule {}
