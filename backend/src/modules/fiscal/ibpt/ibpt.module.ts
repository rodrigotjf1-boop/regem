import { Module } from '@nestjs/common';
import { EquipamentoModule } from '../../equipamento/equipamento.module';
import { IbptController } from './ibpt.controller';
import { IbptService } from './ibpt.service';
import { TributosAproxController } from './tributos-aprox.controller';

/**
 * Tabela do IBPT (Lei 12.741, mig 291). Roda nos DOIS lados: na nuvem recebe o arquivo (pelo
 * console da distribuição, que importa este módulo), serve a tabela ao servidor da loja e verifica
 * as vigências; no servidor da loja, busca a tabela da UF dele. A emissão lê as tabelas direto
 * (`ibpt-tabela.ts`). `EquipamentoModule` porque o `SyncTokenGuard` o usa. A Configuração fiscal
 * da loja vê a tabela em uso e guarda o token OPCIONAL do lojista (`TributosAproxController`).
 */
@Module({
  imports: [EquipamentoModule],
  controllers: [IbptController, TributosAproxController],
  providers: [IbptService],
  exports: [IbptService],
})
export class IbptModule {}
