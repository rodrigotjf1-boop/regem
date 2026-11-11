import { Module } from '@nestjs/common';
import { DistribuicaoService } from './distribuicao.service';
import { DistribuicaoController } from './distribuicao.controller';
import { DistribuicaoGuard, PerfilDistGuard } from './distribuicao.guard';
import { IbptModule } from '../fiscal/ibpt/ibpt.module';
import { IntegracaoApiModule } from '../integracao-api/integracao-api.module';
import { OrzuniModule } from '../orzuni/orzuni.module';
import { PrecosNa99Service } from './precos-na-99.service';

// Console da distribuição — realm de auth próprio (JwtModule é global via AuthModule).
// `IbptModule`: a tabela do IBPT (Lei 12.741) é enviada por aqui, na aba Atualizações.
// `IntegracaoApiModule`: emissão e revogação dos tokens de integração por loja (aba Integrações).
// `OrzuniModule`: a ligação de cada loja com o Orzuni e o direito "iFood pelo Orzuni" (aba Integrações; mig 370).
// `PrecosNa99Service`: o direito "Preço e pausa na 99" (aba Integrações; mig 401).
@Module({
  imports: [IbptModule, IntegracaoApiModule, OrzuniModule],
  controllers: [DistribuicaoController],
  providers: [DistribuicaoService, DistribuicaoGuard, PerfilDistGuard, PrecosNa99Service],
})
export class DistribuicaoModule {}
