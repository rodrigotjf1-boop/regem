import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { IntegracoesModule } from '../integracoes/integracoes.module';
import { OrzuniModule } from '../orzuni/orzuni.module';
import { MidiaModule } from '../midia/midia.module';
import { ConferenciaController } from './conferencia.controller';
import { ConferenciaLojaController } from './conferencia-loja.controller';
import { ConferenciaService } from './conferencia.service';
import { TaxasController, TaxasLojaController } from './taxas.controller';
import { TaxasService } from './taxas.service';

/**
 * "Conferir com os apps" (R3 F4a; mig 405) e "％ Taxas e margem" da loja (R3 F5; mig 407). Lê o iFood pelo
 * `OrzuniLeituraService` (OrzuniModule) e a 99 pelo `Food99Service` (IntegracoesModule); o servidor da loja pede à nuvem
 * pela rota do token de sync (`ConferenciaLojaController`, `TaxasLojaController` — o `SyncTokenGuard` vem do
 * `EquipamentoModule`, V81). A auditoria é global. "Usar esta foto no Regem" (R3 G1) guarda a foto do app pelo
 * `MidiaService` (MidiaModule).
 */
@Module({
  imports: [EquipamentoModule, OrzuniModule, IntegracoesModule, MidiaModule],
  controllers: [ConferenciaController, ConferenciaLojaController, TaxasController, TaxasLojaController],
  providers: [ConferenciaService, TaxasService],
})
export class ConferenciaModule {}
