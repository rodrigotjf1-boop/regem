import { Module } from '@nestjs/common';
import { DistribuicaoService } from './distribuicao.service';
import { DistribuicaoController } from './distribuicao.controller';
import { DistribuicaoGuard, PerfilDistGuard } from './distribuicao.guard';
import { IbptModule } from '../fiscal/ibpt/ibpt.module';
import { IntegracaoApiModule } from '../integracao-api/integracao-api.module';

// Console da distribuição — realm de auth próprio (JwtModule é global via AuthModule).
// `IbptModule`: a tabela do IBPT (Lei 12.741) é enviada por aqui, na aba Atualizações.
// `IntegracaoApiModule`: emissão e revogação dos tokens de integração por loja (aba Integrações).
@Module({
  imports: [IbptModule, IntegracaoApiModule],
  controllers: [DistribuicaoController],
  providers: [DistribuicaoService, DistribuicaoGuard, PerfilDistGuard],
})
export class DistribuicaoModule {}
