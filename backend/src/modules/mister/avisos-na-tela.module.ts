import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { ModuloModule } from '../modulo/modulo.module';
import { SyncTokenGuard } from '../sync/sync-token.guard';
import { AvisosNaTelaController } from './avisos-na-tela.controller';
import { AvisosNaTelaService } from './avisos-na-tela.service';

// Os avisos na tela da loja (F1.4): carregado nos DOIS lados (na nuvem lê os avisos; no servidor da loja pede à nuvem).
// À parte do `MisterModule`, que só sobe na nuvem. `EquipamentoModule`: o `SyncTokenGuard` das rotas do servidor da loja
// (V81); `ModuloModule`: o `ModuloGuard` (@RequireModulo('mister')).
@Module({
  imports: [EquipamentoModule, ModuloModule],
  controllers: [AvisosNaTelaController],
  providers: [AvisosNaTelaService, SyncTokenGuard],
})
export class AvisosNaTelaModule {}
