import { Module } from '@nestjs/common';
import { GogemController } from './gogem.controller';
import { GogemPublishService } from './gogem-publish.service';
import { GogemAvisoService } from './gogem-aviso.service';

/**
 * Integração de saída Regem→GoGeM: o botão "Publicar no GoGeM" e o AVISO de venda do totem
 * cancelada no Regem (o GoGeM estorna o cartão/PIX — fila `aviso_integracao`, mig 289).
 */
@Module({
  controllers: [GogemController],
  providers: [GogemPublishService, GogemAvisoService],
  exports: [GogemAvisoService],
})
export class GogemModule {}
