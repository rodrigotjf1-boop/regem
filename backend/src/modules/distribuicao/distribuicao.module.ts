import { Module } from '@nestjs/common';
import { DistribuicaoService } from './distribuicao.service';
import { DistribuicaoController } from './distribuicao.controller';
import { DistribuicaoGuard, PerfilDistGuard } from './distribuicao.guard';
import { IbptModule } from '../fiscal/ibpt/ibpt.module';

// Console da distribuição — realm de auth próprio (JwtModule é global via AuthModule).
// `IbptModule`: a tabela do IBPT (Lei 12.741) é enviada por aqui, na aba Atualizações.
@Module({
  imports: [IbptModule],
  controllers: [DistribuicaoController],
  providers: [DistribuicaoService, DistribuicaoGuard, PerfilDistGuard],
})
export class DistribuicaoModule {}
