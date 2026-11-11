import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { OrzuniEnvioService } from './orzuni-envio.service';
import { OrzuniLigacaoService } from './orzuni-ligacao.service';
import { OrzuniLojaController } from './orzuni-loja.controller';
import { OrzuniPausaService } from './orzuni-pausa.service';
import { OrzuniLeituraService } from './orzuni-leitura.service';
import { OrzuniFotoService } from './orzuni-foto.service';

/**
 * iFood pelo Orzuni (R2a/R2b; mig 370): o Regem consome a porta MCP do Orzuni. O envio sai da fila (`OrzuniEnvioService`,
 * só nuvem); a ligação de cada loja é registrada no console da distribuição (`OrzuniLigacaoService`, exportado para o
 * `DistribuicaoModule`); o servidor da loja lê o "último envio ao iFood" de um item pela rota com o token de sync
 * (`OrzuniLojaController` — o `SyncTokenGuard` vem do `EquipamentoModule`, V81). A auditoria é global. A pausa da LOJA no
 * iFood (F5 da pausa por canal) sai pelo `OrzuniPausaService`, que o `DeliveryModule` usa; a leitura do cardápio para
 * "Conferir com os apps" (R3 F4a), pelo `OrzuniLeituraService`, que o `ConferenciaModule` usa — como o "Mandar esta foto
 * ao iFood" (R3 F6b), pelo `OrzuniFotoService`.
 */
@Module({
  imports: [EquipamentoModule],
  controllers: [OrzuniLojaController],
  providers: [OrzuniEnvioService, OrzuniLigacaoService, OrzuniPausaService, OrzuniLeituraService, OrzuniFotoService],
  exports: [OrzuniLigacaoService, OrzuniEnvioService, OrzuniPausaService, OrzuniLeituraService, OrzuniFotoService],
})
export class OrzuniModule {}
