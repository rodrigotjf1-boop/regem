import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { NoticiasRamoController } from './noticias-ramo.controller';
import { NoticiasRamoService } from './noticias-ramo.service';

// As Notícias do ramo (fase N1): carregado nos DOIS lados (na nuvem lê a cópia; no servidor da loja pede à nuvem).
// `EquipamentoModule`: o `SyncTokenGuard` da rota do servidor da loja (V81).
@Module({
  imports: [EquipamentoModule],
  controllers: [NoticiasRamoController],
  providers: [NoticiasRamoService, SyncTokenGuard],
})
export class NoticiasRamoModule {}
