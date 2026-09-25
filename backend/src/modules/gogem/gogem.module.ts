import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { GogemController } from './gogem.controller';
import { GogemRepasseController } from './gogem-repasse.controller';
import { GogemPublishService } from './gogem-publish.service';
import { GogemAvisoService } from './gogem-aviso.service';

/**
 * Integração de saída Regem→GoGeM: o botão "Publicar no GoGeM" e o AVISO de venda do totem
 * cancelada no Regem (o GoGeM estorna o cartão/PIX — fila `aviso_integracao`, mig 289). O servidor
 * da loja repassa o aviso para a nuvem (`GogemRepasseController`, token de sync — por isso o
 * `EquipamentoModule`, que o `SyncTokenGuard` usa), e só a nuvem fala com o GoGeM (ERR-108).
 */
@Module({
  imports: [EquipamentoModule],
  controllers: [GogemController, GogemRepasseController],
  providers: [GogemPublishService, GogemAvisoService],
  exports: [GogemAvisoService],
})
export class GogemModule {}
