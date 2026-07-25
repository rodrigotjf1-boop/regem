import { Module } from '@nestjs/common';
import { ProdutoController } from './produto.controller';
import { CatalogoSyncController } from './catalogo-sync.controller';
import { ProdutoService } from './produto.service';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';

@Module({
  imports: [EquipamentoModule],
  controllers: [ProdutoController, CatalogoSyncController],
  providers: [ProdutoService, SyncTokenGuard],
  exports: [ProdutoService],
})
export class ProdutoModule {}
