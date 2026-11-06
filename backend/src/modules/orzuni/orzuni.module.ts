import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../equipamento/equipamento.module';
import { OrzuniEnvioService } from './orzuni-envio.service';
import { OrzuniLigacaoService } from './orzuni-ligacao.service';
import { OrzuniLojaController } from './orzuni-loja.controller';

/**
 * iFood pelo Orzuni (R2a/R2b; mig 370): o Regem consome a porta MCP do Orzuni. O envio sai da fila (`OrzuniEnvioService`,
 * só nuvem); a ligação de cada loja é registrada no console da distribuição (`OrzuniLigacaoService`, exportado para o
 * `DistribuicaoModule`); o servidor da loja lê o "último envio ao iFood" de um item pela rota com o token de sync
 * (`OrzuniLojaController` — o `SyncTokenGuard` vem do `EquipamentoModule`, V81). A auditoria é global.
 */
@Module({
  imports: [EquipamentoModule],
  controllers: [OrzuniLojaController],
  providers: [OrzuniEnvioService, OrzuniLigacaoService],
  exports: [OrzuniLigacaoService, OrzuniEnvioService],
})
export class OrzuniModule {}
