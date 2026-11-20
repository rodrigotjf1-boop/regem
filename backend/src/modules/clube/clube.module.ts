import { Global, Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { ClubeController, ClubeDaLojaController, ClubeLinkController, ClubePublicoController } from './clube.controller';
import { ClubeService } from './clube.service';
import { ClubeAlbumService } from './clube-album.service';
import { ClubeMetaService } from './clube-meta.service';
import { ClubeDesculpasService } from './clube-desculpas.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

// O Clube de recompra (fases A0, A1 e A1b do `docs/plano-clube-e-banner.md`, migs 471 e 474). Só NUVEM (CLOUD_ONLY em
// app.module): o clube roda na nuvem, onde moram o cardápio e o robô; a loja não tem as tabelas. A auditoria é global.
// O prêmio surpresa: a rotina do pedido entregue, a revelação pela página do pedido (`/r/…`) e pelo link pessoal (`/p/…`)
// e o prêmio de desculpas pelo caso do Atendimento.
//
// GLOBAL: o Atendimento (que também roda no servidor da loja) pede o `ClubeDesculpasService` como OPCIONAL — na nuvem ele
// existe; no servidor da loja este módulo nem sobe e o Atendimento repassa à nuvem (`clube/da-loja`). O `SyncTokenGuard`
// injeta o que o `EquipamentoModule` provê (V81); o envio da mensagem é o da caixa de conversas (`WhatsappModule`).
@Global()
@Module({
  imports: [EquipamentoModule, WhatsappModule],
  controllers: [ClubeController, ClubePublicoController, ClubeLinkController, ClubeDaLojaController],
  providers: [ClubeService, ClubeSurpresaService, ClubeDesculpasService, ClubeAlbumService, ClubeMetaService, SyncTokenGuard],
  exports: [ClubeService, ClubeSurpresaService, ClubeDesculpasService, ClubeAlbumService, ClubeMetaService],
})
export class ClubeModule {}
