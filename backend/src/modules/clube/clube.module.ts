import { Module } from '@nestjs/common';
import { ClubeController, ClubePublicoController } from './clube.controller';
import { ClubeService } from './clube.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

// O Clube de recompra (fases A0 e A1 do `docs/plano-clube-e-banner.md`, migs 471 e 474). Só NUVEM (CLOUD_ONLY em
// app.module): o clube roda na nuvem, onde moram o cardápio e o robô; a loja não tem as tabelas. A auditoria é global.
// O prêmio surpresa: a rotina do pedido entregue e a revelação pela página do pedido (`/r/…`).
@Module({
  controllers: [ClubeController, ClubePublicoController],
  providers: [ClubeService, ClubeSurpresaService],
  exports: [ClubeService, ClubeSurpresaService],
})
export class ClubeModule {}
