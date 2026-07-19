import { Module } from '@nestjs/common';
import { DistribuicaoService } from './distribuicao.service';
import { DistribuicaoController } from './distribuicao.controller';
import { DistribuicaoGuard, PerfilDistGuard } from './distribuicao.guard';

// Console da distribuição — realm de auth próprio (JwtModule é global via AuthModule).
@Module({
  controllers: [DistribuicaoController],
  providers: [DistribuicaoService, DistribuicaoGuard, PerfilDistGuard],
})
export class DistribuicaoModule {}
