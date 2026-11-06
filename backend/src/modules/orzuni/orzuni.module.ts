import { Module } from '@nestjs/common';
import { OrzuniEnvioService } from './orzuni-envio.service';
import { OrzuniLigacaoService } from './orzuni-ligacao.service';

/**
 * iFood pelo Orzuni (R2a; mig 370): o Regem consome a porta MCP do Orzuni. O envio sai da fila (`OrzuniEnvioService`,
 * só nuvem) e a ligação de cada loja é registrada no console da distribuição (`OrzuniLigacaoService`, exportado para o
 * `DistribuicaoModule`). A auditoria é global.
 */
@Module({
  providers: [OrzuniEnvioService, OrzuniLigacaoService],
  exports: [OrzuniLigacaoService, OrzuniEnvioService],
})
export class OrzuniModule {}
