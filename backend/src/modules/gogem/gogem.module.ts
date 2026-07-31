import { Module } from '@nestjs/common';
import { GogemController } from './gogem.controller';
import { GogemPublishService } from './gogem-publish.service';

/** Integração de saída Regem→GoGeM (botão "Publicar no GoGeM"). */
@Module({
  controllers: [GogemController],
  providers: [GogemPublishService],
})
export class GogemModule {}
