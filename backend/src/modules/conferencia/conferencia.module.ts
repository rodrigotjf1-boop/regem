import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { OrzuniModule } from '../orzuni/orzuni.module';
import { ConferenciaController } from './conferencia.controller';
import { ConferenciaLojaController } from './conferencia-loja.controller';
import { ConferenciaService } from './conferencia.service';

/**
 * "Conferir com os apps" (R3 F4a; mig 405). Lê o iFood pelo `OrzuniLeituraService` (OrzuniModule) e a 99 pelo
 * `Food99Service` (IntegracoesModule); o servidor da loja pede à nuvem pela rota do token de sync (`ConferenciaLojaController`
 * — o `SyncTokenGuard` vem do `EquipamentoModule`, V81). A auditoria é global.
 */
@Module({
  imports: [EquipamentoModule, OrzuniModule, IntegracoesModule],
  controllers: [ConferenciaController, ConferenciaLojaController],
  providers: [ConferenciaService],
})
export class ConferenciaModule {}
