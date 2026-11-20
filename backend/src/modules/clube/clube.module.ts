import { Module } from '@nestjs/common';
import { ClubeController } from './clube.controller';
import { ClubeService } from './clube.service';

// O Clube de recompra (fase A0 do `docs/plano-clube-e-banner.md`, mig 471). Só NUVEM (CLOUD_ONLY em app.module): o clube
// roda na nuvem, onde moram o cardápio e o robô; a loja não tem as tabelas. A auditoria é global.
@Module({
  controllers: [ClubeController],
  providers: [ClubeService],
  exports: [ClubeService],
})
export class ClubeModule {}
